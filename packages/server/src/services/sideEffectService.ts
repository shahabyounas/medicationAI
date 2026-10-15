import {
  SIDE_EFFECT_SEVERITY_LABELS,
  chasingResumedMessage,
  formatDayMonth,
  shouldPauseChasing,
  sideEffectEventSummary,
  sideEffectResponse,
  type ReportSideEffectRequest,
  type ReportSideEffectResponse,
  type SideEffectReport,
  type SideEffectView,
  type SideEffectsResponse,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { logAgentEvent } from './agentEventService.js';
import { settleEscalation } from '../agent/escalationStore.js';

/**
 * "This medicine is making me feel worse."
 *
 * The agent has one intervention for a patient who stops a course — the day 3–4
 * nudge — and it is built for the patient who stopped because the symptom went
 * away. The other reason people stop is that the medicine is making them ill,
 * and the right response to that is the opposite one: stop nudging, and put the
 * prescriber in front of them.
 *
 * Reporting one therefore does three things, in this order, because each is a
 * promise the copy then makes out loud:
 *
 *   1. writes the report, against the medicine rather than the course, so it
 *      survives the course ending and shows up next time it is prescribed;
 *   2. pauses the chasing when the report warrants it — cancels the ladder on
 *      every dose still outstanding and marks the course `pausedAt`, so no tick
 *      can re-open one;
 *   3. hands back the prescriber's actual phone number.
 *
 * What it does not do is decide anything clinical. It does not stop the course,
 * because stopping a course of antibiotics halfway is itself a clinical act with
 * consequences — that is why the whole product exists. It pauses the *reminders*
 * and says who to ring. The doses stay on the record as scheduled, so if the
 * doctor says carry on, nothing has been thrown away.
 */
export async function reportSideEffect(
  input: ReportSideEffectRequest,
  now = new Date(),
): Promise<ReportSideEffectResponse> {
  const patient = await collections.patients.requireById(input.patientId);

  const course = input.courseId ? await collections.courses.findById(input.courseId) : null;
  if (input.courseId && !course) {
    throw new BadRequestError('That course is not on your record');
  }
  if (course && course.patientId !== patient._id) {
    throw new BadRequestError('That course belongs to a different patient');
  }

  const medicationName = course?.medicationName ?? input.medicationName;
  if (!medicationName) {
    throw new BadRequestError('Say which medicine it is, or pick one from your list');
  }

  const pause = shouldPauseChasing({
    severity: input.severity,
    stoppedTaking: input.stoppedTaking,
  });

  const report = await collections.sideEffects.insert({
    patientId: patient._id,
    courseId: course?._id ?? null,
    medicationName,
    conditionId: course?.conditionId ?? null,
    symptom: input.symptom,
    severity: input.severity,
    startedAt: input.startedAt,
    reportedAt: now,
    stoppedTaking: input.stoppedTaking,
    doctorInformedAt: null,
    resolvedAt: null,
    notes: input.notes ?? null,
  });

  // Who to ring. A self-managed medicine has no prescriber, in which case the
  // copy falls back to "the doctor who prescribed it" and offers no number —
  // which is the truth, and better than offering the wrong doctor's.
  const prescription = course?.prescriptionId
    ? await collections.prescriptions.findById(course.prescriptionId)
    : null;
  const doctor = prescription ? await collections.doctors.findById(prescription.doctorId) : null;

  let dosesCancelled = 0;
  if (pause && course) {
    dosesCancelled = await pauseChasing(course._id, now);
  }

  const reply = sideEffectResponse({
    medicationName,
    symptom: input.symptom,
    severity: input.severity,
    doctorName: doctor?.name ?? null,
    doctorPhone: doctor?.clinic.phone ?? null,
  });

  await logAgentEvent({
    patientId: patient._id,
    type: 'side_effect_reported',
    occurredAt: now,
    doseId: null,
    courseId: course?._id ?? null,
    conditionId: course?.conditionId ?? null,
    channel: 'internal',
    summary: sideEffectEventSummary(medicationName, input.symptom, input.severity),
    message: reply.body,
    escalationNodeId: null,
    // The family rung exists for a patient who has gone quiet. A patient who
    // has reported a reaction has not gone quiet, so this is not an escalation
    // — but it is the kind of thing a carer should be able to see happened.
    visibleToFamily: true,
  });

  return {
    reportId: report._id,
    headline: reply.headline,
    body: reply.body,
    action: reply.action,
    doctorPhone: doctor?.clinic.phone ?? null,
    chasingPaused: pause && course !== null,
    dosesCancelled,
  };
}

/**
 * Stop the agent chasing this course, without touching the doses.
 *
 * Settling each outstanding ladder is not enough on its own: the runner
 * activates any dose whose time has come and opens a fresh ladder for it, so a
 * paused course with no marker would start chasing again on the next tick.
 * `pausedAt` on the course is what the runner checks.
 */
async function pauseChasing(courseId: string, now: Date): Promise<number> {
  const outstanding = await collections.doses.find({
    courseId,
    status: { $in: ['due', 'scheduled'] },
  });

  for (const dose of outstanding) {
    await settleEscalation(dose._id, 'resolved', now);
  }

  await collections.courses.updateById(courseId, { pausedAt: now });

  const course = await collections.courses.requireById(courseId);
  await logAgentEvent({
    patientId: course.patientId,
    type: 'chasing_paused',
    occurredAt: now,
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: `Stopped reminding about ${course.medicationName} until you've spoken to someone`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return outstanding.length;
}

/** Put the reminders back on — the doctor said carry on. */
export async function resumeChasing(courseId: string, now = new Date()): Promise<string> {
  const course = await collections.courses.requireById(courseId);
  if (course.pausedAt === null) {
    return chasingResumedMessage(course.medicationName);
  }

  await collections.courses.updateById(courseId, { pausedAt: null });
  await logAgentEvent({
    patientId: course.patientId,
    type: 'chasing_resumed',
    occurredAt: now,
    doseId: null,
    courseId,
    conditionId: course.conditionId,
    channel: 'internal',
    summary: `Reminders for ${course.medicationName} are back on`,
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return chasingResumedMessage(course.medicationName);
}

/** "It settled down", or "I've spoken to the doctor". */
export async function updateSideEffect(
  reportId: string,
  input: { resolved: boolean; doctorInformed: boolean },
  now = new Date(),
): Promise<SideEffectReport> {
  const report = await collections.sideEffects.requireById(reportId);

  return collections.sideEffects.updateById(reportId, {
    ...(input.resolved && report.resolvedAt === null ? { resolvedAt: now } : {}),
    ...(input.doctorInformed && report.doctorInformedAt === null
      ? { doctorInformedAt: now }
      : {}),
  });
}

export async function buildSideEffects(
  patientId: string,
  now = new Date(),
): Promise<SideEffectsResponse> {
  const patient = await collections.patients.requireById(patientId);
  const reports = await collections.sideEffects.find(
    { patientId },
    { sort: { reportedAt: -1 } },
  );

  const views = await Promise.all(
    reports.map((report) => toSideEffectView(report, patient.timezone)),
  );

  /**
   * One row per medicine, worst severity first.
   *
   * This is the list that is actually asked for — at the pharmacy counter, on a
   * new-patient form, by a doctor about to write the same prescription again —
   * and it is the reason a report is filed against the medicine's name rather
   * than only against the course. The course ends; the fact that amoxicillin
   * brought this patient out in a rash does not.
   */
  const byName = new Map<string, SideEffectView[]>();
  for (const view of views) {
    const key = view.medicationName.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), view]);
  }

  const rank = { mild: 0, moderate: 1, severe: 2 } as const;
  const byMedication = [...byName.values()]
    .map((group) => {
      const worst = group.reduce(
        (worstSoFar, report) =>
          rank[report.severity] > rank[worstSoFar.severity] ? report : worstSoFar,
        group[0]!,
      );
      const lastReportedAt = group.reduce(
        (latest, report) => (report.reportedAt > latest ? report.reportedAt : latest),
        group[0]!.reportedAt,
      );
      return {
        medicationName: group[0]!.medicationName,
        reportCount: group.length,
        worstSeverity: worst.severity,
        symptoms: [...new Set(group.map((report) => report.symptom))],
        lastReportedAt,
      };
    })
    .sort(
      (a, b) =>
        rank[b.worstSeverity] - rank[a.worstSeverity] ||
        b.lastReportedAt.getTime() - a.lastReportedAt.getTime(),
    );

  return {
    open: views.filter((view) => view.resolvedAt === null),
    settled: views.filter((view) => view.resolvedAt !== null),
    byMedication,
  };
}

/** Open reports, for the screens that show them above everything else. */
export async function openSideEffectsFor(patientId: string): Promise<SideEffectReport[]> {
  return collections.sideEffects.find(
    { patientId, resolvedAt: null },
    { sort: { reportedAt: -1 } },
  );
}

async function toSideEffectView(
  report: SideEffectReport,
  timeZone: string,
): Promise<SideEffectView> {
  const course = report.courseId ? await collections.courses.findById(report.courseId) : null;
  const condition = report.conditionId
    ? await collections.conditions.findById(report.conditionId)
    : null;

  return {
    ...report,
    severityLabel: SIDE_EFFECT_SEVERITY_LABELS[report.severity],
    startedLabel: formatDayMonth(report.startedAt, timeZone),
    conditionName: condition?.name ?? null,
    courseStatus: course?.status ?? null,
    stillTaking: course?.status === 'active' && course.pausedAt === null,
  };
}
