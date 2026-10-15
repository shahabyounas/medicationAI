import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * A test result, as printed on the piece of paper.
 *
 * Deliberately transcription, not interpretation. `flag` is copied from the
 * report's own margin — the H or the L the lab printed — and is never computed
 * by comparing `numericValue` against `referenceRange`, because deciding that a
 * number is abnormal is the one thing this app must not do. The reference range
 * is stored as the text it was printed as for the same reason: ranges differ by
 * lab, by machine and by patient, and reconstructing one would be inventing
 * clinical detail nobody supplied.
 *
 * `numericValue` exists only so a repeated test can be drawn as a line. When
 * the result is "Negative" it stays null and the row is still a perfectly good
 * record.
 */
export const LabFlagSchema = z.enum(['low', 'normal', 'high', 'abnormal', 'unknown']);
export type LabFlag = z.infer<typeof LabFlagSchema>;

export const LAB_FLAG_LABELS: Record<LabFlag, string> = {
  low: 'Below the range on the report',
  normal: 'In the range on the report',
  high: 'Above the range on the report',
  abnormal: 'Marked abnormal on the report',
  unknown: 'No marking on the report',
};

export const LabResultItemSchema = z.object({
  id: IdSchema,
  /** "Haemoglobin", "HbA1c" — as written. */
  name: NonEmptyString.max(160),
  /** The value as printed, including "Negative" or "<0.5". */
  value: NonEmptyString.max(60),
  /** The same value as a number, when it is one. For the trend line only. */
  numericValue: z.number().nullable().default(null),
  unit: z.string().trim().max(40).nullable().default(null),
  /** The range printed beside it, verbatim. */
  referenceRange: z.string().trim().max(80).nullable().default(null),
  /** Copied from the report's own margin. Never worked out by the app. */
  flag: LabFlagSchema.default('unknown'),
});
export type LabResultItem = z.infer<typeof LabResultItemSchema>;

export const LabResultSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  /** "Blood count", "Thyroid function" — the heading on the report. */
  panelName: NonEmptyString.max(160),
  takenAt: DateSchema,
  reportedAt: DateSchema.nullable().default(null),
  doctorId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  visitId: IdSchema.nullable().default(null),
  items: z.array(LabResultItemSchema).min(1, 'a result needs at least one line'),
  /** What the doctor said about it, in the patient's words. */
  notes: z.string().trim().max(2000).nullable().default(null),
});
export type LabResult = z.infer<typeof LabResultSchema>;

export const CreateLabResultSchema = LabResultSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  items: z.array(LabResultItemSchema.omit({ id: true })).min(1),
});
export type CreateLabResult = z.infer<typeof CreateLabResultSchema>;
