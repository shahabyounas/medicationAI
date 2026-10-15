import { z } from 'zod';
import {
  DateSchema,
  IdSchema,
  NonEmptyString,
  PhoneSchema,
  TimeOfDaySchema,
  TimestampsSchema,
} from './common.js';

/**
 * The agent schedules around when the patient actually eats, not around a
 * generic 8/2/9. These four times are the anchors the planner uses.
 */
export const MealtimesSchema = z.object({
  breakfast: TimeOfDaySchema.default('08:00'),
  lunch: TimeOfDaySchema.default('13:00'),
  dinner: TimeOfDaySchema.default('20:00'),
  bedtime: TimeOfDaySchema.default('22:30'),
});
export type Mealtimes = z.infer<typeof MealtimesSchema>;

export const DEFAULT_MEALTIMES: Mealtimes = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '20:00',
  bedtime: '22:30',
};

export const FamilyContactRelationSchema = z.enum([
  'son',
  'daughter',
  'spouse',
  'sibling',
  'parent',
  'carer',
  'friend',
  'other',
]);
export type FamilyContactRelation = z.infer<typeof FamilyContactRelationSchema>;

/**
 * The person the agent falls back to. Deliberately one primary contact —
 * being chased by three relatives is what makes people abandon these apps.
 */
export const FamilyContactSchema = z.object({
  id: IdSchema,
  name: NonEmptyString.max(120),
  relation: FamilyContactRelationSchema,
  phone: PhoneSchema,
  /** Notify after this many minutes of a dose going unanswered. */
  notifyAfterMinutes: z.number().int().min(15).max(24 * 60).default(180),
  /** Or immediately once this many doses in a row are missed. */
  notifyAfterConsecutiveMisses: z.number().int().min(1).max(10).default(2),
});
export type FamilyContact = z.infer<typeof FamilyContactSchema>;

export const AllergySeveritySchema = z.enum(['mild', 'severe', 'life_threatening']);
export type AllergySeverity = z.infer<typeof AllergySeveritySchema>;

export const ALLERGY_SEVERITY_LABELS: Record<AllergySeverity, string> = {
  mild: 'Mild reaction',
  severe: 'Severe reaction',
  life_threatening: 'Life-threatening',
};

/**
 * Something the patient has reacted to before.
 *
 * The one record in the app that has to be in front of somebody *before* a
 * medicine is accepted rather than after. Without it the intake form will take
 * penicillin for a patient who has reacted to penicillin and say nothing, which
 * is the worst thing a medicines app can quietly do.
 *
 * What the agent does with it stays inside the guardrail: it matches the name
 * it has been given against the names it was given before and repeats what the
 * patient told it. It does not know what penicillin is, it does not know that
 * amoxicillin is one, and it never says whether a medicine is safe. The
 * sentence it can say is "you have a severe reaction to this on your record —
 * check it with the person who prescribed it", which is a fact plus an
 * instruction to ask a human.
 */
export const AllergySchema = z.object({
  id: IdSchema,
  /** "Penicillin", "Peanuts", "Latex" — as the patient says it. */
  substance: NonEmptyString.max(160),
  /** What happened. Free text, never interpreted. */
  reaction: z.string().trim().max(300).optional(),
  severity: AllergySeveritySchema.default('mild'),
  recordedAt: DateSchema,
});
export type Allergy = z.infer<typeof AllergySchema>;

export const PatientSchema = TimestampsSchema.extend({
  _id: IdSchema,
  name: NonEmptyString.max(120),
  phone: PhoneSchema,
  dateOfBirth: DateSchema.optional(),
  /** IANA zone, e.g. "Europe/London". Dose times are computed in this zone. */
  timezone: NonEmptyString.default('Europe/London'),
  mealtimes: MealtimesSchema,
  familyContacts: z.array(FamilyContactSchema).max(3).default([]),
  /** Checked by name whenever a new medicine is added. See `AllergySchema`. */
  allergies: z.array(AllergySchema).max(40).default([]),
  /** Only ever used to give a weight chart something to be a share of. */
  heightCm: z.number().min(50).max(250).optional(),
});
export type Patient = z.infer<typeof PatientSchema>;

export const CreatePatientSchema = PatientSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  mealtimes: MealtimesSchema.default(DEFAULT_MEALTIMES),
  familyContacts: z.array(FamilyContactSchema.omit({ id: true })).max(3).default([]),
  allergies: z.array(AllergySchema.omit({ id: true })).max(40).default([]),
});
export type CreatePatient = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = CreatePatientSchema.partial();
export type UpdatePatient = z.infer<typeof UpdatePatientSchema>;
