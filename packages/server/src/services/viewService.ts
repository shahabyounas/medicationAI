import {
  COURSE_STATUS_LABELS,
  DOSE_STATUS_LABELS,
  MEDICATION_FORM_LABELS,
  buildCourseProgress,
  calendarDaysBetween,
  escalationMessage,
  feelBetterMessage,
  formatClockTime,
  shouldShowFeelBetterNudge,
  summariseAdherence,
  type Condition,
  type ConditionSummary,
  type Course,
  type CourseReport,
  type Dose,
  type DoseView,
  type FamilyResponse,
  type MedicinesResponse,
  type MedicationForm,
  type MessageContext,
  type Patient,
  type TodayResponse,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { eventsSince, familyVisibleEvents } from './agentEventService.js';

/**
 * Read models for the screens.
 *
 * The UI is deliberately thin — it renders what it is given and computes almost
 * nothing. Assembling each screen here means the copy, the maths and the
 * ordering are all decided in one place that can be tested, rather than spread
 * across components where "day 4 of 7" might quietly disagree with the ring
 * next to it.
 */

function toDoseView(
  dose: Dose,
  timeZone: string,
  formByCourseId: Map<string, MedicationForm>,
): DoseView {
  return {
    ...dose,
    clockTime: formatClockTime(dose.scheduledAt, timeZone),
    statusLabel: DOSE_STATUS_LABELS[dose.status],
    isActionable: dose.status === 'due' || dose.status === 'scheduled',
    medicationForm: formByCourseId.get(dose.courseId) ?? 'tablet',
  };
}

/** The dosage form behind each course, so the icons depict the real medicine. */
async function medicationFormsByCourse(
  courses: readonly Course[],
): Promise<Map<string, MedicationForm>> {
  const medicationIds = [...new Set(courses.map((c) => c.medicationId))];
  const medications = await collections.medications.find({ _id: { $in: medicationIds } });
  const formById = new Map(medications.map((m) => [m._id, m.form]));
  return new Map(courses.map((c) => [c._id, formById.get(c.medicationId) ?? 'tablet']));
}

function greetingFor(instant: Date, timeZone: string): string {
  const hour = Number.parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      instant,
    ),
    10,
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function startOfDayIn(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  // en-CA formats as YYYY-MM-DD, which parses back as a UTC midnight.
  return new Date(`${parts}T00:00:00.000Z`);
}

export async function buildToday(patientId: string, now = new Date()): Promise<TodayResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const activeCourses = await collections.courses.find({ patientId, status: 'active' });
  const courseIds = activeCourses.map((c) => c._id);

  const dayStart = startOfDayIn(now, tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const todaysDoses = courseIds.length
    ? await collections.doses.find(
        { patientId, courseId: { $in: courseIds }, scheduledAt: { $gte: dayStart, $lt: dayEnd } },
        { sort: { scheduledAt: 1 } },
      )
    : [];

  // The dose the whole home screen is built around: whatever is due now, or
  // failing that the next one still to come today.
  const nextDose =
    todaysDoses.find((d) => d.status === 'due') ??
    todaysDoses.find((d) => d.status === 'scheduled') ??
    null;

  const progresses = await Promise.all(
    activeCourses.map(async (course) => {
      const doses = await collections.doses.find({ courseId: course._id });
      return buildCourseProgress({
        courseId: course._id,
        medicationName: course.medicationName,
        status: course.status,
        totalDoses: course.totalDoses,
        unitsRemaining: course.unitsRemaining,
        startedAt: course.startedAt,
        doses,
        timeZone: tz,
        now,
      });
    }),
  );

  const doseForms = await medicationFormsByCourse(activeCourses);
  const primary = await buildPrimaryCondition(patient, activeCourses, now);
  const agentLine = await buildAgentLine(patient, nextDose, now);
  const nudge = await buildFeelBetterNudge(patient, activeCourses, primary, now);

  return {
    patientName: patient.name.split(' ')[0] ?? patient.name,
    timeZone: tz,
    greeting: greetingFor(now, tz),
    nextDose: nextDose ? toDoseView(nextDose, tz, doseForms) : null,
    agentLine,
    doses: todaysDoses.map((d) => toDoseView(d, tz, doseForms)),
    activeCourses: progresses,
    feelBetterNudge: nudge,
    activity: await eventsSince(patientId, dayStart),
    primaryCondition: primary,
  };
}

/** The sentence in the dark card at the top of the Today screen. */
async function buildAgentLine(patient: Patient, dose: Dose | null, now: Date): Promise<string> {
  if (!dose) {
    return 'All doses done for today. Nothing else to take — I\'ll remind you tomorrow.';
  }

  const course = await collections.courses.findById(dose.courseId);
  const medication = course ? await collections.medications.findById(course.medicationId) : null;
  const condition = dose.conditionId
    ? await collections.conditions.findById(dose.conditionId)
    : null;

  const context: MessageContext = {
    patientName: patient.name.split(' ')[0] ?? patient.name,
    medicationName: dose.medicationName,
    amount: dose.amount,
    unitLabel: MEDICATION_FORM_LABELS[medication?.form ?? 'tablet'],
    scheduledAt: dose.scheduledAt,
    timeZone: patient.timezone,
    doseNumber: dose.doseNumber,
    totalDoses: course?.totalDoses ?? null,
    dosesRemaining: null,
    dayNumber: dose.dayNumber,
    durationDays: course?.durationDays ?? null,
    doctorName: null,
    conditionName: condition?.name ?? null,
    familyContactName: patient.familyContacts[0]?.name ?? null,
  };

  if (dose.status === 'due') return escalationMessage('reminder_1', context);

  const when = formatClockTime(dose.scheduledAt, patient.timezone);
  const rescheduled = dose.rescheduledReason ? ` I moved it — ${dose.rescheduledReason}.` : '';
  return `Next up at ${when}: ${dose.amount} ${context.unitLabel} of ${dose.medicationName}.${rescheduled}`;
}

async function buildFeelBetterNudge(
  patient: Patient,
  courses: readonly Course[],
  primary: TodayResponse['primaryCondition'],
  now: Date,
): Promise<TodayResponse['feelBetterNudge']> {
  if (!primary) return null;

  const course = courses.find((c) => c.conditionId === primary.conditionId && c.durationDays);
  if (!course) return null;

  const remaining = Math.max(0, primary.totalDoses - primary.takenCount);
  if (!shouldShowFeelBetterNudge(primary.dayNumber, remaining, course.durationDays)) return null;

  const prescription = await collections.prescriptions.findById(course.prescriptionId);
  const doctor = prescription ? await collections.doctors.findById(prescription.doctorId) : null;

  return {
    title: "Feeling better? That's the medicine working.",
    body: feelBetterMessage({
      patientName: patient.name,
      medicationName: course.medicationName,
      amount: course.amountPerDose,
      unitLabel: 'tablet',
      scheduledAt: now,
      timeZone: patient.timezone,
      doseNumber: primary.takenCount + 1,
      totalDoses: primary.totalDoses,
      dosesRemaining: remaining,
      dayNumber: primary.dayNumber,
      durationDays: course.durationDays,
      doctorName: doctor?.name ?? null,
      conditionName: primary.name,
      familyContactName: null,
    }),
    daysLeft: Math.max(0, (course.durationDays ?? 0) - primary.dayNumber),
  };
}

/** The condition card with the ring and the row of day cells. */
async function buildPrimaryCondition(
  patient: Patient,
  courses: readonly Course[],
  now: Date,
): Promise<TodayResponse['primaryCondition']> {
  const withCondition = courses.filter((c) => c.conditionId !== null && c.durationDays !== null);
  if (withCondition.length === 0) return null;

  // The condition with the nearest end date is the one the patient is actively
  // working through; a chronic medicine should not displace it.
  const focus = [...withCondition].sort(
    (a, b) => (a.expectedEndAt?.getTime() ?? 0) - (b.expectedEndAt?.getTime() ?? 0),
  )[0];
  if (!focus?.conditionId) return null;

  const condition = await collections.conditions.findById(focus.conditionId);
  if (!condition) return null;

  const siblings = courses.filter((c) => c.conditionId === condition._id);
  const doses = await collections.doses.find({ courseId: { $in: siblings.map((c) => c._id) } });

  const summary = summariseAdherence(doses, now);
  const totalDoses = siblings.reduce((sum, c) => sum + (c.totalDoses ?? 0), 0);
  const durationDays = focus.durationDays;
  const dayNumber = focus.startedAt
    ? Math.max(1, calendarDaysBetween(focus.startedAt, now, patient.timezone) + 1)
    : 1;

  const dayCells = buildDayCells(doses, focus.startedAt, dayNumber, durationDays, patient.timezone);

  return {
    conditionId: condition._id,
    name: condition.name,
    dayNumber,
    durationDays,
    takenCount: summary.taken,
    totalDoses,
    percentComplete: totalDoses === 0 ? 0 : Math.round((summary.taken / totalDoses) * 100),
    dayCells,
  };
}

function buildDayCells(
  doses: readonly Dose[],
  startedAt: Date | null,
  today: number,
  durationDays: number | null,
  timeZone: string,
): { day: number; state: 'done' | 'today' | 'upcoming' | 'missed' }[] {
  const days = durationDays ?? Math.max(today, 7);
  const cells: { day: number; state: 'done' | 'today' | 'upcoming' | 'missed' }[] = [];

  for (let day = 1; day <= days; day += 1) {
    if (day > today) {
      cells.push({ day, state: 'upcoming' });
      continue;
    }
    if (day === today) {
      cells.push({ day, state: 'today' });
      continue;
    }

    const onThatDay = startedAt
      ? doses.filter((d) => calendarDaysBetween(startedAt, d.scheduledAt, timeZone) + 1 === day)
      : [];
    const anyMissed = onThatDay.some((d) => d.status === 'missed' || d.status === 'skipped');
    cells.push({ day, state: anyMissed ? 'missed' : 'done' });
  }
  return cells;
}

/** The Medicines screen: everything grouped under the condition it treats. */
export async function buildMedicines(patientId: string, now = new Date()): Promise<MedicinesResponse> {
  const patient = await collections.patients.requireById(patientId);
  const [conditions, courses, medications, prescriptions, doctors] = await Promise.all([
    collections.conditions.find({ patientId }, { sort: { startedAt: -1 } }),
    collections.courses.find({ patientId }),
    collections.medications.find({}),
    collections.prescriptions.find({ patientId }),
    collections.doctors.find({ patientId }),
  ]);

  const medicationsById = new Map(medications.map((m) => [m._id, m]));
  const doctorsById = new Map(doctors.map((d) => [d._id, d]));
  const prescriptionsById = new Map(prescriptions.map((p) => [p._id, p]));

  const summaries: ConditionSummary[] = [];

  for (const condition of conditions) {
    const theirCourses = courses.filter((c) => c.conditionId === condition._id);
    if (theirCourses.length === 0) continue;

    const enriched = await Promise.all(
      theirCourses.map(async (course) => {
        const doses = await collections.doses.find({ courseId: course._id });
        const medication = medicationsById.get(course.medicationId);
        return {
          ...course,
          progress: buildCourseProgress({
            courseId: course._id,
            medicationName: course.medicationName,
            status: course.status,
            totalDoses: course.totalDoses,
            unitsRemaining: course.unitsRemaining,
            startedAt: course.startedAt,
            doses,
            timeZone: patient.timezone,
            now,
          }),
          medicationPurpose: medication?.purpose ?? null,
          medicationForm: medication?.form ?? 'tablet',
          instructionLine: instructionLineFor(course, medication?.form ?? 'tablet'),
        };
      }),
    );

    const totalDoses = enriched.reduce((sum, c) => sum + (c.totalDoses ?? 0), 0);
    const takenDoses = enriched.reduce((sum, c) => sum + c.progress.takenCount, 0);
    const firstCourse = theirCourses[0];
    const prescription = firstCourse ? prescriptionsById.get(firstCourse.prescriptionId) : undefined;
    const doctorName = prescription ? (doctorsById.get(prescription.doctorId)?.name ?? null) : null;

    const startedAt = theirCourses.reduce<Date | null>(
      (earliest, c) =>
        c.startedAt && (earliest === null || c.startedAt < earliest) ? c.startedAt : earliest,
      null,
    );

    summaries.push({
      ...condition,
      doctorName,
      courses: enriched,
      overallPercent: totalDoses === 0 ? 0 : Math.round((takenDoses / totalDoses) * 100),
      dayNumber: startedAt
        ? Math.max(1, calendarDaysBetween(startedAt, now, patient.timezone) + 1)
        : null,
      durationDays: firstCourse?.durationDays ?? null,
    });
  }

  const isFinished = (summary: ConditionSummary): boolean =>
    summary.status === 'resolved' ||
    summary.courses.every((c) => c.status === 'completed' || c.status === 'stopped_early');

  return {
    active: summaries.filter((s) => !isFinished(s)),
    finished: summaries.filter(isFinished),
  };
}

function instructionLineFor(course: Course, form: keyof typeof MEDICATION_FORM_LABELS): string {
  const unit = MEDICATION_FORM_LABELS[form];
  const amount = `${course.amountPerDose} ${course.amountPerDose === 1 ? unit : `${unit}s`}`;
  const times =
    course.frequency.timesPerDay === 1
      ? 'once a day'
      : `${course.frequency.timesPerDay} times a day`;
  const food = {
    before_food: 'before food',
    after_food: 'after food',
    with_food: 'with food',
    any: null,
  }[course.frequency.foodRule];

  return [amount, times, food, course.durationDays === null ? 'no end date' : null]
    .filter(Boolean)
    .join(' · ');
}

export async function buildFamily(patientId: string): Promise<FamilyResponse> {
  const patient = await collections.patients.requireById(patientId);

  return {
    contacts: patient.familyContacts.map((contact) => ({
      id: contact.id,
      name: `${contact.name} (${contact.relation})`,
      relation: contact.relation,
      phone: contact.phone,
      rule: `Told after ${Math.round(contact.notifyAfterMinutes / 60)} hours, or ${
        contact.notifyAfterConsecutiveMisses
      } missed doses`,
      initials: contact.name
        .split(' ')
        .map((part) => part[0] ?? '')
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    })),
    channels: [
      { channel: 'push', label: 'Notification on this phone', order: 1 },
      { channel: 'sms', label: "Text message, if you don't respond", order: 2 },
      { channel: 'family', label: 'Family, only as a last resort', order: 3 },
    ],
    recentEscalations: await familyVisibleEvents(patientId, 15),
  };
}

/** The end-of-course report. */
export async function buildCourseReport(conditionId: string): Promise<CourseReport> {
  const condition = await collections.conditions.requireById(conditionId);
  const patient = await collections.patients.requireById(condition.patientId);
  const courses = await collections.courses.find({ conditionId });
  const doses = await collections.doses.find({ courseId: { $in: courses.map((c) => c._id) } });

  const summary = summariseAdherence(doses, new Date());
  const lateCount = doses.filter((d) => d.status === 'taken_late').length;

  const familyInterventions = await collections.agentEvents.count({
    conditionId,
    type: 'family_notified',
  });

  const firstCourse = courses[0];
  const prescription = firstCourse
    ? await collections.prescriptions.findById(firstCourse.prescriptionId)
    : null;
  const doctor = prescription ? await collections.doctors.findById(prescription.doctorId) : null;

  const totalDoses = courses.reduce((sum, c) => sum + (c.totalDoses ?? 0), 0);
  const completedInFull = totalDoses > 0 && summary.taken >= totalDoses;

  const startedAt = courses.reduce<Date | null>(
    (earliest, c) =>
      c.startedAt && (earliest === null || c.startedAt < earliest) ? c.startedAt : earliest,
    null,
  );
  const endedAt = courses.reduce<Date | null>(
    (latest, c) =>
      c.completedAt && (latest === null || c.completedAt > latest) ? c.completedAt : latest,
    null,
  );

  const medicationNames = [...new Set(courses.map((c) => c.medicationName))];
  const range =
    startedAt && endedAt
      ? `${formatDate(startedAt, patient.timezone)}–${formatDate(endedAt, patient.timezone)}`
      : 'in progress';

  return {
    conditionName: condition.name,
    doctorName: doctor?.name ?? null,
    startedAt,
    endedAt,
    medicationNames,
    totalDoses,
    takenCount: summary.taken,
    lateCount,
    missedCount: summary.missed,
    familyInterventions,
    completedInFull,
    summaryLine: `${condition.name} · ${doctor?.name ?? 'Unknown doctor'} · ${range} · ${medicationNames.join(
      ' and ',
    )} · ${completedInFull ? 'completed in full' : `${summary.missed} doses not taken`}.`,
  };
}

function formatDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(
    instant,
  );
}

/** Exposed for the condition detail screen. */
export async function conditionCourseStatusLabel(condition: Condition): Promise<string> {
  const courses = await collections.courses.find({ conditionId: condition._id });
  const active = courses.find((c) => c.status === 'active');
  return active ? COURSE_STATUS_LABELS.active : COURSE_STATUS_LABELS.completed;
}
