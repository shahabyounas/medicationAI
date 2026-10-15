import {
  APPOINTMENT_STATUS_LABELS,
  VISIT_TYPE_LABELS,
  appointmentBookedMessage,
  calendarDaysBetween,
  formatClockTime,
  formatDayMonth,
  type Appointment,
  type AppointmentReminderRung,
  type AppointmentView,
  type AppointmentsResponse,
  type CreateAppointmentRequest,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { logAgentEvent } from './agentEventService.js';

const ALL_RUNGS: AppointmentReminderRung[] = ['week_before', 'day_before', 'morning_of'];

/**
 * Appointments, and the reminders the app was not sending.
 *
 * `Visit.followUpDate` has been collected at intake since the first version and
 * used for one thing: a line of grey text. An agent that will chase a single
 * tablet through five channels over four hours was told "come back in three
 * weeks" and did nothing with it at all — and a follow-up nobody attends is how
 * a course of treatment ends halfway.
 *
 * The reminders are three fixed rungs rather than the dose ladder, because the
 * two problems are not the same shape. A dose is chased *because it is late* and
 * stops the moment it is confirmed; an appointment is announced *before* it,
 * cannot be confirmed early, and has nothing to escalate to — there is no point
 * ringing your son because the surgery is on Tuesday.
 */
export async function createAppointment(
  input: CreateAppointmentRequest,
  now = new Date(),
): Promise<Appointment> {
  const patient = await collections.patients.requireById(input.patientId);

  const doctor = input.doctorId ? await collections.doctors.findById(input.doctorId) : null;
  if (input.doctorId && !doctor) throw new BadRequestError('That doctor is not on your record');
  if (doctor && doctor.patientId !== patient._id) {
    throw new BadRequestError('That doctor belongs to a different patient');
  }

  const withWhom = input.withWhom ?? doctor?.name;
  if (!withWhom) throw new BadRequestError('Who is the appointment with?');

  if (input.scheduledFor.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    throw new BadRequestError('That date has already passed — record it as a visit instead');
  }

  const appointment = await collections.appointments.insert({
    patientId: patient._id,
    doctorId: doctor?._id ?? null,
    withWhom,
    conditionId: input.conditionId,
    originVisitId: null,
    scheduledFor: input.scheduledFor,
    type: input.type,
    location: input.location ?? doctor?.clinic.name ?? null,
    notes: input.notes ?? null,
    status: 'scheduled',
    // Rungs whose moment has already gone are marked sent rather than fired
    // late: an appointment booked for tomorrow should not get a "a week today"
    // reminder, and `dueAppointmentReminder` skipping them silently would leave
    // them pending forever on the card that says what will happen next.
    remindersSent: ALL_RUNGS.filter(
      (rung) => !rungStillAhead(rung, input.scheduledFor, now),
    ),
    resultingVisitId: null,
  });

  await logAgentEvent({
    patientId: patient._id,
    type: 'appointment_booked',
    occurredAt: now,
    doseId: null,
    courseId: null,
    conditionId: input.conditionId,
    channel: 'internal',
    summary: appointmentBookedMessage(
      withWhom,
      formatDayMonth(input.scheduledFor, patient.timezone),
    ),
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  return appointment;
}

function rungStillAhead(
  rung: AppointmentReminderRung,
  scheduledFor: Date,
  now: Date,
): boolean {
  const leadByRung = { week_before: 7 * 24 * 60, day_before: 24 * 60, morning_of: 3 * 60 };
  const minutesAway = (scheduledFor.getTime() - now.getTime()) / 60_000;
  // `>=` rather than `>`: a rung whose moment is exactly now has not been
  // missed, it is due. Marking it sent here would swallow the one reminder for
  // an appointment booked precisely a day ahead.
  return minutesAway >= leadByRung[rung];
}

/**
 * Turn a visit's follow-up date into a real appointment.
 *
 * Offered rather than done automatically. "Come back in three weeks" on a visit
 * note is frequently not a booked appointment — it is an instruction to ring the
 * surgery — and silently filling the record with appointments that do not exist
 * would make the one screen a patient checks before leaving the house unusable.
 */
export async function appointmentFromVisit(
  visitId: string,
  now = new Date(),
): Promise<Appointment> {
  const visit = await collections.visits.requireById(visitId);
  if (!visit.followUpDate) {
    throw new BadRequestError('That visit has no follow-up date on it');
  }

  const existing = await collections.appointments.findOne({ originVisitId: visitId });
  if (existing) return existing;

  const doctor = await collections.doctors.findById(visit.doctorId);
  const appointment = await createAppointment(
    {
      patientId: visit.patientId,
      doctorId: visit.doctorId,
      withWhom: doctor?.name ?? 'your doctor',
      conditionId: visit.conditionId,
      scheduledFor: visit.followUpDate,
      type: 'follow_up',
      location: doctor?.clinic.name,
      notes: visit.diagnosis ? `Follow-up for ${visit.diagnosis}` : undefined,
    },
    now,
  );

  return collections.appointments.updateById(appointment._id, { originVisitId: visitId });
}

export async function setAppointmentStatus(
  appointmentId: string,
  status: Appointment['status'],
  now = new Date(),
): Promise<Appointment> {
  const appointment = await collections.appointments.requireById(appointmentId);
  const updated = await collections.appointments.updateById(appointmentId, { status });

  if (status === 'missed') {
    await logAgentEvent({
      patientId: appointment.patientId,
      type: 'appointment_missed',
      occurredAt: now,
      doseId: null,
      courseId: null,
      conditionId: appointment.conditionId,
      channel: 'internal',
      summary: `Missed the appointment with ${appointment.withWhom}`,
      message: null,
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  return updated;
}

export async function deleteAppointment(appointmentId: string): Promise<boolean> {
  return collections.appointments.deleteById(appointmentId);
}

export async function buildAppointments(
  patientId: string,
  now = new Date(),
): Promise<AppointmentsResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const [appointments, doctors, conditions, visits, immunisations] = await Promise.all([
    collections.appointments.find({ patientId }, { sort: { scheduledFor: 1 } }),
    collections.doctors.find({ patientId }),
    collections.conditions.find({ patientId }),
    collections.visits.find({ patientId }, { sort: { visitDate: -1 } }),
    collections.immunisations.find({ patientId }),
  ]);

  const doctorsById = new Map(doctors.map((d) => [d._id, d]));
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  const views: AppointmentView[] = appointments.map((appointment) => {
    const doctor = appointment.doctorId ? doctorsById.get(appointment.doctorId) : undefined;
    const condition = appointment.conditionId
      ? conditionsById.get(appointment.conditionId)
      : undefined;
    const daysAway = calendarDaysBetween(now, appointment.scheduledFor, tz);

    return {
      ...appointment,
      doctorName: doctor?.name ?? null,
      clinicName: doctor?.clinic.name ?? appointment.location,
      clinicPhone: doctor?.clinic.phone ?? null,
      conditionName: condition?.name ?? null,
      dateLabel: formatDayMonth(appointment.scheduledFor, tz),
      clockTime: formatClockTime(appointment.scheduledFor, tz),
      whenLabel: describeWhen(daysAway),
      typeLabel: VISIT_TYPE_LABELS[appointment.type],
      statusLabel: APPOINTMENT_STATUS_LABELS[appointment.status],
      daysAway,
      remindersPending: ALL_RUNGS.filter((rung) => !appointment.remindersSent.includes(rung)),
    };
  });

  const upcoming = views
    .filter((view) => view.status === 'scheduled' && view.scheduledFor.getTime() >= now.getTime())
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());

  const past = views
    .filter((view) => !upcoming.includes(view))
    .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());

  // Follow-up dates the app was told about and has never done anything with.
  const bookedFromVisit = new Set(
    appointments.map((a) => a.originVisitId).filter((id): id is string => id !== null),
  );

  const suggestedFromVisits = visits
    .filter((visit) => visit.followUpDate !== null)
    .filter((visit) => visit.followUpDate!.getTime() >= now.getTime())
    .filter((visit) => !bookedFromVisit.has(visit._id))
    .map((visit) => {
      const condition = visit.conditionId ? conditionsById.get(visit.conditionId) : undefined;
      return {
        visitId: visit._id,
        doctorId: visit.doctorId,
        doctorName: doctorsById.get(visit.doctorId)?.name ?? 'your doctor',
        conditionId: visit.conditionId,
        conditionName: condition?.name ?? null,
        followUpDate: visit.followUpDate!,
        dateLabel: formatDayMonth(visit.followUpDate!, tz),
        visitDateLabel: formatDayMonth(visit.visitDate, tz),
      };
    });

  const immunisationsDue = immunisations
    .filter((jab) => jab.nextDueAt !== null)
    .map((jab) => ({
      immunisationId: jab._id,
      name: jab.name,
      dueAt: jab.nextDueAt!,
      dateLabel: formatDayMonth(jab.nextDueAt!, tz),
      whenLabel: describeWhen(calendarDaysBetween(now, jab.nextDueAt!, tz)),
    }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  return { timeZone: tz, upcoming, past, suggestedFromVisits, immunisationsDue };
}

/** "Today", "Tomorrow", "In 5 days", "3 weeks ago". */
function describeWhen(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway === -1) return 'Yesterday';
  if (daysAway > 0) {
    if (daysAway < 14) return `In ${daysAway} days`;
    const weeks = Math.round(daysAway / 7);
    return weeks < 9 ? `In ${weeks} weeks` : `In ${Math.round(daysAway / 30)} months`;
  }
  const ago = Math.abs(daysAway);
  if (ago < 14) return `${ago} days ago`;
  const weeks = Math.round(ago / 7);
  return weeks < 9 ? `${weeks} weeks ago` : `${Math.round(ago / 30)} months ago`;
}
