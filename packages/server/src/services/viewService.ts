import {
  COURSE_STATUS_LABELS,
  DOSE_STATUS_LABELS,
  buildCourseProgress,
  calendarDaysBetween,
  describeUnits,
  escalationMessage,
  feelBetterMessage,
  formatClockTime,
  shouldShowFeelBetterNudge,
  summariseAdherence,
  timeOnDay,
  type Condition,
  type ConditionSummary,
  type Course,
  type CourseReport,
  type Dose,
  type DoseView,
  type FamilyResponse,
  type MedicinesResponse,
  type MedicationForm,
  type TodayCourseGroup,
  type MessageContext,
  type Patient,
  type TodayResponse,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { eventsSince, familyVisibleEvents } from './agentEventService.js';
import { describeItem, totalUnitsFor } from './prescriptionService.js';

/**
 * Read models for the screens.
 *
 * The UI is deliberately thin — it renders what it is given and computes almost
 * nothing. Assembling each screen here means the copy, the maths and the
 * ordering are all decided in one place that can be tested, rather than spread
 * across components where "day 4 of 7" might quietly disagree with the ring
 * next to it.
 */

/** Exposed for the record screen, so a dose reads the same on both. */
export function toDoseView(
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
export async function medicationFormsByCourse(
  courses: readonly Course[],
): Promise<Map<string, MedicationForm>> {
  const medicationIds = [...new Set(courses.map((c) => c.medicationId))];
  const medications = await collections.medications.find({ _id: { $in: medicationIds } });
  const formById = new Map(medications.map((m) => [m._id, m.form]));
  return new Map(courses.map((c) => [c._id, formById.get(c.medicationId) ?? 'tablet']));
}

export function greetingFor(instant: Date, timeZone: string): string {
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

/**
 * The window the Today screen covers: midnight to midnight where the patient is.
 *
 * It has to be the patient's midnight, not UTC midnight on the patient's date.
 * Those are the same instant only in UTC itself; in New York the UTC one lands
 * at 8pm the evening before, which slid the whole window five hours early and
 * dropped the evening dose off the home screen entirely. `timeOnDay` resolves a
 * wall-clock time in a zone and is the tested path for exactly this — it also
 * means the day is 23 or 25 hours long across a clock change rather than
 * always 24.
 */
export function dayWindowIn(instant: Date, timeZone: string): { start: Date; end: Date } {
  return {
    start: timeOnDay(instant, 0, '00:00', timeZone),
    end: timeOnDay(instant, 1, '00:00', timeZone),
  };
}

export async function buildToday(patientId: string, now = new Date()): Promise<TodayResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const activeCourses = await collections.courses.find({ patientId, status: 'active' });
  const courseIds = activeCourses.map((c) => c._id);

  const { start: dayStart, end: dayEnd } = dayWindowIn(now, tz);

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
  const courseGroups = await buildCourseGroups(patient, activeCourses, now);
  const agentLine = buildAgentLine(patient, nextDose, todaysDoses);
  const nudge = await buildFeelBetterNudge(patient, activeCourses, courseGroups, now);

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
    courseGroups,
    waiting: await buildWaiting(patientId, now, tz),
  };
}

/**
 * The prescriptions the agent is holding until the medicine is in the house.
 *
 * `confirmed` means the patient checked the read-back and the plan is ready to
 * run. Nothing else in the app reads that status, so the "not yet" answer used
 * to be a one-way door: the prescription stayed confirmed forever and no screen
 * could start it. Surfacing it here is what makes that answer reversible.
 */
export async function buildWaiting(
  patientId: string,
  now: Date,
  timeZone: string,
): Promise<TodayResponse['waiting']> {
  const prescriptions = await collections.prescriptions.find(
    { patientId, status: 'confirmed' },
    { sort: { issuedAt: -1 } },
  );
  if (prescriptions.length === 0) return [];

  return Promise.all(
    prescriptions.map(async (prescription) => {
      const doctor = await collections.doctors.findById(prescription.doctorId);
      const condition = prescription.conditionId
        ? await collections.conditions.findById(prescription.conditionId)
        : null;
      const medications = await collections.medications.find({
        _id: { $in: prescription.items.map((item) => item.medicationId) },
      });
      const formById = new Map(medications.map((m) => [m._id, m.form]));

      return {
        _id: prescription._id,
        doctorName: doctor?.name ?? 'your doctor',
        conditionName: condition?.name ?? null,
        medicationNames: prescription.items.map((item) => item.medicationName),
        lines: prescription.items.map((item) => {
          const form = formById.get(item.medicationId) ?? 'tablet';
          const total = totalUnitsFor(item);
          const instruction = describeItem(item, form);
          return total === null
            ? `${item.medicationName} — ${instruction}`
            : `${item.medicationName} — ${instruction} (${describeUnits(total, form)} in all)`;
        }),
        addedLabel: addedLabelFor(prescription.createdAt, now, timeZone),
      };
    }),
  );
}

/** "Added today" / "Added yesterday" / "Added on 12 October". */
function addedLabelFor(added: Date, now: Date, timeZone: string): string {
  const days = calendarDaysBetween(added, now, timeZone);
  if (days <= 0) return 'Added today';
  if (days === 1) return 'Added yesterday';
  if (days < 7) return `Added ${days} days ago`;
  return `Added on ${new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).format(added)}`;
}

/**
 * One short sentence under the greeting.
 *
 * Deliberately tiny. It used to be a paragraph in a dark card that restated the
 * dose card directly beneath it — two things saying the same thing is how a
 * screen starts feeling complicated.
 */
function buildAgentLine(patient: Patient, next: Dose | null, todaysDoses: readonly Dose[]): string {
  const missed = todaysDoses.filter((d) => d.status === 'missed').length;

  if (!next) {
    if (todaysDoses.length === 0) return 'Nothing scheduled today.';
    return missed > 0
      ? `That's everything for today. ${missed} ${missed === 1 ? 'dose was' : 'doses were'} missed.`
      : "That's everything for today. Well done.";
  }

  if (next.status === 'due') return `Time to take your ${next.medicationName}.`;
  return `Nothing to take until ${formatClockTime(next.scheduledAt, patient.timezone)}.`;
}

async function buildFeelBetterNudge(
  patient: Patient,
  courses: readonly Course[],
  groups: readonly TodayCourseGroup[],
  now: Date,
): Promise<TodayResponse['feelBetterNudge']> {
  // The first finite course that has reached the day people give up on.
  const group = groups.find(
    (candidate) =>
      !candidate.isOngoing &&
      shouldShowFeelBetterNudge(
        candidate.dayNumber,
        candidate.remainingCount ?? 0,
        candidate.durationDays,
      ),
  );
  if (!group) return null;

  const course = courses.find((c) => c.conditionId === group.conditionId && c.durationDays);
  if (!course) return null;

  const remaining = group.remainingCount ?? 0;

  const prescription = await collections.prescriptions.findById(course.prescriptionId);
  const doctor = prescription ? await collections.doctors.findById(prescription.doctorId) : null;
  const medication = await collections.medications.findById(course.medicationId);

  return {
    title: "Feeling better? That's the medicine working.",
    body: feelBetterMessage({
      patientName: patient.name,
      medicationName: course.medicationName,
      amount: course.amountPerDose,
      form: medication?.form ?? 'tablet',
      scheduledAt: now,
      timeZone: patient.timezone,
      doseNumber: group.takenCount + 1,
      totalDoses: group.totalDoses,
      dosesRemaining: remaining,
      dayNumber: group.dayNumber,
      durationDays: course.durationDays,
      doctorName: doctor?.name ?? null,
      conditionName: group.name,
      familyContactName: null,
    }),
    daysLeft: Math.max(0, (course.durationDays ?? 0) - (group.dayNumber ?? 0)),
  };
}

/**
 * Every active course, grouped by what it treats.
 *
 * Courses that share a condition are shown as one thing, because that is how
 * the patient thinks of them — "my chest infection", not "my Amoxicillin and my
 * Pantoprazole". A course with no condition stands on its own under the
 * medicine's name rather than being dropped.
 */
async function buildCourseGroups(
  patient: Patient,
  courses: readonly Course[],
  now: Date,
): Promise<TodayCourseGroup[]> {
  const byKey = new Map<string, Course[]>();
  for (const course of courses) {
    const key = course.conditionId ?? `course:${course._id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), course]);
  }

  const groups: TodayCourseGroup[] = [];

  for (const siblings of byKey.values()) {
    const first = siblings[0];
    if (!first) continue;

    const condition = first.conditionId
      ? await collections.conditions.findById(first.conditionId)
      : null;

    const doses = await collections.doses.find({
      courseId: { $in: siblings.map((c) => c._id) },
    });
    const summary = summariseAdherence(doses, now);

    // A group is only "ongoing" when nothing in it has an end date.
    const isOngoing = siblings.every((c) => c.totalDoses === null);
    const totalDoses = isOngoing
      ? null
      : siblings.reduce((sum, c) => sum + (c.totalDoses ?? 0), 0);

    const startedAt = siblings.reduce<Date | null>(
      (earliest, c) =>
        c.startedAt && (earliest === null || c.startedAt < earliest) ? c.startedAt : earliest,
      null,
    );
    const durationDays = siblings.reduce<number | null>(
      (longest, c) =>
        c.durationDays !== null && (longest === null || c.durationDays > longest)
          ? c.durationDays
          : longest,
      null,
    );
    const dayNumber = startedAt
      ? Math.max(1, calendarDaysBetween(startedAt, now, patient.timezone) + 1)
      : null;

    groups.push({
      conditionId: condition?._id ?? null,
      name: condition?.name ?? first.medicationName,
      isOngoing,
      dayNumber,
      durationDays,
      takenCount: summary.taken,
      totalDoses,
      remainingCount: totalDoses === null ? null : Math.max(0, totalDoses - summary.taken),
      medicationNames: siblings.map((c) => c.medicationName),
      dayCells:
        isOngoing || dayNumber === null
          ? []
          : buildDayCells(doses, startedAt, dayNumber, durationDays, patient.timezone),
    });
  }

  // The course closest to finishing goes first; open-ended ones sink to the
  // bottom, since there is never anything urgent about them.
  return groups.sort((a, b) => {
    if (a.isOngoing !== b.isOngoing) return a.isOngoing ? 1 : -1;
    return (a.remainingCount ?? Infinity) - (b.remainingCount ?? Infinity);
  });
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

/** Exposed for the record screen: "1 tablet · 3 times a day · after food". */
export function instructionLineFor(course: Course, form: MedicationForm): string {
  const amount = describeUnits(course.amountPerDose, form);
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
    mealtimes: patient.mealtimes,
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
