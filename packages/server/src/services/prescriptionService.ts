import { randomUUID } from 'node:crypto';
import {
  applySpacing,
  defaultOffsetFor,
  describeUnits,
  formatClockTime,
  planDoses,
  timeOnDay,
  type Course,
  type CreateDose,
  type Dose,
  type Medication,
  type MedicationForm,
  type Patient,
  type Prescription,
  type PrescriptionDetail,
  type PrescriptionItem,
  type SpacingRule,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { ConflictError } from '../db/repository.js';
import { logAgentEvent } from './agentEventService.js';

/**
 * Everything that happens between "a prescription arrived" and "the agent has a
 * plan it can execute".
 */

/** The agent's read-back — the prescription restated in plain words. */
export async function buildPrescriptionDetail(
  prescription: Prescription,
  patient: Patient,
): Promise<PrescriptionDetail> {
  const doctor = await collections.doctors.requireById(prescription.doctorId);
  const condition = prescription.conditionId
    ? await collections.conditions.findById(prescription.conditionId)
    : null;

  const medications = await loadMedicationsFor(prescription.items);
  const startAt = prescription.medicineInHandAt ?? new Date();

  const readBack = prescription.items.map((item) => {
    const form = medications.get(item.medicationId)?.form ?? 'tablet';
    const times = previewTimes(item, patient, startAt);
    const total = totalUnitsFor(item);

    return {
      medicationName: item.medicationName,
      instruction: describeItem(item, form),
      plan:
        total === null
          ? `Ongoing — ${times.join(', ')} each day`
          : `${describeUnits(total, form)} — I've set ${formatList(times)}`,
    };
  });

  return {
    ...prescription,
    doctorName: doctor.name,
    clinicName: doctor.clinic.name,
    conditionName: condition?.name ?? null,
    readBack,
    spacingNote: buildSpacingNote(prescription.items, medications),
  };
}

/** "1 tablet · 3 times a day · after food · 7 days" */
export function describeItem(item: PrescriptionItem, form: MedicationForm): string {
  const parts = [describeUnits(item.amountPerDose, form)];

  parts.push(
    item.frequency.timesPerDay === 1 ? 'once a day' : `${item.frequency.timesPerDay} times a day`,
  );

  const foodRule = {
    before_food: 'before food',
    after_food: 'after food',
    with_food: 'with food',
    any: null,
  }[item.frequency.foodRule];
  if (foodRule) parts.push(foodRule);

  parts.push(item.durationDays === null ? 'no end date' : `${item.durationDays} days`);
  return parts.join(' · ');
}

export function totalUnitsFor(item: PrescriptionItem): number | null {
  if (item.totalUnits !== null && item.totalUnits !== undefined) return item.totalUnits;
  if (item.durationDays === null) return null;
  return item.frequency.timesPerDay * item.durationDays * item.amountPerDose;
}

/** The times of day this item would land on, for the read-back screen. */
function previewTimes(item: PrescriptionItem, patient: Patient, startAt: Date): string[] {
  const planned = planDoses({
    frequency: item.frequency,
    durationDays: 1,
    mealtimes: patient.mealtimes,
    timeZone: patient.timezone,
    // Preview the shape of a full day, not a day truncated by the current time —
    // and the patient's own day, since UTC midnight is the previous evening for
    // anybody west of Greenwich.
    startAt: timeOnDay(startAt, 0, '00:00', patient.timezone),
  });
  return planned.map((dose) => formatClockTime(dose.scheduledAt, patient.timezone));
}

function formatList(values: string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

async function loadMedicationsFor(
  items: readonly PrescriptionItem[],
): Promise<Map<string, Medication>> {
  const ids = [...new Set(items.map((item) => item.medicationId))];
  const medications = await collections.medications.find({ _id: { $in: ids } });
  return new Map(medications.map((medication) => [medication._id, medication]));
}

/** Explains any enforced gap in the words the design uses. */
function buildSpacingNote(
  items: readonly PrescriptionItem[],
  medications: Map<string, Medication>,
): string | null {
  const names = new Set(items.map((item) => item.medicationName.toLowerCase()));

  for (const item of items) {
    const medication = medications.get(item.medicationId);
    if (!medication) continue;

    for (const rule of medication.spacingRules) {
      if (!names.has(rule.otherMedicationName.toLowerCase())) continue;
      const reason = rule.reason ? ` ${rule.reason}` : '';
      return `I've kept ${medication.name} and ${rule.otherMedicationName} ${rule.minimumMinutesApart} minutes apart.${reason}`;
    }
  }
  return null;
}

/** Spacing rules that apply between the medicines on one prescription. */
async function spacingRulesFor(items: readonly PrescriptionItem[]): Promise<SpacingRule[]> {
  const medications = await loadMedicationsFor(items);
  const namesOnPrescription = new Set(items.map((item) => item.medicationName.toLowerCase()));
  const rules: SpacingRule[] = [];

  for (const medication of medications.values()) {
    for (const rule of medication.spacingRules) {
      if (!namesOnPrescription.has(rule.otherMedicationName.toLowerCase())) continue;
      rules.push({
        medicationName: medication.name,
        otherMedicationName: rule.otherMedicationName,
        minimumMinutesApart: rule.minimumMinutesApart,
      });
    }
  }
  return rules;
}

export interface StartPrescriptionResult {
  prescription: Prescription;
  courses: Course[];
  doses: Dose[];
}

/**
 * "Yes, I have the medicine" — the moment the clock starts.
 *
 * The design is explicit that the course begins when the medicine is in the
 * patient's hand, not when it was prescribed, because the gap between the two
 * is where a schedule silently desynchronises from reality. Everything
 * downstream — courses, doses, the escalation ladder — is created here, in one
 * step, from that single answer.
 */
export async function startPrescription(
  prescriptionId: string,
  startAt: Date = new Date(),
): Promise<StartPrescriptionResult> {
  const prescription = await collections.prescriptions.requireById(prescriptionId);

  if (prescription.status === 'active') {
    throw new ConflictError('This prescription has already been started');
  }
  if (prescription.status === 'completed' || prescription.status === 'stopped') {
    throw new ConflictError(`This prescription is already ${prescription.status}`);
  }

  const patient = await collections.patients.requireById(prescription.patientId);
  const medications = await loadMedicationsFor(prescription.items);
  const rules = await spacingRulesFor(prescription.items);

  const courses: Course[] = [];
  const dosesToInsert: (CreateDose & { medicationName: string })[] = [];

  for (const item of prescription.items) {
    const totalUnits = totalUnitsFor(item);
    const totalDoses =
      item.durationDays === null ? null : item.frequency.timesPerDay * item.durationDays;

    const planned = planDoses({
      frequency: item.frequency,
      durationDays: item.durationDays,
      mealtimes: patient.mealtimes,
      timeZone: patient.timezone,
      startAt,
    });

    const expectedEndAt = planned.at(-1)?.scheduledAt ?? null;

    const course = await collections.courses.insert({
      patientId: prescription.patientId,
      prescriptionId: prescription._id,
      prescriptionItemId: item.id,
      medicationId: item.medicationId,
      medicationName: item.medicationName,
      conditionId: prescription.conditionId,
      status: 'active',
      frequency: item.frequency,
      amountPerDose: item.amountPerDose,
      durationDays: item.durationDays,
      totalDoses,
      startedAt: startAt,
      expectedEndAt,
      completedAt: null,
      unitsRemaining: totalUnits,
      learnedDriftMinutes: 0,
    });
    courses.push(course);

    for (const dose of planned) {
      dosesToInsert.push({
        patientId: prescription.patientId,
        courseId: course._id,
        conditionId: prescription.conditionId,
        medicationName: item.medicationName,
        doseNumber: dose.doseNumber,
        dayNumber: dose.dayNumber,
        anchor: dose.anchor,
        originallyScheduledAt: dose.scheduledAt,
        scheduledAt: dose.scheduledAt,
        status: 'scheduled',
        takenAt: null,
        amount: item.amountPerDose,
        confirmedVia: null,
        rescheduledReason: null,
      });
    }
  }

  // Spacing is applied across the whole prescription, not per course — the
  // whole point is to separate two different medicines that collide.
  const spaced = applySpacing(
    dosesToInsert.map((dose) => ({
      ...dose,
      scheduledAt: dose.scheduledAt,
    })),
    rules,
  );

  const doses = await collections.doses.insertMany(
    spaced.map((dose) => ({
      ...dose,
      // The originally-scheduled time keeps the pre-spacing anchor, so drift is
      // measured against the plan the patient was actually told about.
      originallyScheduledAt: dose.scheduledAt,
    })),
  );

  const updated = await collections.prescriptions.updateById(prescription._id, {
    status: 'active',
    medicineInHandAt: startAt,
  });

  for (const course of courses) {
    const form = medications.get(course.medicationId)?.form ?? 'tablet';
    const count = doses.filter((dose) => dose.courseId === course._id).length;

    await logAgentEvent({
      patientId: prescription.patientId,
      type: 'course_planned',
      occurredAt: startAt,
      doseId: null,
      courseId: course._id,
      conditionId: course.conditionId,
      channel: 'internal',
      summary: `Planned ${describeUnits(count, form)} of ${course.medicationName} around your mealtimes`,
      message: null,
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  return { prescription: updated, courses, doses };
}

/**
 * Create a prescription and, when the visit named a new diagnosis, the
 * condition it treats. Returns the prescription in `draft` — nothing is
 * scheduled until the patient confirms the read-back and has the medicine.
 */
export interface CreatePrescriptionInput {
  patientId: string;
  doctorId: string;
  visitId: string | null;
  conditionId: string | null;
  issuedAt: Date;
  source: Prescription['source'];
  items: Omit<PrescriptionItem, 'id'>[];
  notes?: string;
}

export async function createPrescription(
  input: CreatePrescriptionInput,
): Promise<Prescription> {
  // Validate the referenced records exist before writing anything.
  await collections.patients.requireById(input.patientId);
  await collections.doctors.requireById(input.doctorId);
  if (input.visitId) await collections.visits.requireById(input.visitId);
  if (input.conditionId) await collections.conditions.requireById(input.conditionId);

  const items: PrescriptionItem[] = input.items.map((item) => ({
    ...item,
    id: randomUUID(),
    totalUnits: item.totalUnits ?? null,
  }));

  const prescription = await collections.prescriptions.insert({
    patientId: input.patientId,
    doctorId: input.doctorId,
    visitId: input.visitId,
    conditionId: input.conditionId,
    issuedAt: input.issuedAt,
    source: input.source,
    status: 'draft',
    items,
    medicineInHandAt: null,
    ...(input.notes ? { notes: input.notes } : {}),
  });

  return prescription;
}

export async function confirmPrescription(prescriptionId: string): Promise<Prescription> {
  const prescription = await collections.prescriptions.requireById(prescriptionId);
  if (prescription.status !== 'draft') {
    throw new ConflictError(`Only a draft prescription can be confirmed`);
  }
  return collections.prescriptions.updateById(prescriptionId, { status: 'confirmed' });
}

/** Default anchor offset for an item, exposed for the read-back copy. */
export function offsetForItem(item: PrescriptionItem): number {
  return item.frequency.offsetMinutes ?? defaultOffsetFor(item.frequency.foodRule);
}
