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

export const PatientSchema = TimestampsSchema.extend({
  _id: IdSchema,
  name: NonEmptyString.max(120),
  phone: PhoneSchema,
  dateOfBirth: DateSchema.optional(),
  /** IANA zone, e.g. "Europe/London". Dose times are computed in this zone. */
  timezone: NonEmptyString.default('Europe/London'),
  mealtimes: MealtimesSchema,
  familyContacts: z.array(FamilyContactSchema).max(3).default([]),
});
export type Patient = z.infer<typeof PatientSchema>;

export const CreatePatientSchema = PatientSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  mealtimes: MealtimesSchema.default(DEFAULT_MEALTIMES),
  familyContacts: z.array(FamilyContactSchema.omit({ id: true })).max(3).default([]),
});
export type CreatePatient = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = CreatePatientSchema.partial();
export type UpdatePatient = z.infer<typeof UpdatePatientSchema>;
