import {
  COURSE_STATUS_LABELS,
  MEDICATION_FORM_UNITS,
  MINUTE_MS,
  ON_TIME_GRACE_MINUTES,
  afterTakeMessage,
  anchorTime,
  buildCourseProgress,
  countConsecutiveMisses,
  formatClockTime,
  learnDriftMinutes,
  describeUnits,
  needsRefillWarning,
  refillCollectedMessage,
  refillWarningMessage,
  rescheduledMessage,
  timeOnDay,
  type Course,
  type CourseProgress,
  type Dose,
  type Mealtimes,
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
    const medication = await collections.medications.findById(course.medicationId);
    await logAgentEvent({
      patientId: dose.patientId,
      type: 'refill_warning',
      occurredAt: takenAt,
      doseId: null,
      courseId: course._id,
      conditionId: dose.conditionId,
      channel: 'push',
      summary: refillWarningMessage(unitsRemaining, course.medicationName, medication?.form ?? 'tablet'),
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
export async function skipDose(
  doseId: string,
  reason?: string,
): Promise<DoseActionResult> {
  const dose = await collections.doses.requireById(doseId);
  if (dose.status === 'taken' || dose.status === 'taken_late') {
    throw new ConflictError('That dose is already recorded as taken');
  }

  const now = new Date();
  const updated = await collections.doses.updateById(doseId, {
    status: 'skipped',
    skipReason: reason ?? null,
  });
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
    summary: `${formatClockTime(dose.scheduledAt, patient.timezone)} — ${
      dose.medicationName
    } skipped${reason ? ` (${reason})` : ''}`,
    message: reason ?? null,
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

/**
 * "I've collected more."
 *
 * `needsRefillWarning` and `unitsRemaining` have existed from the start, and
 * nothing in the app ever put units *back*. So the warning fired once and could
 * never be cleared: the patient was told they were running out every time they
 * took a tablet, for the rest of the course, having already been to the chemist.
 *
 * The count is what the patient says it is rather than something added to a
 * previous figure, because the only reliable way to know how many tablets are
 * in a house is for somebody to look in the packet and count them.
 */
export async function recordRefill(
  courseId: string,
  unitsNow: number,
): Promise<{ unitsRemaining: number; dosesRemaining: number; message: string }> {
  const course = await collections.courses.requireById(courseId);
  const medication = await collections.medications.findById(course.medicationId);
  const form = medication?.form ?? 'tablet';

  await collections.courses.updateById(courseId, { unitsRemaining: unitsNow });

  const dosesRemaining = await collections.doses.count({
    courseId,
    status: { $in: ['scheduled', 'due'] },
  });

  const message = refillCollectedMessage({
    medicationName: course.medicationName,
    unitsNow,
    dosesRemaining,
    unit: unitsNow === 1 ? MEDICATION_FORM_UNITS[form].one : MEDICATION_FORM_UNITS[form].many,
  });

  await logAgentEvent({
    patientId: course.patientId,
    type: 'refill_collected',
    occurredAt: new Date(),
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: `${course.medicationName} — ${describeUnits(unitsNow, form)} on the shelf`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return { unitsRemaining: unitsNow, dosesRemaining, message };
}

/**
 * End a prescribed course before its last dose.
 *
 * The agent does not decide this and the app does not advise it — but a patient
 * whose doctor has told them to stop needs somewhere to say so, and the
 * alternative is that they simply stop answering and the ladder chases them
 * through every rung to their son. The reason is recorded because
 * `stopped_early` with nothing attached is what made "I felt better" and "it
 * was making me ill" indistinguishable on the record.
 */
export async function stopCourse(
  courseId: string,
  reason: string | undefined,
  now = new Date(),
): Promise<{ message: string; dosesCancelled: number }> {
  const course = await collections.courses.requireById(courseId);
  if (course.status !== 'active' && course.status !== 'not_started') {
    throw new ConflictError(`That course is already ${COURSE_STATUS_LABELS[course.status].toLowerCase()}`);
  }

  const outstanding = await collections.doses.find({
    courseId,
    status: { $in: ['scheduled', 'due'] },
  });
  for (const dose of outstanding) {
    await settleEscalation(dose._id, 'resolved', now);
  }
  await collections.doses.deleteMany({ courseId, status: { $in: ['scheduled', 'due'] } });

  const takenCount = await collections.doses.count({
    courseId,
    status: { $in: ['taken', 'taken_late'] },
  });

  await collections.courses.updateById(courseId, {
    status: 'stopped_early',
    completedAt: now,
    stoppedReason: reason ?? null,
    pausedAt: null,
  });

  await logAgentEvent({
    patientId: course.patientId,
    type: 'course_stopped',
    occurredAt: now,
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary:
      course.totalDoses === null
        ? `${course.medicationName} stopped after ${takenCount} ${
            takenCount === 1 ? 'dose' : 'doses'
          }${reason ? ` — ${reason}` : ''}`
        : `${course.medicationName} stopped with ${
            course.totalDoses - takenCount
          } of ${course.totalDoses} doses not taken${reason ? ` — ${reason}` : ''}`,
    message: reason ?? null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return {
    message: `${course.medicationName} stopped. It stays on your record, with the reason.`,
    dosesCancelled: outstanding.length,
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

/**
 * Move every dose still to come onto new mealtimes.
 *
 * Changing when you eat is the one setting that moves every reminder, because
 * the whole schedule is anchored to breakfast, lunch and supper. So it cannot be
 * a stored preference that only affects the next prescription — the course
 * already running has to follow, or the app is reminding you at times you have
 * just told it are wrong.
 *
 * This re-anchors rather than shifting by a fixed amount, which is what
 * `replanCourse` does: supper moving an hour later must not drag breakfast with
 * it. Each dose's offset from its own anchor is measured against the *old*
 * mealtimes and preserved, so a dose timed half an hour after food stays half an
 * hour after food, and a dose an earlier replan had already pushed back keeps
 * that push.
 *
 * Doses already taken, missed or skipped are history and are left alone.
 */
export async function reanchorToMealtimes(
  patientId: string,
  previous: Mealtimes,
  next: Mealtimes,
  now = new Date(),
): Promise<number> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const upcoming = await collections.doses.find(
    { patientId, status: 'scheduled', scheduledAt: { $gt: now } },
    { sort: { scheduledAt: 1 } },
  );
  if (upcoming.length === 0) return 0;

  const touchedCourseIds = new Set<string>();
  let moved = 0;

  for (const dose of upcoming) {
    // The day is read off the dose's own scheduled time, so a dose sitting on
    // tomorrow re-anchors against tomorrow's breakfast rather than today's.
    const was = timeOnDay(dose.scheduledAt, 0, anchorTime(dose.anchor, previous), tz);
    const willBe = timeOnDay(dose.scheduledAt, 0, anchorTime(dose.anchor, next), tz);
    const offsetMs = dose.scheduledAt.getTime() - was.getTime();
    const scheduledAt = new Date(willBe.getTime() + offsetMs);

    if (scheduledAt.getTime() === dose.scheduledAt.getTime()) continue;

    await collections.doses.updateById(dose._id, {
      scheduledAt,
      rescheduledReason: 'you changed your mealtimes',
    });
    touchedCourseIds.add(dose.courseId);
    moved += 1;
  }

  if (moved === 0) return 0;

  // The end of a course is the last dose in it, which may have just moved.
  for (const courseId of touchedCourseIds) {
    const last = await collections.doses.findOne(
      { courseId },
      { sort: { scheduledAt: -1 } },
    );
    if (last) await collections.courses.updateById(courseId, { expectedEndAt: last.scheduledAt });
  }

  await logAgentEvent({
    patientId,
    type: 'course_replanned',
    occurredAt: now,
    doseId: null,
    courseId: null,
    conditionId: null,
    channel: 'internal',
    summary: `Moved ${moved} ${moved === 1 ? 'dose' : 'doses'} to fit your new mealtimes`,
    message: `You changed your mealtimes, so I moved the ${moved} ${
      moved === 1 ? 'dose' : 'doses'
    } still to come. Nothing was dropped.`,
    escalationNodeId: null,
    visibleToFamily: false,
  });

  return moved;
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
