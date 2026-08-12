import { z } from 'zod';
import { DateSchema, IdSchema, TimestampsSchema } from './common.js';

/**
 * The nodes of the escalation graph.
 *
 * Order is meaningful but not encoded here — the edges live in
 * `agent/graph.ts`, which is the single place the ladder is defined.
 */
export const EscalationNodeIdSchema = z.enum([
  'reminder_1',
  'reminder_2',
  'text_message',
  'check_in',
  'notify_family',
  'replan',
  /** Terminal: the patient confirmed. */
  'resolved',
  /** Terminal: the ladder ran out without a confirmation. */
  'exhausted',
]);
export type EscalationNodeId = z.infer<typeof EscalationNodeIdSchema>;

/**
 * The agent's working memory for one dose.
 *
 * Exactly one of these exists per dose the agent is chasing. The loop's whole
 * job is: find the rows whose `nextRunAt` has passed, run the node, advance to
 * the next one. Persisting the cursor here (rather than holding it in memory)
 * is what makes the loop restart-safe — a crash loses nothing but a tick.
 */
export const EscalationStateSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  doseId: IdSchema,
  courseId: IdSchema,
  /** Where in the ladder this dose currently sits. */
  currentNodeId: EscalationNodeIdSchema,
  /** When the loop should next act on this dose. Null once terminal. */
  nextRunAt: DateSchema.nullable(),
  /** The dose time the ladder offsets are measured from. */
  dueAt: DateSchema,
  /** Nodes already executed, oldest first — prevents re-firing after a restart. */
  history: z
    .array(
      z.object({
        nodeId: EscalationNodeIdSchema,
        ranAt: DateSchema,
      }),
    )
    .default([]),
  /** Consecutive misses on this course at the time the state was opened. */
  consecutiveMissesAtStart: z.number().int().min(0).default(0),
  /** Set when the state reached a terminal node. */
  settledAt: DateSchema.nullable().default(null),
});
export type EscalationState = z.infer<typeof EscalationStateSchema>;

export const CreateEscalationStateSchema = EscalationStateSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateEscalationState = z.infer<typeof CreateEscalationStateSchema>;
