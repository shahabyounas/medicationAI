import {
  MINUTE_MS,
  ON_TIME_GRACE_MINUTES,
  afterTakeMessage,
  buildCourseProgress,
  countConsecutiveMisses,
  formatClockTime,
  learnDriftMinutes,
  needsRefillWarning,
  refillWarningMessage,
  rescheduledMessage,
  type Course,
  type CourseProgress,
  type Dose,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { ConflictError } from '../db/repository.js';
import { logAgentEvent } from './agentEventService.js';
import { settleEscalation } from '../agent/escalationStore.js';

export interface DoseActionResult {
  dose: Dose;
  message: string;
  courseProgress: CourseProgress | null;
  courseCompleted: boolean;
}

/**
 * The patient confirms a dose.
 *
 * This is the only event the whole system is trying to produce, so it does
 * rather a lot: settle the escalation, count the tablet off the shelf, learn
 * how late this patient tends to be, and check whether the course is finished.
 */
export async function takeDose(
  doseId: string,
  via: Dose['confirmedVia'] = 'app',
  takenAt: Date = new Date(),
): Promise<DoseActionResult> {
  const dose = await collections.doses.requireById(doseId);

  if (dose.status === 'taken' || dose.status === 'taken_late') {
    throw new ConflictError('That dose is already recorded as taken');
  }

  const minutesLate = Math.round((takenAt.getTime() - dose.scheduledAt.getTime()) / MINUTE_MS);
  const status: Dose['status'] = minutesLate > ON_TIME_GRACE_MINUTES ? 'taken_late' : 'taken';

  const updated = await collections.doses.updateById(doseId, {
    status,
    takenAt,
    confirmedVia: via ?? 'app',
  });

  // The agent stops chasing the moment it is confirmed.
  await settleEscalation(doseId, 'resolved', takenAt);

  const course = await collections.courses.requireById(dose.courseId);
  const doses = await collections.doses.find({ courseId: course._id }, { sort: { scheduledAt: 1 } });
  const patient = await collections.patients.requireById(dose.patientId);

  const unitsRemaining =
    course.unitsRemaining === null ? null : Math.max(0, course.unitsRemaining - dose.amount);
  const drift = learnDriftMinutes(
    doses
      .filter((d) => d.takenAt !== null)
      .map((d) => ({ scheduledAt: d.originallyScheduledAt, takenAt: d.takenAt as Date })),
  );

  await collections.courses.updateById(course._id, { unitsRemaining, learnedDriftMinutes: drift });

  const takenCount = doses.filter((d) => d.status === 'taken' || d.status === 'taken_late').length;
  const remaining = course.totalDoses === null ? null : Math.max(0, course.totalDoses - takenCount);

  await logAgentEvent({
    patientId: dose.patientId,
    type: 'dose_taken',
    occurredAt: takenAt,
    doseId,
    courseId: course._id,
    conditionId: dose.conditionId,
    channel: via === 'app' ? 'push' : 'sms',
    summary: `${formatClockTime(dose.scheduledAt, patient.timezone)} — ${dose.medicationName} taken${
      status === 'taken_late' ? ' (late)' : ''
    }`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  // Warn before the shelf runs out, not after.
  const dosesStillScheduled = doses.filter(
    (d) => d.status === 'scheduled' || d.status === 'due',
  ).length;
  if (
    needsRefillWarning(unitsRemaining, dosesStillScheduled, course.frequency.timesPerDay) &&
    unitsRemaining !== null
  ) {
    await logAgentEvent({
      patientId: dose.patientId,
      type: 'refill_warning',
      occurredAt: takenAt,
      doseId: null,
      courseId: course._id,
      conditionId: dose.conditionId,
      channel: 'push',
      summary: refillWarningMessage(unitsRemaining, course.medicationName),
      message: null,
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  const courseCompleted = await completeCourseIfFinished(course, doses, takenAt);

  return {
    dose: updated,
    message: afterTakeMessage(remaining),
    courseProgress: buildCourseProgress({
      courseId: course._id,
      medicationName: course.medicationName,
      status: courseCompleted ? 'completed' : course.status,
      totalDoses: course.totalDoses,
      unitsRemaining,
      startedAt: course.startedAt,
      doses,
      timeZone: patient.timezone,
      now: takenAt,
    }),
    courseCompleted,
  };
}

/** Push a dose back. The agent restarts its ladder from the new time. */
export async function snoozeDose(doseId: string, minutes = 30): Promise<DoseActionResult> {
  const dose = await collections.doses.requireById(doseId);
  if (dose.status === 'taken' || dose.status === 'taken_late') {
    throw new ConflictError('That dose is already recorded as taken');
  }

  const patient = await collections.patients.requireById(dose.patientId);
  const newTime = new Date(Date.now() + minutes * MINUTE_MS);

  const updated = await collections.doses.updateById(doseId, {
    scheduledAt: newTime,
    status: 'scheduled',
    rescheduledReason: `you asked for ${minutes} more minutes`,
  });

  // Clear the ladder; it restarts when the new time arrives.
  await settleEscalation(doseId, 'resolved', new Date());

  await logAgentEvent({
    patientId: dose.patientId,
    type: 'dose_rescheduled',
    occurredAt: new Date(),
    doseId,
    courseId: dose.courseId,
    conditionId: dose.conditionId,
    channel: 'internal',
    summary: rescheduledMessage(
      dose.scheduledAt,
      newTime,
      patient.timezone,
      `you asked for ${minutes} more minutes`,
    ),
    message: null,
    escalationNodeId: null,
    visibleToFamily: false,
  });

  return {
    dose: updated,
    message: `Fine — I'll remind you at ${formatClockTime(newTime, patient.timezone)}.`,
    courseProgress: null,
    courseCompleted: false,
  };
}

/**
 * The patient decides not to take this one.
 *
 * A skip is recorded honestly rather than quietly dropped, and it counts
 * against the streak — but the agent does not lecture, and the remaining doses
 * are replanned so the course can still be completed.
 */
export async function skipDose(doseId: string): Promise<DoseActionResult> {
  const dose = await collections.doses.requireById(doseId);
  if (dose.status === 'taken' || dose.status === 'taken_late') {
    throw new ConflictError('That dose is already recorded as taken');
  }

  const now = new Date();
  const updated = await collections.doses.updateById(doseId, { status: 'skipped' });
  await settleEscalation(doseId, 'resolved', now);

  const patient = await collections.patients.requireById(dose.patientId);
  await logAgentEvent({
    patientId: dose.patientId,
    type: 'dose_skipped',
    occurredAt: now,
    doseId,
    courseId: dose.courseId,
    conditionId: dose.conditionId,
    channel: 'internal',
    summary: `${formatClockTime(dose.scheduledAt, patient.timezone)} — ${dose.medicationName} skipped`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return {
    dose: updated,
    message: "Noted. Don't double up on the next one — take it as normal.",
    courseProgress: null,
    courseCompleted: false,
  };
}

/** Write a dose off as missed once the escalation ladder has run out. */
export async function markDoseMissed(doseId: string, at: Date = new Date()): Promise<Dose | null> {
  const dose = await collections.doses.findById(doseId);
  if (!dose) return null;
  if (dose.status !== 'due' && dose.status !== 'scheduled') return dose;

  const updated = await collections.doses.updateById(doseId, { status: 'missed' });
  const patient = await collections.patients.requireById(dose.patientId);

  await logAgentEvent({
    patientId: dose.patientId,
    type: 'dose_missed',
    occurredAt: at,
    doseId,
    courseId: dose.courseId,
    conditionId: dose.conditionId,
    channel: 'internal',
    summary: `${formatClockTime(dose.scheduledAt, patient.timezone)} — ${dose.medicationName} missed`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return updated;
}

/**
 * Move what is left of a course later so every dose still gets taken.
 *
 * The goal never changes: all 21 tablets. So after a miss the remaining doses
 * shift rather than one being dropped to protect the original end date — the
 * course simply finishes a little later.
 */
export async function replanCourse(
  courseId: string,
  shiftMinutes: number,
  reason: string,
): Promise<number> {
  if (shiftMinutes === 0) return 0;

  const course = await collections.courses.requireById(courseId);
  const patient = await collections.patients.requireById(course.patientId);
  const now = new Date();

  const upcoming = await collections.doses.find(
    { courseId, status: 'scheduled', scheduledAt: { $gt: now } },
    { sort: { scheduledAt: 1 } },
  );
  if (upcoming.length === 0) return 0;

  for (const dose of upcoming) {
    await collections.doses.updateById(dose._id, {
      scheduledAt: new Date(dose.scheduledAt.getTime() + shiftMinutes * MINUTE_MS),
      rescheduledReason: reason,
    });
  }

  const lastDose = upcoming.at(-1);
  if (lastDose) {
    await collections.courses.updateById(courseId, {
      expectedEndAt: new Date(lastDose.scheduledAt.getTime() + shiftMinutes * MINUTE_MS),
    });
  }

  await logAgentEvent({
    patientId: course.patientId,
    type: 'course_replanned',
    occurredAt: now,
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: `Moved the remaining ${upcoming.length} ${
      upcoming.length === 1 ? 'dose' : 'doses'
    } of ${course.medicationName} so you still finish the course`,
    message: rescheduledMessage(
      upcoming[0]!.scheduledAt,
      new Date(upcoming[0]!.scheduledAt.getTime() + shiftMinutes * MINUTE_MS),
      patient.timezone,
      reason,
    ),
    escalationNodeId: 'replan',
    visibleToFamily: true,
  });

  return upcoming.length;
}

/** Close a course once no dose is left outstanding. */
async function completeCourseIfFinished(
  course: Course,
  doses: readonly Dose[],
  at: Date,
): Promise<boolean> {
  if (course.status !== 'active') return false;
  if (course.totalDoses === null) return false;

  const outstanding = doses.filter((d) => d.status === 'scheduled' || d.status === 'due');
  if (outstanding.length > 0) return false;

  const takenCount = doses.filter((d) => d.status === 'taken' || d.status === 'taken_late').length;
  const completedInFull = takenCount >= course.totalDoses;

  await collections.courses.updateById(course._id, {
    status: completedInFull ? 'completed' : 'stopped_early',
    completedAt: at,
  });

  await logAgentEvent({
    patientId: course.patientId,
    type: completedInFull ? 'course_completed' : 'course_stopped',
    occurredAt: at,
    doseId: null,
    courseId: course._id,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: completedInFull
      ? `${course.medicationName} — course completed, all ${course.totalDoses} doses taken`
      : `${course.medicationName} — course ended with ${course.totalDoses - takenCount} doses not taken`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  await resolveConditionIfAllCoursesDone(course, at);
  return completedInFull;
}

/** When every course under a condition is finished, the condition is too. */
async function resolveConditionIfAllCoursesDone(course: Course, at: Date): Promise<void> {
  if (!course.conditionId) return;

  const siblings = await collections.courses.find({ conditionId: course.conditionId });
  const stillRunning = siblings.some((c) => c.status === 'active' || c.status === 'not_started');
  if (stillRunning) return;

  const condition = await collections.conditions.findById(course.conditionId);
  if (!condition || condition.isChronic || condition.status !== 'active') return;

  await collections.conditions.updateById(condition._id, { status: 'resolved', resolvedAt: at });
}

/** Consecutive misses on a course right now — drives the family short-circuit. */
export async function consecutiveMissesForCourse(courseId: string): Promise<number> {
  const doses = await collections.doses.find({ courseId }, { sort: { scheduledAt: 1 } });
  return countConsecutiveMisses(doses);
}
