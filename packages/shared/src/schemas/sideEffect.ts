import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * "This medicine is making me feel worse."
 *
 * The agent's whole thesis is that a course should be finished, and its one
 * intervention is the day 3–4 nudge for the patient who stopped because the
 * symptom went away. But that is only one of the two reasons people stop. The
 * other is that the medicine itself is making them ill — and the two need
 * opposite responses. Without this record the agent chases both identically,
 * which means nagging somebody through a reaction.
 *
 * So a report does three things: it stops the chasing for that course, it puts
 * the prescriber's phone number in front of the patient, and it stays on the
 * record against the medicine so the next prescription is not a surprise.
 */
export const SideEffectSeveritySchema = z.enum(['mild', 'moderate', 'severe']);
export type SideEffectSeverity = z.infer<typeof SideEffectSeveritySchema>;

export const SIDE_EFFECT_SEVERITY_LABELS: Record<SideEffectSeverity, string> = {
  mild: 'Annoying, but bearable',
  moderate: 'Hard to put up with',
  severe: 'Bad — I need help',
};

/**
 * Starting points, not a diagnosis list.
 *
 * Offering the words saves a patient in her seventies typing them on a phone,
 * and keeps the record searchable. Anything not here goes in free text; the
 * app never maps either onto a clinical term.
 */
export const COMMON_SIDE_EFFECTS: readonly string[] = [
  'Feeling sick',
  'Being sick',
  'Upset stomach',
  'Diarrhoea',
  'Headache',
  'Dizzy or light-headed',
  'Rash or itching',
  'Swelling',
  'Very tired',
  'Trouble sleeping',
  'Dry mouth',
  'Muscle aches',
];

export const SideEffectReportSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  /** The course it is blamed on. Null when the patient cannot say which. */
  courseId: IdSchema.nullable().default(null),
  medicationName: NonEmptyString.max(160),
  conditionId: IdSchema.nullable().default(null),
  /** The patient's own words, or one of `COMMON_SIDE_EFFECTS`. */
  symptom: NonEmptyString.max(200),
  severity: SideEffectSeveritySchema,
  startedAt: DateSchema,
  reportedAt: DateSchema,
  /** True when the patient has already stopped taking it. */
  stoppedTaking: z.boolean().default(false),
  /** Set once the patient says they have spoken to the prescriber. */
  doctorInformedAt: DateSchema.nullable().default(null),
  /** Set when the patient says it has settled down. */
  resolvedAt: DateSchema.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type SideEffectReport = z.infer<typeof SideEffectReportSchema>;

export const CreateSideEffectReportSchema = SideEffectReportSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSideEffectReport = z.infer<typeof CreateSideEffectReportSchema>;

/**
 * Whether a report is the kind that should stop the agent chasing.
 *
 * A mild, ongoing side effect is a note on the record; the course continues and
 * the reminders with it. Anything worse, or anything the patient has already
 * acted on by stopping, means the ladder has no business running — the next
 * move belongs to the prescriber.
 */
export function shouldPauseChasing(report: {
  severity: SideEffectSeverity;
  stoppedTaking: boolean;
}): boolean {
  return report.stoppedTaking || report.severity !== 'mild';
}
