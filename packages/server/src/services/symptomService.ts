import {
  calendarDaysBetween,
  describeSeverity,
  formatDayMonth,
  isSameDayIn,
  type SymptomEntry,
  type SymptomPoint,
  type SymptomSeries,
  type RecordSymptomRequest,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { logAgentEvent } from './agentEventService.js';

/**
 * How ill the patient actually feels.
 *
 * The record could already say that twenty-one tablets went in and that the
 * illness was resolved — but "resolved" was inferred from the tablets running
 * out (`resolveConditionIfAllCoursesDone`), not from anybody getting better.
 * Nobody was ever asked. One tap a day is what turns the course report from a
 * pill count into an outcome.
 *
 * It also makes the product's central claim checkable. The day 3–4 nudge exists
 * because people stop when the symptom goes; with a severity line you can see
 * the fall and the abandoned doses on the same chart, for this patient, rather
 * than citing the literature at them.
 */
export async function recordSymptom(
  input: RecordSymptomRequest,
  now = new Date(),
): Promise<{ entry: SymptomEntry; message: string }> {
  const patient = await collections.patients.requireById(input.patientId);
  const condition = await collections.conditions.requireById(input.conditionId);
  if (condition.patientId !== patient._id) {
    throw new BadRequestError('That illness belongs to a different patient');
  }

  // One entry per day, replaced rather than appended: this is asked once a day
  // and a patient correcting their answer should not leave two.
  const sameDay = (
    await collections.symptoms.find({ patientId: patient._id, conditionId: condition._id })
  ).find((entry) => isSameDayIn(entry.recordedAt, input.recordedAt, patient.timezone));

  const entry = sameDay
    ? await collections.symptoms.updateById(sameDay._id, {
        severity: input.severity,
        note: input.note ?? null,
        recordedAt: input.recordedAt,
      })
    : await collections.symptoms.insert({
        patientId: patient._id,
        conditionId: condition._id,
        recordedAt: input.recordedAt,
        severity: input.severity,
        note: input.note ?? null,
      });

  await logAgentEvent({
    patientId: patient._id,
    type: 'symptom_recorded',
    occurredAt: now,
    doseId: null,
    courseId: null,
    conditionId: condition._id,
    channel: 'internal',
    summary: `${condition.name} — ${describeSeverity(input.severity).toLowerCase()} (${
      input.severity
    }/10)`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: false,
  });

  return {
    entry,
    // No encouragement, no "glad you're feeling better". It is written down.
    message: `Noted — ${describeSeverity(input.severity).toLowerCase()}.`,
  };
}

/** The severity line for every illness with at least one answer. */
export async function buildSymptomSeries(
  patientId: string,
  now = new Date(),
): Promise<SymptomSeries[]> {
  const patient = await collections.patients.requireById(patientId);
  const [entries, conditions, courses] = await Promise.all([
    collections.symptoms.find({ patientId }, { sort: { recordedAt: 1 } }),
    collections.conditions.find({ patientId }),
    collections.courses.find({ patientId }),
  ]);

  const conditionsById = new Map(conditions.map((c) => [c._id, c]));
  const byCondition = new Map<string, SymptomEntry[]>();
  for (const entry of entries) {
    byCondition.set(entry.conditionId, [...(byCondition.get(entry.conditionId) ?? []), entry]);
  }

  const series: SymptomSeries[] = [];

  for (const [conditionId, theirEntries] of byCondition) {
    const condition = conditionsById.get(conditionId);
    if (!condition) continue;

    // Day numbers are counted from when treatment started, not from when the
    // illness was diagnosed, so the chart's day 3 is the same day 3 the nudge
    // and the dose grid mean.
    const theirCourses = courses.filter((course) => course.conditionId === conditionId);
    const startedAt = theirCourses.reduce<Date | null>(
      (earliest, course) =>
        course.startedAt && (earliest === null || course.startedAt < earliest)
          ? course.startedAt
          : earliest,
      null,
    );

    const points: SymptomPoint[] = theirEntries.map((entry) => ({
      recordedAt: entry.recordedAt,
      dateLabel: formatDayMonth(entry.recordedAt, patient.timezone),
      dayNumber: startedAt
        ? Math.max(1, calendarDaysBetween(startedAt, entry.recordedAt, patient.timezone) + 1)
        : null,
      severity: entry.severity,
      severityLabel: describeSeverity(entry.severity),
      note: entry.note,
    }));

    series.push({
      conditionId,
      conditionName: condition.name,
      points,
      recordedToday: theirEntries.some((entry) =>
        isSameDayIn(entry.recordedAt, now, patient.timezone),
      ),
      turningPointNote: turningPointNote(points, theirCourses, patient.timezone),
    });
  }

  return series;
}

/** Which illnesses are still being treated and have not been asked today. */
export async function conditionsAwaitingSymptom(
  patientId: string,
  now = new Date(),
): Promise<{ conditionId: string; conditionName: string; dayNumber: number | null }[]> {
  const patient = await collections.patients.requireById(patientId);
  const [conditions, courses, entries] = await Promise.all([
    collections.conditions.find({ patientId, status: { $in: ['active', 'ongoing', 'recurred'] } }),
    collections.courses.find({ patientId, status: 'active' }),
    collections.symptoms.find({ patientId }),
  ]);

  const asked = new Set(
    entries
      .filter((entry) => isSameDayIn(entry.recordedAt, now, patient.timezone))
      .map((entry) => entry.conditionId),
  );

  return conditions
    // Only while something is actually being taken for it. Asking somebody how
    // their 2019 chest infection is today is how a daily prompt gets ignored.
    .filter((condition) => courses.some((course) => course.conditionId === condition._id))
    .filter((condition) => !asked.has(condition._id))
    .map((condition) => {
      const startedAt = courses
        .filter((course) => course.conditionId === condition._id)
        .reduce<Date | null>(
          (earliest, course) =>
            course.startedAt && (earliest === null || course.startedAt < earliest)
              ? course.startedAt
              : earliest,
          null,
        );
      return {
        conditionId: condition._id,
        conditionName: condition.name,
        dayNumber: startedAt
          ? Math.max(1, calendarDaysBetween(startedAt, now, patient.timezone) + 1)
          : null,
      };
    });
}

/**
 * The sentence the whole feature is for.
 *
 * It looks for the day the patient first said they were nearly well, and
 * reports what happened to the doses after it. That is the product's own claim,
 * stated about this patient rather than about patients in general — and when the
 * doses kept going it says so, because the app should be as willing to report
 * that the patient finished properly as that they did not.
 */
function turningPointNote(
  points: readonly SymptomPoint[],
  courses: readonly { _id: string; totalDoses: number | null }[],
  _timeZone: string,
): string | null {
  if (points.length < 3) return null;

  const better = points.find((point) => point.severity <= 2 && point.dayNumber !== null);
  if (!better || better.dayNumber === null) return null;

  const total = courses.reduce((sum, course) => sum + (course.totalDoses ?? 0), 0);
  if (total === 0) return null;

  return `You said you were nearly back to normal on day ${better.dayNumber}. That is the day the tablets usually start getting missed.`;
}
