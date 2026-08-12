import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

export const ConditionStatusSchema = z.enum(['active', 'resolved', 'ongoing', 'recurred']);
export type ConditionStatus = z.infer<typeof ConditionStatusSchema>;

export const CONDITION_STATUS_LABELS: Record<ConditionStatus, string> = {
  active: 'Being treated',
  resolved: 'Resolved',
  ongoing: 'Ongoing',
  recurred: 'Came back',
};

/**
 * The thing being treated — "Chest infection", "Type 2 diabetes".
 *
 * Grouping medicines under a condition is what lets the app answer the question
 * the patient actually asks ("what is this one for?") and what lets the agent
 * notice a recurrence: a new condition with the same name, opened weeks after
 * an earlier one was stopped early.
 */
export const ConditionSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  name: NonEmptyString.max(160),
  /** One plain sentence the patient can read. No clinical language. */
  plainDescription: z.string().trim().max(400).optional(),
  status: ConditionStatusSchema.default('active'),
  startedAt: DateSchema,
  resolvedAt: DateSchema.nullable().default(null),
  /** The visit at which this condition was first diagnosed. */
  originVisitId: IdSchema.nullable().default(null),
  /** Set when this is a return of an earlier condition the agent recognised. */
  recurrenceOfConditionId: IdSchema.nullable().default(null),
  /** True for long-term conditions with no end date, e.g. diabetes. */
  isChronic: z.boolean().default(false),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const CreateConditionSchema = ConditionSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCondition = z.infer<typeof CreateConditionSchema>;

export const UpdateConditionSchema = CreateConditionSchema.partial().omit({ patientId: true });
export type UpdateCondition = z.infer<typeof UpdateConditionSchema>;
