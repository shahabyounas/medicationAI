import { z } from 'zod';
import {
  DateSchema,
  DoseAnchorSchema,
  IdSchema,
  NonEmptyString,
  TimestampsSchema,
} from './common.js';

export const DoseStatusSchema = z.enum([
  /** Planned, its time has not arrived. */
  'scheduled',
  /** Its time has arrived and the agent is chasing it. */
  'due',
  'taken',
  /** Taken, but well after the scheduled time. */
  'taken_late',
  /** The window closed with no confirmation. */
  'missed',
  /** The patient explicitly chose not to take it. */
  'skipped',
]);
export type DoseStatus = z.infer<typeof DoseStatusSchema>;

export const DOSE_STATUS_LABELS: Record<DoseStatus, string> = {
  scheduled: 'Later today',
  due: 'Take it now',
  taken: 'Taken',
  taken_late: 'Taken late',
  missed: 'Missed',
  skipped: 'Skipped',
};

/** Statuses that mean the agent no longer needs to chase this dose. */
export const SETTLED_DOSE_STATUSES: readonly DoseStatus[] = [
  'taken',
  'taken_late',
  'missed',
  'skipped',
];

/**
 * A single scheduled dose — the unit the agent actually works on.
 *
 * One document per tablet-taking event. Twenty-one of these are what "three
 * times a day for seven days" becomes, and every escalation, reminder and
 * replan is anchored to one of them.
 */
export const DoseSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  courseId: IdSchema,
  conditionId: IdSchema.nullable().default(null),
  medicationName: NonEmptyString.max(160),
  /** 1-based position within the course, so "dose 11 of 21" is directly readable. */
  doseNumber: z.number().int().min(1),
  dayNumber: z.number().int().min(1),
  anchor: DoseAnchorSchema,
  /** The time originally planned, never rewritten — the baseline for drift. */
  originallyScheduledAt: DateSchema,
  /** The current time, after any rescheduling. What the agent reminds against. */
  scheduledAt: DateSchema,
  status: DoseStatusSchema.default('scheduled'),
  takenAt: DateSchema.nullable().default(null),
  amount: z.number().positive().max(20).default(1),
  /** How the confirmation arrived — in-app, or a reply to a text. */
  confirmedVia: z.enum(['app', 'sms', 'whatsapp', 'family', 'auto']).nullable().default(null),
  /** Set when a replan moved this dose, for the activity log. */
  rescheduledReason: z.string().trim().max(300).nullable().default(null),
  /**
   * Why the patient chose not to take it.
   *
   * A skip used to record nothing but the fact, so the record could not tell a
   * patient who felt better from one the medicine was making ill — and the
   * agent, which escalates identically either way, had nothing to go on.
   */
  skipReason: z.string().trim().max(300).nullable().default(null),
});
export type Dose = z.infer<typeof DoseSchema>;

export const CreateDoseSchema = DoseSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateDose = z.infer<typeof CreateDoseSchema>;

/** How long after `scheduledAt` a dose is still counted as on time. */
export const ON_TIME_GRACE_MINUTES = 60;

/** How long after `scheduledAt` an unconfirmed dose is written off as missed. */
export const MISSED_AFTER_MINUTES = 4 * 60;
