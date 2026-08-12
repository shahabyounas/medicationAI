import {
  ESCALATION_ENTRY_NODE,
  getNode,
  scheduledRunAt,
  type EscalationNodeId,
  type EscalationState,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';

/**
 * Persistence for the agent's position in the escalation graph.
 *
 * The cursor lives in the database rather than in memory so the loop is
 * restart-safe: a crash mid-ladder costs one tick, not the whole escalation.
 */

/** Open a ladder for a dose that has just come due. Idempotent. */
export async function openEscalation(input: {
  patientId: string;
  doseId: string;
  courseId: string;
  dueAt: Date;
  consecutiveMisses: number;
}): Promise<EscalationState> {
  const existing = await collections.escalationStates.findOne({ doseId: input.doseId });
  if (existing) return existing;

  return collections.escalationStates.insert({
    patientId: input.patientId,
    doseId: input.doseId,
    courseId: input.courseId,
    currentNodeId: ESCALATION_ENTRY_NODE,
    // The entry node fires at the dose time itself, but a dose activated late
    // (a slow tick, a restart) should still fire immediately rather than
    // appearing to be overdue for a reminder that never went out.
    nextRunAt: laterOf(scheduledRunAt(input.dueAt, ESCALATION_ENTRY_NODE), input.dueAt),
    dueAt: input.dueAt,
    history: [],
    consecutiveMissesAtStart: input.consecutiveMisses,
    settledAt: null,
  });
}

function laterOf(a: Date | null, b: Date): Date {
  if (!a) return b;
  return a.getTime() > b.getTime() ? a : b;
}

/** Every ladder whose next step is due. The loop's hot query. */
export async function dueEscalations(now: Date, limit = 100): Promise<EscalationState[]> {
  return collections.escalationStates.find(
    { nextRunAt: { $ne: null, $lte: now } },
    { sort: { nextRunAt: 1 }, limit },
  );
}

/** Record that a node ran, and point the cursor at the next one. */
export async function advanceEscalation(
  state: EscalationState,
  ranAt: Date,
): Promise<EscalationState> {
  const current = getNode(state.currentNodeId);
  const history = [...state.history, { nodeId: state.currentNodeId, ranAt }];

  if (current.next === null) {
    return collections.escalationStates.updateById(state._id, {
      history,
      nextRunAt: null,
      settledAt: ranAt,
    });
  }

  const next = getNode(current.next);
  if (next.terminal) {
    return collections.escalationStates.updateById(state._id, {
      currentNodeId: next.id,
      history,
      nextRunAt: null,
      settledAt: ranAt,
    });
  }

  // Never schedule the next rung in the past: if the loop is catching up after
  // downtime it should work through the ladder in order, not fire it all at once.
  const plannedAt = scheduledRunAt(state.dueAt, next.id);
  return collections.escalationStates.updateById(state._id, {
    currentNodeId: next.id,
    history,
    nextRunAt: laterOf(plannedAt, ranAt),
  });
}

/** Jump straight to a terminal node — the patient confirmed, or gave up. */
export async function settleEscalation(
  doseId: string,
  terminalNode: Extract<EscalationNodeId, 'resolved' | 'exhausted'>,
  at: Date = new Date(),
): Promise<void> {
  const state = await collections.escalationStates.findOne({ doseId });
  if (!state || state.settledAt !== null) return;

  await collections.escalationStates.updateById(state._id, {
    currentNodeId: terminalNode,
    nextRunAt: null,
    settledAt: at,
  });
}

/** Force the ladder to the family rung, skipping the rest of the timings. */
export async function jumpToFamily(state: EscalationState, at: Date): Promise<EscalationState> {
  return collections.escalationStates.updateById(state._id, {
    currentNodeId: 'notify_family',
    nextRunAt: at,
  });
}

export async function escalationForDose(doseId: string): Promise<EscalationState | null> {
  return collections.escalationStates.findOne({ doseId });
}
