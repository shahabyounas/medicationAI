import {
  MEDICATION_KIND_LABELS,
  allergyFlagMessage,
  applySpacing,
  describeUnits,
  formatDayMonth,
  planDoses,
  selfCareStartedMessage,
  type Course,
  type CreateDose,
  type Medication,
  type Patient,
  type SelfCareCourse,
  type SelfCareIntakeRequest,
  type SelfCareIntakeResponse,
  type SpacingRule,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { logAgentEvent } from './agentEventService.js';
import { dayWindowIn, instructionLineFor } from './viewService.js';

/**
 * The medicines nobody prescribed.
 *
 * Most of what people actually take is not on a prescription: the vitamin D
 * every morning, the ibuprofen in the drawer, the cod liver oil a daughter
 * swears by. An app that only knows about prescribed medicine has an incomplete
 * list of what is going into the patient — and it is incomplete at exactly the
 * moment the list matters, when somebody in a clinic asks what they are on.
 *
 * Three things make this deliberately not an intake:
 *
 *   - **No prescription is created.** `Course.prescriptionId` became nullable
 *     for this. Fabricating a prescription for a supplement would put an
 *     invented document in the one part of the record that exists to be a
 *     faithful copy of the paper.
 *   - **No read-back, and no "do you have it yet?".** That question exists
 *     because the gap between the surgery and the chemist is where a schedule
 *     desynchronises from reality. Somebody adding the tub already in their
 *     kitchen cupboard has no gap, so the course starts now.
 *   - **Reminders are off by default.** Nobody wants an escalating ladder, a
 *     text message and a phone call to their son over a multivitamin. The
 *     patient opts in, and when they do not, the course is recorded with no
 *     doses at all — it is a list entry, not a plan.
 */
export async function addSelfCare(
  input: SelfCareIntakeRequest,
  now = new Date(),
): Promise<SelfCareIntakeResponse> {
  const patient = await collections.patients.requireById(input.patientId);
  const startedAt = input.startedAt ?? now;

  if (input.conditionId) {
    const condition = await collections.conditions.requireById(input.conditionId);
    if (condition.patientId !== patient._id) {
      throw new BadRequestError('That illness belongs to a different patient');
    }
  }

  // --- The medicine --------------------------------------------------------
  let medication: Medication;
  let medicationCreated = false;

  if (input.medication.existingId) {
    medication = await collections.medications.requireById(input.medication.existingId);
  } else {
    const create = input.medication.create;
    if (!create) throw new BadRequestError('medication: nothing to create');

    // The catalogue is shared and unique on name, so a supplement somebody else
    // already added is reused rather than colliding on the index.
    const existing = await collections.medications.findOne({
      name: { $regex: `^${escapeRegex(create.name)}$`, $options: 'i' },
    });

    if (existing) {
      medication = existing;
    } else {
      medication = await collections.medications.insert({
        name: create.name,
        ...(create.strength ? { strength: create.strength } : {}),
        form: create.form,
        kind: create.kind,
        ...(create.purpose ? { purpose: create.purpose } : {}),
        spacingRules: [],
        cautions: [],
      });
      medicationCreated = true;
    }
  }

  // --- The allergy check ---------------------------------------------------
  const allergyFlags = flagAllergies(patient, medication.name);
  if (allergyFlags.length > 0) {
    await logAgentEvent({
      patientId: patient._id,
      type: 'allergy_flagged',
      occurredAt: now,
      doseId: null,
      courseId: null,
      conditionId: input.conditionId,
      channel: 'internal',
      summary: `Checked ${medication.name} against your allergy list — ${allergyFlags.length} to look at`,
      message: allergyFlags.join(' '),
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  // --- The course ----------------------------------------------------------
  const frequency = { timesPerDay: input.timesPerDay, foodRule: input.foodRule };
  const totalDoses =
    input.durationDays === null ? null : input.timesPerDay * input.durationDays;

  /**
   * Doses are planned from today, not from `startedAt`.
   *
   * Somebody adding the vitamin D they have taken since June is telling the
   * record when they started, not asking for four months of doses. Planning
   * from `startedAt` would lay down hundreds of doses in the past, and the
   * agent's activation pass writes off anything whose window has elapsed as
   * `missed` — so recording an honest start date would have invented months of
   * missed doses, wrecked every adherence figure on the insights screen, and
   * tripped the consecutive-miss rule that texts the patient's son.
   */
  const planned = input.remindMe
    ? planDoses({
        frequency,
        durationDays: input.durationDays,
        mealtimes: patient.mealtimes,
        timeZone: patient.timezone,
        startAt: startedAt.getTime() > now.getTime() ? startedAt : now,
        ...(input.durationDays === null ? { openEndedDays: 14 } : {}),
      })
    : [];

  const course = await collections.courses.insert({
    patientId: patient._id,
    origin: 'self',
    prescriptionId: null,
    prescriptionItemId: null,
    medicationId: medication._id,
    medicationName: medication.name,
    conditionId: input.conditionId,
    status: 'active',
    frequency,
    amountPerDose: input.amountPerDose,
    durationDays: input.durationDays,
    totalDoses,
    startedAt,
    expectedEndAt: planned.at(-1)?.scheduledAt ?? null,
    completedAt: null,
    unitsRemaining: input.unitsInHand,
    learnedDriftMinutes: 0,
    stoppedReason: null,
    pausedAt: null,
    remindersOn: input.remindMe,
  });

  // --- The doses, when the patient asked to be reminded --------------------
  let dosesScheduled = 0;
  let spacingNote: string | null = null;

  if (planned.length > 0) {
    const rules = await spacingRulesAgainstCurrentMedicines(patient._id, medication);
    const toInsert: CreateDose[] = planned.map((dose) => ({
      patientId: patient._id,
      courseId: course._id,
      conditionId: input.conditionId,
      medicationName: medication.name,
      doseNumber: dose.doseNumber,
      dayNumber: dose.dayNumber,
      anchor: dose.anchor,
      originallyScheduledAt: dose.scheduledAt,
      scheduledAt: dose.scheduledAt,
      status: 'scheduled',
      takenAt: null,
      amount: input.amountPerDose,
      confirmedVia: null,
      rescheduledReason: null,
      skipReason: null,
    }));

    const spaced = applySpacing(toInsert, rules);
    const inserted = await collections.doses.insertMany(spaced);
    dosesScheduled = inserted.length;

    const applied = rules[0];
    if (applied) {
      spacingNote =
        `I've kept ${applied.medicationName} and ${applied.otherMedicationName} ` +
        `${applied.minimumMinutesApart} minutes apart.`;
    }
  }

  await logAgentEvent({
    patientId: patient._id,
    type: 'self_care_started',
    occurredAt: now,
    doseId: null,
    courseId: course._id,
    conditionId: input.conditionId,
    channel: 'internal',
    summary: input.remindMe
      ? `Added ${medication.name} (${MEDICATION_KIND_LABELS[
          medication.kind
        ].toLowerCase()}) — ${describeUnits(dosesScheduled, medication.form)} planned`
      : `Added ${medication.name} (${MEDICATION_KIND_LABELS[
          medication.kind
        ].toLowerCase()}) to your list — no reminders`,
    message: input.notes ?? null,
    escalationNodeId: null,
    visibleToFamily: false,
  });

  return {
    courseId: course._id,
    medicationId: medication._id,
    medicationCreated,
    dosesScheduled,
    message: selfCareStartedMessage({
      medicationName: medication.name,
      timesPerDay: input.timesPerDay,
      openEnded: input.durationDays === null,
    }),
    allergyFlags,
    spacingNote,
  };
}

/**
 * Stop taking something.
 *
 * Not `stopped_early` with a note about abandonment. A patient deciding to stop
 * a supplement they bought themselves has not abandoned a course of treatment,
 * and recording it as a failure would put a black mark on the record for an act
 * that is entirely theirs to make — as well as skewing every adherence number
 * on the insights screen.
 */
export async function stopSelfCare(
  courseId: string,
  reason: string | undefined,
  now = new Date(),
): Promise<{ message: string; dosesCancelled: number }> {
  const course = await collections.courses.requireById(courseId);
  if (course.origin !== 'self') {
    throw new BadRequestError(
      'That is a prescribed course — stopping it is a decision for your doctor',
    );
  }

  const outstanding = await collections.doses.deleteMany({
    courseId,
    status: { $in: ['scheduled', 'due'] },
  });

  await collections.courses.updateById(courseId, {
    status: 'completed',
    completedAt: now,
    stoppedReason: reason ?? 'you decided to stop taking it',
  });

  await logAgentEvent({
    patientId: course.patientId,
    type: 'self_care_stopped',
    occurredAt: now,
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: `Stopped ${course.medicationName}${reason ? ` — ${reason}` : ''}`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: false,
  });

  return {
    message: `${course.medicationName} is off your list. It stays on your record.`,
    dosesCancelled: outstanding,
  };
}

/** The self-managed list for the Medicines screen. */
export async function buildSelfCare(
  patientId: string,
  now = new Date(),
): Promise<SelfCareCourse[]> {
  const patient = await collections.patients.requireById(patientId);
  const [courses, medications, conditions, sideEffects] = await Promise.all([
    collections.courses.find({ patientId, origin: 'self' }, { sort: { startedAt: -1 } }),
    collections.medications.find({}),
    collections.conditions.find({ patientId }),
    collections.sideEffects.find({ patientId, resolvedAt: null }),
  ]);

  const medicationsById = new Map(medications.map((m) => [m._id, m]));
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  // The patient's midnight, not the server's. `setHours` on a server in UTC
  // puts the start of "today" five hours into the previous evening for a
  // patient in New York, which is the bug `dayWindowIn` exists to prevent.
  const { start: startOfDay } = dayWindowIn(now, patient.timezone);

  return Promise.all(
    courses.map(async (course) => {
      const medication = medicationsById.get(course.medicationId);
      const doses = await collections.doses.find({ courseId: course._id });
      const today = doses.filter((dose) => dose.scheduledAt >= startOfDay && dose.scheduledAt <= now);
      const report = sideEffects.find((r) => r.courseId === course._id);

      return {
        courseId: course._id,
        medicationId: course.medicationId,
        medicationName: course.medicationName,
        medicationForm: medication?.form ?? 'tablet',
        kind: medication?.kind ?? 'supplement',
        kindLabel: MEDICATION_KIND_LABELS[medication?.kind ?? 'supplement'],
        purpose: medication?.purpose ?? null,
        instructionLine: instructionLineFor(course, medication?.form ?? 'tablet'),
        status: course.status,
        startedAt: course.startedAt,
        startedLabel: course.startedAt
          ? `Since ${formatDayMonth(course.startedAt, patient.timezone)}`
          : null,
        // Null when the patient asked for no reminders: there are no doses, so
        // every progress number would be a zero pretending to be information.
        progress: null,
        reminded: course.remindersOn,
        takenToday: today.filter((d) => d.status === 'taken' || d.status === 'taken_late').length,
        expectedToday: today.length,
        unitsRemaining: course.unitsRemaining,
        conditionId: course.conditionId,
        conditionName: course.conditionId
          ? (conditionsById.get(course.conditionId)?.name ?? null)
          : null,
        sideEffectNote: report ? `You reported "${report.symptom}"` : null,
      };
    }),
  );
}

/**
 * Allergies whose substance appears in a medicine's name.
 *
 * A substring match, and nothing more. The app does not know what is in a
 * medicine, does not know that amoxicillin is a penicillin, and the copy it
 * produces says so — it states what is on the record and tells the patient to
 * ask a human. A check that catches the obvious case is worth having; one that
 * implies it catches every case is dangerous, which is why the sentence never
 * claims the medicine is safe when there is no match.
 */
export function flagAllergies(patient: Patient, medicationName: string): string[] {
  const haystack = medicationName.toLowerCase();

  return patient.allergies
    .filter((allergy) => {
      const needle = allergy.substance.trim().toLowerCase();
      // Two characters would match half the catalogue.
      if (needle.length < 4) return false;
      return haystack.includes(needle) || needle.includes(haystack);
    })
    .map((allergy) =>
      allergyFlagMessage({
        medicationName,
        substance: allergy.substance,
        severity: allergy.severity,
        reaction: allergy.reaction ?? null,
        doctorName: null,
      }),
    );
}

/** Spacing rules between a new medicine and everything already being taken. */
async function spacingRulesAgainstCurrentMedicines(
  patientId: string,
  medication: Medication,
): Promise<SpacingRule[]> {
  const active = await collections.courses.find({ patientId, status: 'active' });
  const currentNames = new Set(active.map((course) => course.medicationName.toLowerCase()));
  const rules: SpacingRule[] = [];

  for (const rule of medication.spacingRules) {
    if (!currentNames.has(rule.otherMedicationName.toLowerCase())) continue;
    rules.push({
      medicationName: medication.name,
      otherMedicationName: rule.otherMedicationName,
      minimumMinutesApart: rule.minimumMinutesApart,
    });
  }

  // And the other way round: a prescribed medicine may carry the rule about
  // this one rather than the reverse.
  const others = await collections.medications.find({
    name: { $in: active.map((course) => course.medicationName) },
  });
  for (const other of others) {
    for (const rule of other.spacingRules) {
      if (rule.otherMedicationName.toLowerCase() !== medication.name.toLowerCase()) continue;
      rules.push({
        medicationName: other.name,
        otherMedicationName: medication.name,
        minimumMinutesApart: rule.minimumMinutesApart,
      });
    }
  }

  return rules;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
