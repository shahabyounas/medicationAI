import { z } from 'zod';
import { ChannelSchema, DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * Everything the agent does, written down.
 *
 * The design's promise is "every escalation is logged and visible to both of
 * them". This collection is that promise: the activity feed on the Today
 * screen and the family's audit trail are the same records, filtered
 * differently. Nothing the agent does is allowed to be invisible.
 */
export const AgentEventTypeSchema = z.enum([
  'course_planned',
  'reminder_sent',
  'escalated',
  'family_notified',
  'dose_taken',
  'dose_missed',
  'dose_skipped',
  'dose_rescheduled',
  'course_replanned',
  'course_completed',
  'course_stopped',
  'refill_warning',
  'adherence_note',
  'recurrence_detected',
]);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  type: AgentEventTypeSchema,
  /** When the event happened, as distinct from when the row was written. */
  occurredAt: DateSchema,
  doseId: IdSchema.nullable().default(null),
  courseId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  channel: ChannelSchema.nullable().default(null),
  /** One sentence, written for the patient to read. */
  summary: NonEmptyString.max(400),
  /** The message body actually delivered, when there was one. */
  message: z.string().trim().max(1000).nullable().default(null),
  /** Which escalation node produced this, when it came from the ladder. */
  escalationNodeId: z.string().trim().max(60).nullable().default(null),
  visibleToFamily: z.boolean().default(false),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const CreateAgentEventSchema = AgentEventSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateAgentEvent = z.infer<typeof CreateAgentEventSchema>;
