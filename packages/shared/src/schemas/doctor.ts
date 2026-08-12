import { z } from 'zod';
import { IdSchema, NonEmptyString, PhoneSchema, TimestampsSchema } from './common.js';

export const DoctorSpecialtySchema = z.enum([
  'general_practice',
  'internal_medicine',
  'cardiology',
  'endocrinology',
  'pulmonology',
  'gastroenterology',
  'urology',
  'ent',
  'dermatology',
  'orthopaedics',
  'paediatrics',
  'other',
]);
export type DoctorSpecialty = z.infer<typeof DoctorSpecialtySchema>;

export const SPECIALTY_LABELS: Record<DoctorSpecialty, string> = {
  general_practice: 'General practice',
  internal_medicine: 'Internal medicine',
  cardiology: 'Cardiology',
  endocrinology: 'Endocrinology',
  pulmonology: 'Chest and lungs',
  gastroenterology: 'Stomach and gut',
  urology: 'Urology',
  ent: 'Ear, nose and throat',
  dermatology: 'Skin',
  orthopaedics: 'Bones and joints',
  paediatrics: 'Children',
  other: 'Other',
};

export const ClinicSchema = z.object({
  name: NonEmptyString.max(160),
  addressLine: z.string().trim().max(240).optional(),
  phone: PhoneSchema.optional(),
});
export type Clinic = z.infer<typeof ClinicSchema>;

/**
 * A doctor the patient has actually seen. Created the first time a visit or a
 * prescription names them, then reused — so "Dr. Iqbal" is one record across
 * every condition he has treated, not a string repeated on each prescription.
 */
export const DoctorSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  name: NonEmptyString.max(120),
  specialty: DoctorSpecialtySchema.default('general_practice'),
  clinic: ClinicSchema,
  /** Medical council / GMC style registration number, when it is on the paper. */
  registrationNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type Doctor = z.infer<typeof DoctorSchema>;

export const CreateDoctorSchema = DoctorSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateDoctor = z.infer<typeof CreateDoctorSchema>;

export const UpdateDoctorSchema = CreateDoctorSchema.partial().omit({ patientId: true });
export type UpdateDoctor = z.infer<typeof UpdateDoctorSchema>;

/** A doctor plus the record the patient cares about: when, and for what. */
export const DoctorWithHistorySchema = DoctorSchema.extend({
  visitCount: z.number().int().min(0),
  prescriptionCount: z.number().int().min(0),
  lastVisitAt: z.coerce.date().nullable(),
  conditionsTreated: z.array(NonEmptyString),
});
export type DoctorWithHistory = z.infer<typeof DoctorWithHistorySchema>;
