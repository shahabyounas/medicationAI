import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * A jab, and when the next one is due.
 *
 * The only part of a health record that is routinely asked for by somebody
 * other than the patient — a pharmacist, a travel clinic, a new surgery — and
 * the only one where "I think it was about five years ago" is the usual answer.
 * `nextDueAt` makes it the one record that can also be reminded about, through
 * the same mechanism as an appointment.
 */
export const ImmunisationSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  /** "Flu", "Pneumococcal", "Covid-19" — as the patient knows it. */
  name: NonEmptyString.max(160),
  givenAt: DateSchema,
  /** "1st dose", "Booster", "Annual" — free text, as written on the card. */
  doseLabel: z.string().trim().max(60).nullable().default(null),
  /** Where it was given, e.g. "Left arm". */
  site: z.string().trim().max(60).nullable().default(null),
  batchNumber: z.string().trim().max(60).nullable().default(null),
  /** The clinic or pharmacy, which is often not a doctor on the record. */
  administeredBy: z.string().trim().max(160).nullable().default(null),
  doctorId: IdSchema.nullable().default(null),
  nextDueAt: DateSchema.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type Immunisation = z.infer<typeof ImmunisationSchema>;

export const CreateImmunisationSchema = ImmunisationSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateImmunisation = z.infer<typeof CreateImmunisationSchema>;
