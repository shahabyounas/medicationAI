import { z } from 'zod';
import { DateSchema, IdSchema, TimestampsSchema } from './common.js';

/**
 * How ill the patient feels today, on the one illness being treated.
 *
 * The record can currently say that twenty-one tablets went in and that the
 * condition was resolved — but "resolved" is inferred from the tablets running
 * out, not from anybody getting better. Nobody is ever asked. One tap a day is
 * what turns the course report from a pill count into an outcome, and it is
 * what makes the day 3–4 drop-off visible as a fact rather than a hypothesis:
 * the severity line falls, and that is the day the doses stop.
 */
export const SymptomEntrySchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  conditionId: IdSchema,
  recordedAt: DateSchema,
  /** 0 = completely well, 10 = as bad as it has been. */
  severity: z.number().int().min(0).max(10),
  note: z.string().trim().max(300).nullable().default(null),
});
export type SymptomEntry = z.infer<typeof SymptomEntrySchema>;

export const CreateSymptomEntrySchema = SymptomEntrySchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSymptomEntry = z.infer<typeof CreateSymptomEntrySchema>;

/** The words beside the number, so a 7 means the same thing on two days. */
export function describeSeverity(severity: number): string {
  if (severity === 0) return 'Completely well';
  if (severity <= 2) return 'Nearly back to normal';
  if (severity <= 4) return 'Getting better';
  if (severity <= 6) return 'Much the same';
  if (severity <= 8) return 'Pretty rough';
  return 'As bad as it has been';
}
