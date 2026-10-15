import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dueAppointmentReminder } from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { appointmentFromVisit, buildAppointments, createAppointment } from './appointmentService.js';
import { tick } from '../agent/runner.js';
import {
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  resetDatabase,
} from '../testing/harness.js';

/**
 * Appointments, and the reminders the app was never sending.
 *
 * The rung logic is pure and tested directly. What needs a database is the
 * tick: a reminder must go out exactly once, must not fire a rung whose moment
 * has already passed, and must survive the loop running several times in the
 * same window — which is the normal case, since the open app ticks once a
 * minute.
 */

beforeAll(async () => {
  await connectTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

const NOW = new Date('2026-08-12T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('which reminder is due', () => {
  const base = { status: 'scheduled' as const, remindersSent: [] };

  it('fires the week-before rung a week out', () => {
    expect(
      dueAppointmentReminder({ ...base, scheduledFor: new Date(NOW.getTime() + 7 * DAY) }, NOW),
    ).toBe('week_before');
  });

  it('fires the day-before rung the day before', () => {
    expect(
      dueAppointmentReminder({ ...base, scheduledFor: new Date(NOW.getTime() + DAY) }, NOW),
    ).toBe('day_before');
  });

  it('fires the morning-of rung on the morning', () => {
    expect(
      dueAppointmentReminder(
        { ...base, scheduledFor: new Date(NOW.getTime() + 2 * 60 * 60 * 1000) },
        NOW,
      ),
    ).toBe('morning_of');
  });

  /**
   * A "tomorrow" reminder arriving on the day is worse than no reminder,
   * because it tells the patient the wrong thing.
   */
  it('skips a rung whose moment has passed rather than firing it late', () => {
    expect(
      dueAppointmentReminder(
        { ...base, scheduledFor: new Date(NOW.getTime() + 3 * DAY) },
        NOW,
      ),
    ).toBeNull();
  });

  it('sends nothing once a rung has been recorded', () => {
    expect(
      dueAppointmentReminder(
        {
          status: 'scheduled',
          remindersSent: ['week_before'],
          scheduledFor: new Date(NOW.getTime() + 7 * DAY),
        },
        NOW,
      ),
    ).toBeNull();
  });

  it('sends nothing for an appointment that has been and gone', () => {
    expect(
      dueAppointmentReminder({ ...base, scheduledFor: new Date(NOW.getTime() - DAY) }, NOW),
    ).toBeNull();
  });

  it('sends nothing for one that was cancelled', () => {
    expect(
      dueAppointmentReminder(
        { status: 'cancelled', remindersSent: [], scheduledFor: new Date(NOW.getTime() + DAY) },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('the tick', () => {
  async function anAppointment(patientId: string, doctorId: string, daysAway: number) {
    return createAppointment(
      {
        patientId,
        doctorId,
        conditionId: null,
        scheduledFor: new Date(NOW.getTime() + daysAway * DAY),
        type: 'follow_up',
      },
      NOW,
    );
  }

  it('reminds once, however many times the loop runs', async () => {
    const scenario = await createScenario();
    const appointment = await anAppointment(scenario.patient._id, scenario.doctor._id, 7);

    // The open app ticks once a minute; all of these land in the same window.
    await tick(new Date(NOW.getTime() + 1_000));
    await tick(new Date(NOW.getTime() + 61_000));
    await tick(new Date(NOW.getTime() + 121_000));

    const reminders = await collections.agentEvents.count({
      patientId: scenario.patient._id,
      type: 'appointment_reminder',
    });
    expect(reminders).toBe(1);

    const stored = await collections.appointments.requireById(appointment._id);
    expect(stored.remindersSent).toEqual(['week_before']);
  });

  it('works through the rungs as the date approaches', async () => {
    const scenario = await createScenario();
    const appointment = await anAppointment(scenario.patient._id, scenario.doctor._id, 7);

    await tick(NOW);
    await tick(new Date(NOW.getTime() + 6 * DAY));
    await tick(new Date(NOW.getTime() + 7 * DAY - 2 * 60 * 60 * 1000));

    const stored = await collections.appointments.requireById(appointment._id);
    expect(stored.remindersSent).toEqual(['week_before', 'day_before', 'morning_of']);
  });

  /**
   * An appointment booked for tomorrow has no business getting a "a week
   * today" reminder — and the rung must be marked rather than left pending, or
   * the card promising what happens next would lie about it forever.
   */
  it('marks rungs that were already moot when the appointment was booked', async () => {
    const scenario = await createScenario();
    const appointment = await anAppointment(scenario.patient._id, scenario.doctor._id, 1);

    expect(appointment.remindersSent).toContain('week_before');
    expect(appointment.remindersSent).not.toContain('day_before');
  });

  it('writes off an appointment that has gone past with nothing recorded', async () => {
    const scenario = await createScenario();
    const appointment = await anAppointment(scenario.patient._id, scenario.doctor._id, 1);

    await tick(new Date(NOW.getTime() + 3 * DAY));

    const stored = await collections.appointments.requireById(appointment._id);
    expect(stored.status).toBe('missed');
    expect(
      await collections.agentEvents.count({
        patientId: scenario.patient._id,
        type: 'appointment_missed',
      }),
    ).toBe(1);
  });
});

describe('follow-up dates already on the record', () => {
  it('offers a visit’s follow-up date rather than booking it silently', async () => {
    const scenario = await createScenario();
    await collections.visits.insert({
      patientId: scenario.patient._id,
      doctorId: scenario.doctor._id,
      visitDate: NOW,
      type: 'consultation',
      reason: 'Cough',
      conditionId: scenario.conditionId,
      followUpDate: new Date(NOW.getTime() + 21 * DAY),
    });

    const response = await buildAppointments(scenario.patient._id, NOW);
    expect(response.upcoming).toHaveLength(0);
    expect(response.suggestedFromVisits).toHaveLength(1);
    expect(response.suggestedFromVisits[0]!.doctorName).toBe(scenario.doctor.name);
  });

  it('turns one into a real appointment, once', async () => {
    const scenario = await createScenario();
    const visit = await collections.visits.insert({
      patientId: scenario.patient._id,
      doctorId: scenario.doctor._id,
      visitDate: NOW,
      type: 'consultation',
      reason: 'Cough',
      conditionId: scenario.conditionId,
      followUpDate: new Date(NOW.getTime() + 21 * DAY),
    });

    const first = await appointmentFromVisit(visit._id, NOW);
    const second = await appointmentFromVisit(visit._id, NOW);

    expect(second._id).toBe(first._id);
    expect(await collections.appointments.count({})).toBe(1);

    const response = await buildAppointments(scenario.patient._id, NOW);
    expect(response.upcoming).toHaveLength(1);
    expect(response.suggestedFromVisits).toHaveLength(0);
  });
});
