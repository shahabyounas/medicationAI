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

/**
 * What the patient is actually holding, singular and plural.
 *
 * Both forms are written out rather than pluralised with an "s" at the call
 * site, which is how "2 dropss" happens — and the whole table exists so that a
 * capsule is never called a tablet in copy the patient reads.
 */
export const MEDICATION_FORM_UNITS: Record<MedicationForm, { one: string; many: string }> = {
  tablet: { one: 'tablet', many: 'tablets' },
  capsule: { one: 'capsule', many: 'capsules' },
  liquid: { one: 'dose', many: 'doses' },
  injection: { one: 'injection', many: 'injections' },
  inhaler: { one: 'puff', many: 'puffs' },
  drops: { one: 'drop', many: 'drops' },
  cream: { one: 'application', many: 'applications' },
};

export const MEDICATION_FORM_LABELS = Object.fromEntries(
  Object.entries(MEDICATION_FORM_UNITS).map(([form, unit]) => [form, unit.one]),
) as Record<MedicationForm, string>;

/** "1 capsule", "2 tablets", "3 drops" — the phrase, counted and in the right form. */
export function describeUnits(amount: number, form: MedicationForm): string {
  const unit = MEDICATION_FORM_UNITS[form];
  return `${amount} ${amount === 1 ? unit.one : unit.many}`;
}

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
