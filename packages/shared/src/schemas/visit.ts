import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

export const VisitTypeSchema = z.enum([
  'consultation',
  'follow_up',
  'emergency',
  'routine_check',
  'telephone',
]);
export type VisitType = z.infer<typeof VisitTypeSchema>;

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  consultation: 'Consultation',
  follow_up: 'Follow-up',
  emergency: 'Emergency',
  routine_check: 'Routine check',
  telephone: 'Phone consultation',
};

/**
 * One appointment with one doctor, on one date.
 *
 * A visit is the origin of everything downstream: it names the condition being
 * treated and it is what a prescription hangs off. Keeping it separate from the
 * prescription means the record survives even when a visit produced no
 * medicine at all — which is most routine checks.
 */
export const VisitSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  doctorId: IdSchema,
  visitDate: DateSchema,
  type: VisitTypeSchema.default('consultation'),
  /** What the patient came in with, in their own words. */
  reason: NonEmptyString.max(500),
  /** What the doctor concluded. Becomes the condition name when one is opened. */
  diagnosis: z.string().trim().max(500).optional(),
  /** The condition this visit relates to, once one exists. */
  conditionId: IdSchema.nullable().default(null),
  notes: z.string().trim().max(4000).optional(),
  followUpDate: DateSchema.nullable().default(null),
  /** Free-text vitals as written on the notes — never interpreted by the agent. */
  vitals: z
    .object({
      bloodPressure: z.string().trim().max(20).optional(),
      temperatureC: z.number().min(25).max(45).optional(),
      pulseBpm: z.number().int().min(20).max(250).optional(),
      weightKg: z.number().min(1).max(400).optional(),
    })
    .optional(),
});
export type Visit = z.infer<typeof VisitSchema>;

export const CreateVisitSchema = VisitSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateVisit = z.infer<typeof CreateVisitSchema>;

export const UpdateVisitSchema = CreateVisitSchema.partial().omit({
  patientId: true,
});
export type UpdateVisit = z.infer<typeof UpdateVisitSchema>;

/** A visit joined to the doctor who saw the patient and what it produced. */
export const VisitDetailSchema = VisitSchema.extend({
  doctorName: NonEmptyString,
  doctorSpecialty: NonEmptyString,
  clinicName: NonEmptyString,
  conditionName: z.string().nullable(),
  prescriptionIds: z.array(IdSchema),
  medicationNames: z.array(NonEmptyString),
});
export type VisitDetail = z.infer<typeof VisitDetailSchema>;
