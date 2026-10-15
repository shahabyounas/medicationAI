import {
  CONDITION_STATUS_LABELS,
  COURSE_STATUS_LABELS,
  DOSE_STATUS_LABELS,
  MINUTE_MS,
  calendarDaysBetween,
  describeUnits,
  formatClockTime,
  type Condition,
  type ConditionHistory,
  type Course,
  type Dose,
  type DoseLogEntry,
  type HistoryEntry,
  type HistoryResponse,
  type MedicationForm,
  type Visit,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { describeItem } from './prescriptionService.js';
import { getVisitDetail } from './recordService.js';

/**
 * The lifetime record.
 *
 * The app keeps everything: every illness, every appointment, every course and
 * every tablet actually swallowed, for as long as someone keeps using it. The
 * data for that already existed — a condition carries `startedAt`/`resolvedAt`,
 * a visit its date, a dose its `takenAt` — but nothing read it back as a
 * history. This does.
 *
 * Timestamps are never typed by the patient. Each one is the moment the thing
 * was recorded, which means the record is honest about when it learned
 * something rather than asking a person to remember a date and get it wrong.
 */

/** Month names, written out — "Oct" saves four characters and costs clarity. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function partsIn(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** "14 October" — the year is the heading these sit under. */
function dayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'long' }).format(
    instant,
  );
}

/** "14 October 2015" — for anything shown outside its year heading. */
function fullDateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: 'numeric', month: 'long', year: 'numeric',
  }).format(instant);
}

/**
 * How much of a life this record covers.
 *
 * Counted from the earliest thing recorded, not from the account's creation: a
 * record that has been running eleven years should say so.
 */
function spanLabelFor(earliest: Date | null, now: Date, timeZone: string): string {
  if (!earliest) return 'Nothing recorded yet';
  const days = Math.max(0, calendarDaysBetween(earliest, now, timeZone));
  if (days < 1) return 'Started today';
  if (days < 31) return `${days} ${days === 1 ? 'day' : 'days'} of records`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} of records`;
  const years = Math.floor(days / 365.25);
  return `${years} ${years === 1 ? 'year' : 'years'} of records`;
}

function durationLabelFor(condition: Condition, now: Date, timeZone: string): string {
  const end = condition.resolvedAt ?? now;
  const days = Math.max(0, calendarDaysBetween(condition.startedAt, end, timeZone));
  const measure =
    days < 31
      ? `${days === 0 ? 'less than a day' : `${days} ${days === 1 ? 'day' : 'days'}`}`
      : days < 365
        ? `${Math.max(1, Math.floor(days / 30.44))} months`
        : `${Math.max(1, Math.floor(days / 365.25))} years`;
  if (condition.resolvedAt) return measure;
  return condition.isChronic ? `ongoing for ${measure}` : `${measure} so far`;
}

/** Every dated thing in one flat list, before it is bucketed by year. */
async function collectEntries(
  patientId: string,
  timeZone: string,
): Promise<{ entries: HistoryEntry[]; conditions: Condition[]; visits: Visit[]; courses: Course[] }> {
  const [conditions, visits, courses] = await Promise.all([
    collections.conditions.find({ patientId }),
    collections.visits.find({ patientId }),
    collections.courses.find({ patientId }),
  ]);

  const doctorIds = [...new Set(visits.map((v) => v.doctorId))];
  const doctors = doctorIds.length
    ? await collections.doctors.find({ _id: { $in: doctorIds } })
    : [];
  const doctorNameById = new Map(doctors.map((d) => [d._id, d.name]));
  const conditionNameById = new Map(conditions.map((c) => [c._id, c.name]));

  const entries: HistoryEntry[] = [];
  const add = (e: Omit<HistoryEntry, 'dateLabel'>): void => {
    entries.push({ ...e, dateLabel: dayLabel(e.occurredAt, timeZone) });
  };

  for (const visit of visits) {
    add({
      id: `visit:${visit._id}`,
      kind: 'visit',
      occurredAt: visit.visitDate,
      title: `Saw ${doctorNameById.get(visit.doctorId) ?? 'a doctor'}`,
      detail: visit.diagnosis ?? visit.reason,
      conditionId: visit.conditionId,
      visitId: visit._id,
      doctorName: doctorNameById.get(visit.doctorId) ?? null,
    });
  }

  for (const condition of conditions) {
    const recurrence = condition.recurrenceOfConditionId !== null;
    add({
      id: `condition-open:${condition._id}`,
      kind: recurrence ? 'condition_recurred' : 'condition_opened',
      occurredAt: condition.startedAt,
      title: recurrence ? `${condition.name} came back` : condition.name,
      detail: condition.plainDescription ?? (condition.isChronic ? 'A long-term condition' : null),
      conditionId: condition._id,
      visitId: condition.originVisitId,
      doctorName: null,
    });

    if (condition.resolvedAt) {
      add({
        id: `condition-resolved:${condition._id}`,
        kind: 'condition_resolved',
        occurredAt: condition.resolvedAt,
        title: `${condition.name} resolved`,
        detail: null,
        conditionId: condition._id,
        visitId: null,
        doctorName: null,
      });
    }
  }

  for (const course of courses) {
    if (course.startedAt) {
      add({
        id: `course-start:${course._id}`,
        kind: 'course_started',
        occurredAt: course.startedAt,
        title: `Started ${course.medicationName}`,
        detail: course.conditionId
          ? `For ${conditionNameById.get(course.conditionId) ?? 'a condition'}`
          : null,
        conditionId: course.conditionId,
        visitId: null,
        doctorName: null,
      });
    }

    if (course.completedAt) {
      const stopped = course.status === 'stopped_early';
      add({
        id: `course-end:${course._id}`,
        kind: stopped ? 'course_stopped' : 'course_completed',
        occurredAt: course.completedAt,
        title: stopped
          ? `Stopped ${course.medicationName} early`
          : `Finished ${course.medicationName}`,
        detail: course.totalDoses ? `${course.totalDoses} planned in all` : null,
        conditionId: course.conditionId,
        visitId: null,
        doctorName: null,
      });
    }
  }

  return { entries, conditions, visits, courses };
}

export async function buildHistory(patientId: string, now = new Date()): Promise<HistoryResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const { entries, conditions, visits, courses } = await collectEntries(patientId, tz);
  entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  // Bucket into years, then months, both newest first. Built from a Map rather
  // than a sort over groups so a year with one entry costs the same as a busy one.
  const byYear = new Map<number, Map<number, HistoryEntry[]>>();
  for (const entry of entries) {
    const { year, month } = partsIn(entry.occurredAt, tz);
    const months = byYear.get(year) ?? new Map<number, HistoryEntry[]>();
    const bucket = months.get(month) ?? [];
    bucket.push(entry);
    months.set(month, bucket);
    byYear.set(year, months);
  }

  const years = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      label: String(year),
      entryCount: [...months.values()].reduce((sum, list) => sum + list.length, 0),
      months: [...months.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([month, list]) => ({
          month,
          label: MONTHS[month - 1] ?? String(month),
          entries: list,
        })),
    }));

  const dosesTaken = await collections.doses.count({
    patientId,
    status: { $in: ['taken', 'taken_late'] },
  });

  const earliest = entries.at(-1)?.occurredAt ?? null;

  return {
    patientName: patient.name.split(' ')[0] ?? patient.name,
    timeZone: tz,
    greeting: greetingFor(now, tz),
    ...(await buildNowBand(patientId, tz, now)),
    years,
    totals: {
      conditions: conditions.length,
      visits: visits.length,
      medicines: new Set(courses.map((c) => c.medicationName)).size,
      dosesTaken,
      firstRecordedAt: earliest,
      spanLabel: spanLabelFor(earliest, now, tz),
    },
  };
}

function greetingFor(instant: Date, timeZone: string): string {
  const hour = Number.parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant),
    10,
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * What is outstanding right now, pinned above the record.
 *
 * Reuses the Today read model rather than recomputing it: the day window, the
 * waiting prescriptions and the dose views are decided in one place, and two
 * screens disagreeing about what is due is exactly the bug that costs a tablet.
 */
async function buildNowBand(
  patientId: string,
  _timeZone: string,
  now: Date,
): Promise<Pick<HistoryResponse, 'due' | 'nextDose' | 'todayDoses' | 'waiting'>> {
  const { buildToday } = await import('./viewService.js');
  const today = await buildToday(patientId, now);
  return {
    due: today.doses.find((d) => d.status === 'due') ?? null,
    nextDose: today.nextDose,
    todayDoses: today.doses,
    waiting: today.waiting,
  };
}

/* -------------------------------------------------------------------------- */

function toDoseLogEntry(dose: Dose, timeZone: string): DoseLogEntry {
  const minutesLate =
    dose.takenAt === null
      ? null
      : Math.round((dose.takenAt.getTime() - dose.scheduledAt.getTime()) / MINUTE_MS);

  return {
    _id: dose._id,
    doseNumber: dose.doseNumber,
    scheduledAt: dose.scheduledAt,
    takenAt: dose.takenAt,
    status: dose.status,
    statusLabel: DOSE_STATUS_LABELS[dose.status],
    dateLabel: fullDateLabel(dose.scheduledAt, timeZone),
    scheduledTimeLabel: formatClockTime(dose.scheduledAt, timeZone),
    takenTimeLabel: dose.takenAt ? formatClockTime(dose.takenAt, timeZone) : null,
    minutesLate,
  };
}

/**
 * One illness in full: what it was, who was seen about it, what was prescribed,
 * and every individual dose with the time it was actually swallowed.
 */
export async function buildConditionHistory(conditionId: string): Promise<ConditionHistory> {
  const condition = await collections.conditions.requireById(conditionId);
  const patient = await collections.patients.requireById(condition.patientId);
  const tz = patient.timezone;
  const now = new Date();

  const visits = await collections.visits.find({ conditionId }, { sort: { visitDate: -1 } });
  const visitDetails = await Promise.all(visits.map((v) => getVisitDetail(v._id)));

  const courses = await collections.courses.find({ conditionId }, { sort: { createdAt: 1 } });

  const medicationIds = [...new Set(courses.map((c) => c.medicationId))];
  const medications = medicationIds.length
    ? await collections.medications.find({ _id: { $in: medicationIds } })
    : [];
  const formById = new Map<string, MedicationForm>(medications.map((m) => [m._id, m.form]));

  const prescriptionIds = [...new Set(courses.map((c) => c.prescriptionId))];
  const prescriptions = prescriptionIds.length
    ? await collections.prescriptions.find({ _id: { $in: prescriptionIds } })
    : [];

  const medicationsHistory = await Promise.all(
    courses.map(async (course) => {
      const doses = await collections.doses.find(
        { courseId: course._id },
        { sort: { scheduledAt: -1 } },
      );
      const form = formById.get(course.medicationId) ?? 'tablet';

      // The instruction as written on the prescription, so the log says what
      // was actually asked for rather than re-deriving it from the schedule.
      const prescription = prescriptions.find((p) => p._id === course.prescriptionId);
      const item = prescription?.items.find((i) => i.id === course.prescriptionItemId);
      const instructionLine = item
        ? describeItem(item, form)
        : `${describeUnits(course.amountPerDose, form)}, ${course.frequency.timesPerDay} times a day`;

      const count = (predicate: (d: Dose) => boolean): number => doses.filter(predicate).length;

      return {
        courseId: course._id,
        medicationName: course.medicationName,
        medicationForm: form,
        instructionLine,
        status: course.status,
        statusLabel: COURSE_STATUS_LABELS[course.status],
        startedAt: course.startedAt,
        endedAt: course.completedAt,
        totalDoses: course.totalDoses,
        takenCount: count((d) => d.status === 'taken' || d.status === 'taken_late'),
        missedCount: count((d) => d.status === 'missed'),
        skippedCount: count((d) => d.status === 'skipped'),
        doses: doses.map((d) => toDoseLogEntry(d, tz)),
      };
    }),
  );

  const doctorNames = [...new Set(visitDetails.map((v) => v.doctorName))];

  const recurrenceNote = condition.recurrenceOfConditionId
    ? 'This is the same illness returning after an earlier course was not finished.'
    : null;

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
    doctorNames,
    visits: visitDetails,
    medications: medicationsHistory,
    recurrenceOfConditionId: condition.recurrenceOfConditionId,
    recurrenceNote,
  };
}
