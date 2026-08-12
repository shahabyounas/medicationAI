import { MINUTE_MS, type Channel } from '../schemas/common.js';
import type { EscalationNodeId } from '../schemas/escalation.js';

/**
 * The escalation ladder, as a graph.
 *
 * Everything about *when* and *how* the agent chases a dose is in this one
 * table. The runtime loop (`server/src/agent/runner.ts`) knows how to walk a
 * graph but nothing about the specific steps — so changing the policy, adding a
 * rung, or reordering channels is an edit here and nowhere else.
 *
 *   reminder_1 ─15m→ reminder_2 ─30m→ text_message ─75m→ check_in
 *        └─60m→ notify_family ─60m→ replan → exhausted
 *
 * Any node can jump straight to `resolved` when the patient confirms.
 */
export interface EscalationNode {
  readonly id: EscalationNodeId;
  /**
   * Minutes after the dose's due time at which this node fires.
   * Null on terminal nodes, which never fire.
   */
  readonly offsetMinutes: number | null;
  /** Null means the node acts on the plan without contacting anyone. */
  readonly channel: Channel | null;
  readonly next: EscalationNodeId | null;
  readonly terminal: boolean;
  /** Shown in the activity feed. */
  readonly label: string;
  readonly description: string;
}

export const ESCALATION_GRAPH: Readonly<Record<EscalationNodeId, EscalationNode>> = {
  reminder_1: {
    id: 'reminder_1',
    offsetMinutes: 0,
    channel: 'push',
    next: 'reminder_2',
    terminal: false,
    label: 'Reminder',
    description: 'Notification, and the dose waiting on the home screen',
  },
  reminder_2: {
    id: 'reminder_2',
    offsetMinutes: 15,
    channel: 'push',
    next: 'text_message',
    terminal: false,
    label: 'Second reminder',
    description: 'Names the medicine and why it matters today',
  },
  text_message: {
    id: 'text_message',
    offsetMinutes: 45,
    channel: 'sms',
    next: 'check_in',
    terminal: false,
    label: 'Text message',
    description: 'Reaches her even if the app is never opened',
  },
  check_in: {
    id: 'check_in',
    offsetMinutes: 120,
    channel: 'sms',
    next: 'notify_family',
    terminal: false,
    label: 'One-tap check-in',
    description: '"Did you take it? Yes / Not yet" — no need to open the app',
  },
  notify_family: {
    id: 'notify_family',
    offsetMinutes: 180,
    channel: 'family',
    next: 'replan',
    terminal: false,
    label: 'Family told',
    description: 'With context: which dose, which day, and what to say',
  },
  replan: {
    id: 'replan',
    offsetMinutes: 240,
    channel: 'internal',
    next: 'exhausted',
    terminal: false,
    label: 'Replan',
    description: 'Reschedules the remaining doses so the course still completes',
  },
  resolved: {
    id: 'resolved',
    offsetMinutes: null,
    channel: null,
    next: null,
    terminal: true,
    label: 'Confirmed',
    description: 'The dose was taken — the agent stops',
  },
  exhausted: {
    id: 'exhausted',
    offsetMinutes: null,
    channel: null,
    next: null,
    terminal: true,
    label: 'Exhausted',
    description: 'Every step was tried without a confirmation',
  },
};

/** The node the ladder starts on. */
export const ESCALATION_ENTRY_NODE: EscalationNodeId = 'reminder_1';

export function getNode(id: EscalationNodeId): EscalationNode {
  const node = ESCALATION_GRAPH[id];
  if (!node) throw new Error(`unknown escalation node: ${id}`);
  return node;
}

export function isTerminal(id: EscalationNodeId): boolean {
  return getNode(id).terminal;
}

/** The node after `id`, or null when `id` is terminal. */
export function nextNode(id: EscalationNodeId): EscalationNode | null {
  const { next } = getNode(id);
  return next ? getNode(next) : null;
}

/**
 * When the loop should run `nodeId` for a dose due at `dueAt`.
 * Returns null for terminal nodes, which are never scheduled.
 */
export function scheduledRunAt(dueAt: Date, nodeId: EscalationNodeId): Date | null {
  const { offsetMinutes } = getNode(nodeId);
  if (offsetMinutes === null) return null;
  return new Date(dueAt.getTime() + offsetMinutes * MINUTE_MS);
}

/**
 * The ladder in execution order, for display. Walks edges rather than listing
 * them again, so the UI can never drift from the policy above.
 */
export function escalationPath(): EscalationNode[] {
  const path: EscalationNode[] = [];
  const seen = new Set<EscalationNodeId>();
  let cursor: EscalationNodeId | null = ESCALATION_ENTRY_NODE;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = getNode(cursor);
    path.push(node);
    if (node.terminal) break;
    cursor = node.next;
  }
  return path;
}

/**
 * Whether the family should be pulled in early.
 *
 * The time ladder reaches `notify_family` at three hours, but a run of misses
 * is a stronger signal than a single slow afternoon — so a second consecutive
 * miss short-circuits straight to the family, matching the contact's own
 * threshold.
 */
export function shouldShortCircuitToFamily(
  consecutiveMisses: number,
  notifyAfterConsecutiveMisses: number,
): boolean {
  return consecutiveMisses >= notifyAfterConsecutiveMisses;
}
