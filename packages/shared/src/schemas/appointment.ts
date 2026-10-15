import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';
import { VisitTypeSchema } from './visit.js';

/**
 * An appointment that has not happened yet.
 *
 * `Visit.followUpDate` has been captured at intake since the beginning and used
 * for exactly one thing: a line of grey text on a visit card. So an agent that
 * will chase a single tablet through five channels over four hours was ignoring
 * the appointment it had been told about in the same breath. A follow-up nobody
 * attends is how a course of treatment ends halfway.
 *
 * It is its own record rather than a field on the visit because appointments
 * exist without a preceding visit — a six-month diabetic review, a scan — and
 * because a date that is going to be reminded about needs somewhere to record
 * that the reminder was sent.
 */
export const AppointmentStatusSchema = z.enum(['scheduled', 'attended', 'missed', 'cancelled']);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Coming up',
  attended: 'Went',
  missed: 'Missed it',
  cancelled: 'Cancelled',
};

/**
 * Which rungs of the reminder have already been sent.
 *
 * Named rather than a count, so adding a rung later cannot silently re-send the
 * ones already done, and a restart mid-sequence resumes instead of repeating.
 */
export const AppointmentReminderRungSchema = z.enum(['week_before', 'day_before', 'morning_of']);
export type AppointmentReminderRung = z.infer<typeof AppointmentReminderRungSchema>;

/** How far ahead of the appointment each rung fires. */
export const APPOINTMENT_REMINDER_LEAD_MINUTES: Record<AppointmentReminderRung, number> = {
  week_before: 7 * 24 * 60,
  day_before: 24 * 60,
  morning_of: 3 * 60,
};

export const AppointmentSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  /** Null for an appointment with somebody not yet on the record. */
  doctorId: IdSchema.nullable().default(null),
  /** Denormalised so an appointment reads on its own. */
  withWhom: NonEmptyString.max(160),
  conditionId: IdSchema.nullable().default(null),
  /** The visit whose follow-up date created this, when one did. */
  originVisitId: IdSchema.nullable().default(null),
  scheduledFor: DateSchema,
  type: VisitTypeSchema.default('follow_up'),
  location: z.string().trim().max(240).nullable().default(null),
  /** What the patient wants to remember to raise. */
  notes: z.string().trim().max(2000).nullable().default(null),
  status: AppointmentStatusSchema.default('scheduled'),
  remindersSent: z.array(AppointmentReminderRungSchema).default([]),
  /** The visit the appointment turned into, once it happened. */
  resultingVisitId: IdSchema.nullable().default(null),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const CreateAppointmentSchema = AppointmentSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateAppointment = z.infer<typeof CreateAppointmentSchema>;

export const UpdateAppointmentSchema = CreateAppointmentSchema.partial().omit({
  patientId: true,
});
export type UpdateAppointment = z.infer<typeof UpdateAppointmentSchema>;

/**
 * The next rung due for an appointment, or null when there is nothing to send.
 *
 * Rungs whose moment has passed unsent are skipped rather than fired late: a
 * "tomorrow" reminder arriving on the day is worse than no reminder, because it
 * tells the patient the wrong thing. The window is generous enough to survive a
 * deployment with no clock running for an hour, and no more.
 */
export function dueAppointmentReminder(
  appointment: Pick<Appointment, 'scheduledFor' | 'status' | 'remindersSent'>,
  now: Date,
  windowMinutes = 180,
): AppointmentReminderRung | null {
  if (appointment.status !== 'scheduled') return null;
  if (appointment.scheduledFor.getTime() <= now.getTime()) return null;

  const minutesAway = (appointment.scheduledFor.getTime() - now.getTime()) / 60_000;

  // Nearest rung first: on the morning of, the day-before rung is moot.
  const rungs: AppointmentReminderRung[] = ['morning_of', 'day_before', 'week_before'];
  for (const rung of rungs) {
    if (appointment.remindersSent.includes(rung)) continue;
    const lead = APPOINTMENT_REMINDER_LEAD_MINUTES[rung];
    if (minutesAway <= lead && minutesAway > lead - windowMinutes) return rung;
  }
  return null;
}
