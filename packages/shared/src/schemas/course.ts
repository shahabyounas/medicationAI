import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';
import { FrequencySchema } from './prescription.js';

export const CourseStatusSchema = z.enum([
  'not_started',
  'active',
  'completed',
  'stopped_early',
  'cancelled',
]);
export type CourseStatus = z.infer<typeof CourseStatusSchema>;

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  not_started: 'Not started',
  active: 'In progress',
  completed: 'Completed',
  stopped_early: 'Stopped early',
  cancelled: 'Cancelled',
};

/**
 * One prescription line, turned into a plan the agent can execute.
 *
 * This is where the agent's own state lives — the times it chose, the tablets
 * it has counted, the drift it has learned. Splitting it from `Prescription`
 * keeps the doctor's instruction immutable while the plan around it moves.
 */
/**
 * Whether a doctor wrote this down, or the patient decided it themselves.
 *
 * A self-managed course has no prescription behind it, which is why
 * `prescriptionId` had to become nullable: inventing a prescription for a
 * vitamin nobody prescribed would put a fake document in the one part of the
 * record that is meant to be a faithful copy of the paper.
 */
export const CourseOriginSchema = z.enum(['prescription', 'self']);
export type CourseOrigin = z.infer<typeof CourseOriginSchema>;

export const CourseSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  origin: CourseOriginSchema.default('prescription'),
  /** Null for a course the patient started themselves. */
  prescriptionId: IdSchema.nullable().default(null),
  prescriptionItemId: IdSchema.nullable().default(null),
  medicationId: IdSchema,
  medicationName: NonEmptyString.max(160),
  conditionId: IdSchema.nullable().default(null),
  status: CourseStatusSchema.default('not_started'),
  frequency: FrequencySchema,
  amountPerDose: z.number().positive().max(20),
  durationDays: z.number().int().min(1).max(365).nullable(),
  /** Null for open-ended courses, which have no last dose to reach. */
  totalDoses: z.number().int().min(1).nullable(),
  startedAt: DateSchema.nullable().default(null),
  expectedEndAt: DateSchema.nullable().default(null),
  completedAt: DateSchema.nullable().default(null),
  /** Counted down as doses are taken, so the agent can warn before running out. */
  unitsRemaining: z.number().min(0).nullable().default(null),
  /**
   * Minutes the patient habitually runs late, learned from taken-vs-scheduled.
   * The agent folds this into future reminder times.
   */
  learnedDriftMinutes: z.number().int().min(-240).max(240).default(0),
  /**
   * Why it ended before the last dose, in the patient's own words.
   *
   * A course could be `stopped_early` with nothing recorded about why, so the
   * record could not tell "I felt better" from "it was making me ill" — and
   * those are the two cases the whole product turns on.
   */
  stoppedReason: z.string().trim().max(300).nullable().default(null),
  /** Set when a side effect paused the chasing. The ladder stays off until cleared. */
  pausedAt: DateSchema.nullable().default(null),
  /**
   * Whether the agent chases this course at all.
   *
   * Always true for a prescription — that is the product. False for something
   * the patient added themselves and asked not to be nudged about, which is
   * most supplements. It is a separate field from `pausedAt` because the two
   * mean different things and are cleared by different people: a pause is the
   * agent standing down until a doctor has been spoken to, while this is the
   * patient saying they never wanted an alarm for their cod liver oil.
   *
   * It has to be on the course rather than inferred from "has no doses",
   * because an open-ended course with no doses is exactly what
   * `topUpOpenEndedCourses` exists to fill in — so without this the loop would
   * adopt a no-reminder supplement, plan a fortnight of doses for it, and start
   * escalating them to the patient's son.
   */
  remindersOn: z.boolean().default(true),
});
export type Course = z.infer<typeof CourseSchema>;

export const CreateCourseSchema = CourseSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCourse = z.infer<typeof CreateCourseSchema>;

/** A course with the counts the UI shows on a progress card. */
export const CourseProgressSchema = z.object({
  courseId: IdSchema,
  medicationName: NonEmptyString,
  status: CourseStatusSchema,
  totalDoses: z.number().int().nullable(),
  takenCount: z.number().int().min(0),
  missedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  remainingCount: z.number().int().min(0).nullable(),
  percentComplete: z.number().min(0).max(100),
  dayNumber: z.number().int().min(0).nullable(),
  unitsRemaining: z.number().min(0).nullable(),
  /** True while a reported side effect has the reminders paused. */
  paused: z.boolean().default(false),
});
export type CourseProgress = z.infer<typeof CourseProgressSchema>;
