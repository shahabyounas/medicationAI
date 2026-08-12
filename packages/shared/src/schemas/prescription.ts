import { z } from 'zod';
import {
  DateSchema,
  DoseAnchorSchema,
  FoodRuleSchema,
  IdSchema,
  NonEmptyString,
  TimestampsSchema,
} from './common.js';

/**
 * How often a medicine is taken, in the form the planner can act on.
 *
 * `timesPerDay` plus `anchor` is deliberately coarse: it is exactly what a
 * prescription actually says ("three times a day, after food"), and no more.
 * Anything finer would be the app inventing clinical detail it was not given.
 */
export const FrequencySchema = z
  .object({
    timesPerDay: z.number().int().min(1).max(6),
    /**
     * Which points in the day the doses hang off. When omitted the planner
     * picks sensible anchors for `timesPerDay` (see `defaultAnchorsFor`).
     */
    anchors: z.array(DoseAnchorSchema).max(6).optional(),
    foodRule: FoodRuleSchema.default('any'),
    /**
     * Minutes to shift each dose relative to its anchor. Negative is before.
     * A "before food" rule defaults this to -30 when it is not given.
     */
    offsetMinutes: z.number().int().min(-240).max(240).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.anchors && value.anchors.length !== value.timesPerDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchors'],
        message: `expected ${value.timesPerDay} anchors to match timesPerDay, got ${value.anchors.length}`,
      });
    }
  });
export type Frequency = z.infer<typeof FrequencySchema>;

/** One line on the prescription: a medicine, a dose, a frequency, a duration. */
export const PrescriptionItemSchema = z.object({
  id: IdSchema,
  medicationId: IdSchema,
  /** Denormalised so a prescription reads correctly on its own. */
  medicationName: NonEmptyString.max(160),
  /** How much to take at once, e.g. 1 (tablet), 2 (puffs). */
  amountPerDose: z.number().positive().max(20).default(1),
  frequency: FrequencySchema,
  /** Null means open-ended — a long-term medicine with no finish line. */
  durationDays: z.number().int().min(1).max(365).nullable(),
  /** Copied from the paper when present, otherwise computed by the planner. */
  totalUnits: z.number().int().min(1).nullable().default(null),
  instructions: z.string().trim().max(400).optional(),
});
export type PrescriptionItem = z.infer<typeof PrescriptionItemSchema>;

export const PrescriptionStatusSchema = z.enum([
  /** Read off a QR code or photo, not yet confirmed by the patient. */
  'draft',
  /** The patient confirmed the read-back is correct. */
  'confirmed',
  /** The patient has the medicine at home; courses are running. */
  'active',
  /** Every course finished. */
  'completed',
  /** Abandoned before the last dose. */
  'stopped',
]);
export type PrescriptionStatus = z.infer<typeof PrescriptionStatusSchema>;

export const PRESCRIPTION_STATUS_LABELS: Record<PrescriptionStatus, string> = {
  draft: 'Waiting for you to check it',
  confirmed: 'Waiting for the medicine',
  active: 'In progress',
  completed: 'Completed',
  stopped: 'Stopped early',
};

export const PrescriptionSourceSchema = z.enum(['qr_code', 'photo', 'clinic_sent', 'manual']);
export type PrescriptionSource = z.infer<typeof PrescriptionSourceSchema>;

/**
 * What the doctor wrote, as a record. The agent reads this and never edits it:
 * scheduling lives in `Course`, so the prescription stays a faithful copy of
 * the paper even after the plan around it has been rearranged a dozen times.
 */
export const PrescriptionSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  doctorId: IdSchema,
  visitId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  issuedAt: DateSchema,
  source: PrescriptionSourceSchema.default('manual'),
  status: PrescriptionStatusSchema.default('draft'),
  items: z.array(PrescriptionItemSchema).min(1, 'a prescription needs at least one medicine'),
  /** Set when the patient answers "yes, I have the medicine" — starts the clock. */
  medicineInHandAt: DateSchema.nullable().default(null),
  notes: z.string().trim().max(2000).optional(),
});
export type Prescription = z.infer<typeof PrescriptionSchema>;

export const CreatePrescriptionSchema = PrescriptionSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
  medicineInHandAt: true,
}).extend({
  items: z.array(PrescriptionItemSchema.omit({ id: true })).min(1),
});
export type CreatePrescription = z.infer<typeof CreatePrescriptionSchema>;
