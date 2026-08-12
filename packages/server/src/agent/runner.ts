import {
  MEDICATION_FORM_LABELS,
  MINUTE_MS,
  MISSED_AFTER_MINUTES,
  escalationMessage,
  familyAlertMessage,
  getNode,
  planDoses,
  shouldShortCircuitToFamily,
  type AgentEvent,
  type AgentEventType,
  type Course,
  type Dose,
  type EscalationState,
  type MessageContext,
  type Patient,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { logAgentEvent } from '../services/agentEventService.js';
import {
  consecutiveMissesForCourse,
  markDoseMissed,
  replanCourse,
} from '../services/doseService.js';
import { deliveryChannel } from './channels.js';
import {
  advanceEscalation,
  dueEscalations,
  jumpToFamily,
  openEscalation,
  settleEscalation,
} from './escalationStore.js';

/**
 * The agent loop.
 *
 * One tick does exactly two things:
 *
 *   1. **Activate** — any dose whose time has arrived becomes `due` and gets a
 *      fresh escalation ladder.
 *   2. **Advance** — any ladder whose next rung is due runs that rung and moves
 *      the cursor on.
 *
 * That is the whole engine. It knows how to walk a graph and nothing about what
 * the rungs are: the policy lives in `shared/agent/graph.ts`, so changing when
 * the family gets called is a data edit, not a change to this file. Every step
 * is driven off persisted state, so ticks are idempotent and a restart resumes
 * mid-ladder rather than starting over.
 */

export interface TickResult {
  ranAt: Date;
  statesExamined: number;
  actionsTaken: number;
  dosesMarkedMissed: number;
  events: AgentEvent[];
}

export async function tick(now: Date = new Date()): Promise<TickResult> {
  const events: AgentEvent[] = [];
  let dosesMarkedMissed = 0;

  await topUpOpenEndedCourses(now);
  const activated = await activateDueDoses(now);
  const states = await dueEscalations(now);

  let actionsTaken = 0;
  for (const state of states) {
    const outcome = await runNode(state, now);
    if (outcome.event) events.push(outcome.event);
    if (outcome.acted) actionsTaken += 1;
    if (outcome.markedMissed) dosesMarkedMissed += 1;
  }

  return {
    ranAt: now,
    statesExamined: states.length + activated,
    actionsTaken,
    dosesMarkedMissed,
    events,
  };
}

/** How far ahead an open-ended course keeps doses planned. */
const OPEN_ENDED_HORIZON_DAYS = 14;

/** Plan more doses when an open-ended course is running out of them. */
const OPEN_ENDED_TOP_UP_THRESHOLD = 7;

/**
 * Keep long-term medicines stocked with future doses.
 *
 * A course with no end date cannot have every dose planned up front — there is
 * no last one. So the planner lays down a horizon and the loop tops it up as it
 * is consumed. Without this a chronic medicine silently stops reminding once
 * its initial window runs out, which is the worst possible failure mode: no
 * error, just a patient who quietly stops taking their diabetes tablets.
 */
async function topUpOpenEndedCourses(now: Date): Promise<number> {
  const openEnded = await collections.courses.find({ status: 'active', totalDoses: null });
  let added = 0;

  for (const course of openEnded) {
    const upcoming = await collections.doses.count({
      courseId: course._id,
      scheduledAt: { $gt: now },
    });
    if (upcoming >= OPEN_ENDED_TOP_UP_THRESHOLD) continue;

    const patient = await collections.patients.findById(course.patientId);
    if (!patient) continue;

    const last = await collections.doses.find(
      { courseId: course._id },
      { sort: { scheduledAt: -1 }, limit: 1 },
    );
    const lastAt = last[0]?.scheduledAt ?? now;
    const planFrom = new Date(Math.max(lastAt.getTime() + MINUTE_MS, now.getTime()));

    const planned = planDoses({
      frequency: course.frequency,
      durationDays: null,
      mealtimes: patient.mealtimes,
      timeZone: patient.timezone,
      startAt: planFrom,
      openEndedDays: OPEN_ENDED_HORIZON_DAYS,
    });
    if (planned.length === 0) continue;

    const highestDoseNumber = last[0]?.doseNumber ?? 0;
    const startDay = last[0]?.dayNumber ?? 0;

    await collections.doses.insertMany(
      planned.map((dose) => ({
        patientId: course.patientId,
        courseId: course._id,
        conditionId: course.conditionId,
        medicationName: course.medicationName,
        doseNumber: highestDoseNumber + dose.doseNumber,
        dayNumber: startDay + dose.dayNumber,
        anchor: dose.anchor,
        originallyScheduledAt: dose.scheduledAt,
        scheduledAt: dose.scheduledAt,
        status: 'scheduled' as const,
        takenAt: null,
        amount: course.amountPerDose,
        confirmedVia: null,
        rescheduledReason: null,
      })),
    );
    added += planned.length;
  }
  return added;
}

/**
 * Promote scheduled doses whose time has come, and open a ladder for each.
 *
 * A dose only enters the agent's working set here, which keeps the hot query in
 * `dueEscalations` proportional to the doses actually in flight rather than to
 * every dose ever planned.
 */
async function activateDueDoses(now: Date): Promise<number> {
  const due = await collections.doses.find(
    { status: 'scheduled', scheduledAt: { $lte: now } },
    { sort: { scheduledAt: 1 }, limit: 100 },
  );

  const staleBefore = now.getTime() - MISSED_AFTER_MINUTES * MINUTE_MS;

  for (const dose of due) {
    // A dose whose whole escalation window has already elapsed — the server was
    // down, or the schedule was seeded in the past. Reminding someone about
    // yesterday's tablet is worse than useless, so record it and move on.
    if (dose.scheduledAt.getTime() < staleBefore) {
      await markDoseMissed(dose._id, now);
      continue;
    }

    await collections.doses.updateById(dose._id, { status: 'due' });
    await openEscalation({
      patientId: dose.patientId,
      doseId: dose._id,
      courseId: dose.courseId,
      dueAt: dose.scheduledAt,
      consecutiveMisses: await consecutiveMissesForCourse(dose.courseId),
    });
  }
  return due.length;
}

interface NodeOutcome {
  acted: boolean;
  markedMissed: boolean;
  event: AgentEvent | null;
}

const NO_ACTION: NodeOutcome = { acted: false, markedMissed: false, event: null };

async function runNode(state: EscalationState, now: Date): Promise<NodeOutcome> {
  const dose = await collections.doses.findById(state.doseId);

  // The dose was confirmed (or the course cancelled) between ticks.
  if (!dose) {
    await settleEscalation(state.doseId, 'resolved', now);
    return NO_ACTION;
  }
  if (dose.status !== 'due') {
    await settleEscalation(state.doseId, 'resolved', now);
    return NO_ACTION;
  }

  const course = await collections.courses.findById(dose.courseId);
  const patient = await collections.patients.findById(dose.patientId);
  if (!course || !patient) return NO_ACTION;

  // A run of misses is stronger evidence than a slow afternoon, so it can pull
  // the family rung forward — but only ever forward, never past it.
  const contact = patient.familyContacts[0];
  const alreadyPastFamily = state.history.some((h) => h.nodeId === 'notify_family');
  if (
    contact &&
    !alreadyPastFamily &&
    state.currentNodeId !== 'notify_family' &&
    shouldShortCircuitToFamily(
      state.consecutiveMissesAtStart,
      contact.notifyAfterConsecutiveMisses,
    )
  ) {
    state = await jumpToFamily(state, now);
  }

  const node = getNode(state.currentNodeId);
  const context = await buildMessageContext(patient, dose, course);

  let markedMissed = false;
  let event: AgentEvent | null = null;

  switch (node.id) {
    case 'reminder_1':
    case 'reminder_2':
    case 'text_message':
    case 'check_in': {
      const message = escalationMessage(node.id, context);
      await deliveryChannel.send({
        channel: node.channel ?? 'push',
        to: patient.phone,
        recipientName: patient.name,
        message,
        push: {
          patientId: patient._id,
          doseId: dose._id,
          title: node.id === 'reminder_1' ? 'Time for your medicine' : 'Your medicine is waiting',
          // One notification per dose: a second reminder replaces the first
          // rather than stacking up a wall of them on the lock screen.
          tag: `dose-${dose._id}`,
          // Every rung about an outstanding dose can be answered in one tap.
          actionable: true,
          urgent: true,
          escalationNodeId: node.id,
        },
      });
      event = await record(dose, course, node.id, 'reminder_sent', node.label, message, false);
      break;
    }

    case 'notify_family': {
      if (!contact) {
        // Nobody to escalate to — carry on down the ladder rather than stalling.
        event = await record(
          dose,
          course,
          node.id,
          'escalated',
          'No family contact to tell',
          null,
          true,
        );
        break;
      }
      const message = familyAlertMessage({ ...context, familyContactName: contact.name });
      await deliveryChannel.send({
        channel: 'family',
        to: contact.phone,
        recipientName: contact.name,
        message,
      });
      event = await record(
        dose,
        course,
        node.id,
        'family_notified',
        `Told ${contact.name} about your ${context.medicationName} dose`,
        message,
        true,
      );
      break;
    }

    case 'replan': {
      // The ladder is out of moves: write the dose off honestly, then move the
      // rest of the course so the patient can still finish every dose.
      await markDoseMissed(dose._id, now);
      markedMissed = true;

      const shiftMinutes = Math.max(30, course.frequency.timesPerDay >= 3 ? 30 : 60);
      await replanCourse(course._id, shiftMinutes, 'a dose was missed earlier');

      event = await record(
        dose,
        course,
        node.id,
        'course_replanned',
        node.description,
        escalationMessage('replan', context),
        true,
      );
      break;
    }

    case 'resolved':
    case 'exhausted':
      return NO_ACTION;
  }

  await advanceEscalation(state, now);
  return { acted: true, markedMissed, event };
}

async function record(
  dose: Dose,
  course: Course,
  nodeId: string,
  type: AgentEventType,
  summary: string,
  message: string | null,
  visibleToFamily: boolean,
): Promise<AgentEvent> {
  return logAgentEvent({
    patientId: dose.patientId,
    type,
    occurredAt: new Date(),
    doseId: dose._id,
    courseId: course._id,
    conditionId: dose.conditionId,
    channel: getNode(nodeId as never).channel,
    summary,
    message,
    escalationNodeId: nodeId,
    visibleToFamily,
  });
}

async function buildMessageContext(
  patient: Patient,
  dose: Dose,
  course: Course,
): Promise<MessageContext> {
  const medication = await collections.medications.findById(course.medicationId);
  const condition = dose.conditionId
    ? await collections.conditions.findById(dose.conditionId)
    : null;
  const prescription = await collections.prescriptions.findById(course.prescriptionId);
  const doctor = prescription ? await collections.doctors.findById(prescription.doctorId) : null;

  const takenCount = await collections.doses.count({
    courseId: course._id,
    status: { $in: ['taken', 'taken_late'] },
  });

  return {
    patientName: patient.name.split(' ')[0] ?? patient.name,
    medicationName: course.medicationName,
    amount: dose.amount,
    unitLabel: MEDICATION_FORM_LABELS[medication?.form ?? 'tablet'],
    scheduledAt: dose.scheduledAt,
    timeZone: patient.timezone,
    doseNumber: dose.doseNumber,
    totalDoses: course.totalDoses,
    dosesRemaining: course.totalDoses === null ? null : Math.max(0, course.totalDoses - takenCount),
    dayNumber: dose.dayNumber,
    durationDays: course.durationDays,
    doctorName: doctor?.name ?? null,
    conditionName: condition?.name ?? null,
    familyContactName: patient.familyContacts[0]?.name ?? null,
  };
}

/**
 * Runs `tick` on an interval.
 *
 * Ticks never overlap: a slow tick delays the next one rather than running two
 * concurrently, which would double-send reminders.
 */
export class AgentLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(private readonly intervalMs: number) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
    console.log(`[agent] loop started, ticking every ${this.intervalMs}ms`);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runOnce(), this.intervalMs);
  }

  private async runOnce(): Promise<void> {
    if (this.running) return this.schedule();
    this.running = true;
    try {
      const result = await tick();
      if (result.actionsTaken > 0) {
        console.log(
          `[agent] tick: ${result.actionsTaken} action(s), ${result.dosesMarkedMissed} missed`,
        );
      }
    } catch (error) {
      // A failing tick must not kill the loop — the next one may well succeed.
      console.error('[agent] tick failed:', error);
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
