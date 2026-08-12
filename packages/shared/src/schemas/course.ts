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
export const CourseSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  prescriptionId: IdSchema,
  prescriptionItemId: IdSchema,
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
});
export type CourseProgress = z.infer<typeof CourseProgressSchema>;
