import {
  CONDITION_STATUS_LABELS,
  COURSE_STATUS_LABELS,
  DOSE_STATUS_LABELS,
  calendarDaysBetween,
  formatClockTime,
  formatDayMonth,
  isTaken,
  wallClockIn,
  type Condition,
  type ConditionHistory,
  type ConditionMedicationHistory,
  type Course,
  type Dose,
  type DoseLogEntry,
  type HistoryEntry,
  type HistoryResponse,
  type HistoryYear,
  type MedicationForm,
  type Prescription,
  type Visit,
  type VisitDetail,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { listVisitDetails } from './recordService.js';
import {
  buildWaiting,
  dayWindowIn,
  greetingFor,
  instructionLineFor,
  medicationFormsByCourse,
  toDoseView,
} from './viewService.js';

/**
 * The lifetime record.
 *
 * One chronology, newest first, holding everything the app knows: illnesses
 * opened and cleared, appointments, courses started and finished — and today's
 * doses at the top of it, because a dose due in ten minutes is the newest thing
 * in the record rather than a separate screen.
 *
 * Every entry is built here rather than in the component. A record read across
 * years is exactly where "day 4 of 7" and the bar beside it start disagreeing,
 * and that only stays fixed if the dates, counts and copy are decided once.
 */

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const TAKEN_FILTER = { $in: ['taken', 'taken_late'] } as const;

export async function buildHistory(patientId: string, now = new Date()): Promise<HistoryResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const [conditions, courses, visits, doctors, prescriptions] = await Promise.all([
    collections.conditions.find({ patientId }),
    collections.courses.find({ patientId }),
    collections.visits.find({ patientId }),
    collections.doctors.find({ patientId }),
    collections.prescriptions.find({ patientId }),
  ]);

  // The present, on the same terms as the old home screen: the patient's own
  // midnight-to-midnight day, not UTC's.
  const activeCourses = courses.filter((course) => course.status === 'active');
  const { start: dayStart, end: dayEnd } = dayWindowIn(now, tz);
  const todaysDoses = activeCourses.length
    ? await collections.doses.find(
        {
          patientId,
          courseId: { $in: activeCourses.map((course) => course._id) },
          scheduledAt: { $gte: dayStart, $lt: dayEnd },
        },
        { sort: { scheduledAt: 1 } },
      )
    : [];

  const forms = await medicationFormsByCourse(activeCourses);
  const due = todaysDoses.find((dose) => dose.status === 'due') ?? null;
  const next = todaysDoses.find((dose) => dose.status === 'scheduled') ?? null;

  const doctorNames = new Map(doctors.map((doctor) => [doctor._id, doctor.name]));
  const conditionNames = new Map(conditions.map((condition) => [condition._id, condition.name]));
  const prescriptionsById = new Map(prescriptions.map((p) => [p._id, p]));

  // Only the courses that ended need their counts, and those are the entries
  // that would otherwise read "Stopped Penicillin V" with no idea how far in.
  const endedCourses = courses.filter(
    (course) => course.status === 'completed' || course.status === 'stopped_early',
  );
  const takenByCourse = new Map<string, number>(
    await Promise.all(
      endedCourses.map(
        async (course) =>
          [
            course._id,
            await collections.doses.count({ courseId: course._id, status: TAKEN_FILTER }),
          ] as const,
      ),
    ),
  );

  const entries = [
    ...conditionEntries(conditions, tz),
    ...visitEntries(visits, doctorNames, tz),
    ...courseEntries(courses, prescriptionsById, doctorNames, conditionNames, takenByCourse, tz),
  ];

  const firstRecordedAt = entries.reduce<Date | null>(
    (earliest, entry) =>
      earliest === null || entry.occurredAt < earliest ? entry.occurredAt : earliest,
    null,
  );

  return {
    patientName: patient.name.split(' ')[0] ?? patient.name,
    timeZone: tz,
    greeting: greetingFor(now, tz),
    due: due ? toDoseView(due, tz, forms) : null,
    nextDose: next ? toDoseView(next, tz, forms) : null,
    todayDoses: todaysDoses.map((dose) => toDoseView(dose, tz, forms)),
    waiting: await buildWaiting(patientId, now, tz),
    years: groupByYear(entries, tz),
    totals: {
      conditions: conditions.length,
      visits: visits.length,
      // Distinct medicines, not courses: the same antibiotic prescribed twice
      // is one medicine the patient has been on, which is what the number is
      // read as.
      medicines: new Set(courses.map((course) => course.medicationId)).size,
      dosesTaken: await collections.doses.count({ patientId, status: TAKEN_FILTER }),
      firstRecordedAt,
      spanLabel: spanLabelFor(firstRecordedAt, now),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

function conditionEntries(conditions: readonly Condition[], timeZone: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const condition of conditions) {
    // A condition carrying `recurrenceOfConditionId` *is* the return of an
    // earlier one, so its opening is the moment it came back.
    const isReturn = condition.recurrenceOfConditionId !== null;

    entries.push({
      id: `${condition._id}:opened`,
      kind: isReturn ? 'condition_recurred' : 'condition_opened',
      occurredAt: condition.startedAt,
      dateLabel: formatDayMonth(condition.startedAt, timeZone),
      title: isReturn ? `${condition.name} came back` : condition.name,
      detail: condition.plainDescription ?? null,
      conditionId: condition._id,
      visitId: condition.originVisitId,
      doctorName: null,
    });

    if (condition.resolvedAt) {
      entries.push({
        id: `${condition._id}:resolved`,
        kind: 'condition_resolved',
        occurredAt: condition.resolvedAt,
        dateLabel: formatDayMonth(condition.resolvedAt, timeZone),
        title: `${condition.name} cleared`,
        // `recurred` is the record saying this one did not stay cleared. It
        // belongs at the end of the episode, where the reader is looking at
        // what the treatment achieved.
        detail: condition.status === 'recurred' ? 'It came back later.' : null,
        conditionId: condition._id,
        visitId: null,
        doctorName: null,
      });
    }
  }

  return entries;
}

function visitEntries(
  visits: readonly Visit[],
  doctorNames: Map<string, string>,
  timeZone: string,
): HistoryEntry[] {
  return visits.map((visit) => {
    const doctorName = doctorNames.get(visit.doctorId) ?? null;
    return {
      id: `${visit._id}:visit`,
      kind: 'visit' as const,
      occurredAt: visit.visitDate,
      dateLabel: formatDayMonth(visit.visitDate, timeZone),
      title: doctorName ? `Saw ${doctorName}` : 'Appointment',
      // What the doctor concluded, or failing that what took the patient in.
      detail: visit.diagnosis ?? visit.reason,
      conditionId: visit.conditionId,
      visitId: visit._id,
      doctorName,
    };
  });
}

function courseEntries(
  courses: readonly Course[],
  prescriptionsById: Map<string, Prescription>,
  doctorNames: Map<string, string>,
  conditionNames: Map<string, string>,
  takenByCourse: Map<string, number>,
  timeZone: string,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const course of courses) {
    const prescription = prescriptionsById.get(course.prescriptionId);
    const doctorName = prescription ? (doctorNames.get(prescription.doctorId) ?? null) : null;
    const conditionName = course.conditionId
      ? (conditionNames.get(course.conditionId) ?? null)
      : null;

    if (course.startedAt) {
      entries.push({
        id: `${course._id}:started`,
        kind: 'course_started',
        occurredAt: course.startedAt,
        dateLabel: formatDayMonth(course.startedAt, timeZone),
        title: `Started ${course.medicationName}`,
        detail: [
          conditionName ? `For ${conditionName.toLowerCase()}` : null,
          course.totalDoses === null ? 'no end date' : `${course.totalDoses} doses`,
        ]
          .filter(Boolean)
          .join(' · '),
        conditionId: course.conditionId,
        visitId: null,
        doctorName,
      });
    }

    if (!course.completedAt) continue;

    const taken = takenByCourse.get(course._id) ?? 0;

    if (course.status === 'completed') {
      entries.push({
        id: `${course._id}:completed`,
        kind: 'course_completed',
        occurredAt: course.completedAt,
        dateLabel: formatDayMonth(course.completedAt, timeZone),
        title: `Finished ${course.medicationName}`,
        detail:
          course.totalDoses === null
            ? `${taken} doses taken`
            : `All ${course.totalDoses} doses taken`,
        conditionId: course.conditionId,
        visitId: null,
        doctorName,
      });
      continue;
    }

    if (course.status === 'stopped_early') {
      entries.push({
        id: `${course._id}:stopped`,
        kind: 'course_stopped',
        occurredAt: course.completedAt,
        dateLabel: formatDayMonth(course.completedAt, timeZone),
        title: `Stopped ${course.medicationName}`,
        detail:
          course.totalDoses === null
            ? `${taken} doses taken, then it stopped`
            : `${taken} of ${course.totalDoses} doses taken`,
        conditionId: course.conditionId,
        visitId: null,
        doctorName,
      });
    }
  }

  return entries;
}

/**
 * Entries into years and months, newest first.
 *
 * Grouped on the patient's wall clock rather than UTC's, so a dose taken at
 * 11pm on 31 December does not file itself under the following year.
 */
function groupByYear(entries: readonly HistoryEntry[], timeZone: string): HistoryYear[] {
  const byYear = new Map<number, Map<number, HistoryEntry[]>>();

  for (const entry of entries) {
    const wall = wallClockIn(entry.occurredAt, timeZone);
    const months = byYear.get(wall.year) ?? new Map<number, HistoryEntry[]>();
    months.set(wall.month, [...(months.get(wall.month) ?? []), entry]);
    byYear.set(wall.year, months);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => ({
      year,
      label: String(year),
      entryCount: [...months.values()].reduce((sum, list) => sum + list.length, 0),
      months: [...months.entries()]
        .sort(([a], [b]) => b - a)
        .map(([month, list]) => ({
          month,
          label: MONTH_LABELS[month - 1] ?? String(month),
          entries: [...list].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
        })),
    }));
}

/** "4 months of records", "12 years of records". */
function spanLabelFor(firstRecordedAt: Date | null, now: Date): string {
  if (!firstRecordedAt) return 'Nothing recorded yet';

  const days = Math.max(
    0,
    Math.round((now.getTime() - firstRecordedAt.getTime()) / (24 * 60 * 60 * 1000)),
  );
  if (days < 31) return 'Records start this month';

  const years = Math.floor(days / 365);
  if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'} of records`;

  const months = Math.max(1, Math.floor(days / 30));
  return `${months} ${months === 1 ? 'month' : 'months'} of records`;
}

/* -------------------------------------------------------------------------- */
/* One illness, in full                                                       */
/* -------------------------------------------------------------------------- */

export async function buildConditionHistory(
  conditionId: string,
  now = new Date(),
): Promise<ConditionHistory> {
  const condition = await collections.conditions.requireById(conditionId);
  const patient = await collections.patients.requireById(condition.patientId);
  const tz = patient.timezone;

  const [courses, allVisits] = await Promise.all([
    collections.courses.find({ conditionId }, { sort: { createdAt: 1 } }),
    listVisitDetails(condition.patientId),
  ]);

  // The visit that opened the illness counts even if it was filed before the
  // condition existed and never got the back-reference.
  const visits = allVisits.filter(
    (visit) => visit.conditionId === conditionId || visit._id === condition.originVisitId,
  );

  const forms = await medicationFormsByCourse(courses);
  const medications: ConditionMedicationHistory[] = [];

  for (const course of courses) {
    const form: MedicationForm = forms.get(course._id) ?? 'tablet';
    // Newest first: "did I take the last one?" is the question being asked.
    const doses = await collections.doses.find(
      { courseId: course._id },
      { sort: { scheduledAt: -1 } },
    );

    medications.push({
      courseId: course._id,
      medicationName: course.medicationName,
      medicationForm: form,
      instructionLine: instructionLineFor(course, form),
      status: course.status,
      statusLabel: COURSE_STATUS_LABELS[course.status],
      startedAt: course.startedAt,
      endedAt: course.completedAt,
      totalDoses: course.totalDoses,
      takenCount: doses.filter((dose) => isTaken(dose.status)).length,
      missedCount: doses.filter((dose) => dose.status === 'missed').length,
      skippedCount: doses.filter((dose) => dose.status === 'skipped').length,
      doses: doses.map((dose) => toDoseLogEntry(dose, tz)),
    });
  }

  return {
    _id: condition._id,
    name: condition.name,
    plainDescription: condition.plainDescription ?? null,
    status: condition.status,
    statusLabel: CONDITION_STATUS_LABELS[condition.status],
    isChronic: condition.isChronic,
    startedAt: condition.startedAt,
    resolvedAt: condition.resolvedAt,
    durationLabel: durationLabelFor(condition, now, tz),
    doctorNames: [...new Set(visits.map((visit) => visit.doctorName))],
    visits,
    medications,
    recurrenceOfConditionId: condition.recurrenceOfConditionId,
    recurrenceNote: await recurrenceNoteFor(condition, tz),
  };
}

function toDoseLogEntry(dose: Dose, timeZone: string): DoseLogEntry {
  return {
    _id: dose._id,
    doseNumber: dose.doseNumber,
    scheduledAt: dose.scheduledAt,
    takenAt: dose.takenAt,
    status: dose.status,
    statusLabel: DOSE_STATUS_LABELS[dose.status],
    dateLabel: formatDayMonthYear(dose.scheduledAt, timeZone),
    scheduledTimeLabel: formatClockTime(dose.scheduledAt, timeZone),
    takenTimeLabel: dose.takenAt ? formatClockTime(dose.takenAt, timeZone) : null,
    minutesLate: dose.takenAt
      ? Math.round((dose.takenAt.getTime() - dose.scheduledAt.getTime()) / (60 * 1000))
      : null,
  };
}

/** "11 days", "ongoing for 5 years". */
function durationLabelFor(condition: Condition, now: Date, timeZone: string): string {
  const days = Math.max(
    0,
    calendarDaysBetween(condition.startedAt, condition.resolvedAt ?? now, timeZone),
  );

  if (condition.resolvedAt === null) {
    if (days === 0) return 'started today';
    if (days >= 365) {
      const years = Math.floor(days / 365);
      return `ongoing for ${years} ${years === 1 ? 'year' : 'years'}`;
    }
    if (days >= 60) return `ongoing for ${Math.floor(days / 30)} months`;
    return `ongoing for ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  // Inclusive of both ends: 2–7 May is six days of being ill, not five.
  const span = days + 1;
  return `${span} ${span === 1 ? 'day' : 'days'}`;
}

/**
 * What the record can say about an illness that returned.
 *
 * Facts only — the earlier course, how far it got, and the gap. Whether
 * stopping early *caused* the return is a clinical judgement the agent is not
 * allowed to make, so it states the two dates and stops.
 */
async function recurrenceNoteFor(condition: Condition, timeZone: string): Promise<string | null> {
  const previousId = condition.recurrenceOfConditionId;
  if (!previousId) return null;

  const previous = await collections.conditions.findById(previousId);
  if (!previous) return null;

  const gap = Math.max(
    0,
    calendarDaysBetween(previous.resolvedAt ?? previous.startedAt, condition.startedAt, timeZone),
  );
  const when = formatDayMonth(previous.startedAt, timeZone);

  const courses = await collections.courses.find({ conditionId: previous._id });
  const stopped = courses.find((course) => course.status === 'stopped_early');
  if (!stopped) {
    return `You had this before, from ${when}. It returned ${gap} days later.`;
  }

  const taken = await collections.doses.count({ courseId: stopped._id, status: TAKEN_FILTER });
  const total = stopped.totalDoses;

  return (
    `You had this before, from ${when}. That course of ${stopped.medicationName} ` +
    `stopped after ${taken}${total === null ? '' : ` of ${total}`} doses, and it returned ` +
    `${gap} days later.`
  );
}

/** "14 Oct 2026" — the dose log spans years, so the year has to be in it. */
function formatDayMonthYear(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}
