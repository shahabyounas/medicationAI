import { z } from 'zod';
import { IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

export const MedicationFormSchema = z.enum([
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'inhaler',
  'drops',
  'cream',
]);
export type MedicationForm = z.infer<typeof MedicationFormSchema>;

export const MEDICATION_FORM_LABELS: Record<MedicationForm, string> = {
  tablet: 'tablet',
  capsule: 'capsule',
  liquid: 'dose',
  injection: 'injection',
  inhaler: 'puff',
  drops: 'drops',
  cream: 'application',
};

/**
 * A medicine in the catalogue.
 *
 * `purpose` is the sentence shown to the patient — "Clears the infection in
 * your chest". It is copy written for a person, not a drug description, and the
 * agent only ever repeats it. It never generates clinical advice of its own.
 */
export const MedicationSchema = TimestampsSchema.extend({
  _id: IdSchema,
  name: NonEmptyString.max(160),
  strength: z.string().trim().max(40).optional(),
  form: MedicationFormSchema.default('tablet'),
  purpose: z.string().trim().max(300).optional(),
  /**
   * Minimum minutes this medicine must be separated from another named
   * medicine. The planner honours these when it lays out the day.
   */
  spacingRules: z
    .array(
      z.object({
        /** Name of the other medicine, matched case-insensitively. */
        otherMedicationName: NonEmptyString.max(160),
        minimumMinutesApart: z.number().int().min(5).max(12 * 60),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .default([]),
  /** Shown verbatim on the medicine screen. Sourced from the prescription. */
  cautions: z.array(z.string().trim().max(300)).default([]),
});
export type Medication = z.infer<typeof MedicationSchema>;

export const CreateMedicationSchema = MedicationSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateMedication = z.infer<typeof CreateMedicationSchema>;
