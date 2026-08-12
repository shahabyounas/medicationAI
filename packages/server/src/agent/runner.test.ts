import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db/collections.js';
import { createPrescription, startPrescription } from '../services/prescriptionService.js';
import { skipDose, takeDose } from '../services/doseService.js';
import { deliveryChannel } from './channels.js';
import { tick } from './runner.js';
import {
  amoxicillinItem,
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  minutesAfter,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * The agent loop, against a real database.
 *
 * These tests drive the clock by hand — `tick(now)` — because a medication
 * schedule plays out over days and the interesting behaviour is entirely about
 * what happens at T+15 minutes versus T+3 hours.
 */

let scenario: TestScenario;

beforeAll(async () => {
  await connectTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  scenario = await createScenario();
});

/** Start a 7-day course and return the first dose, with its due time. */
async function startCourse(startAt: Date) {
  const prescription = await createPrescription({
    patientId: scenario.patient._id,
    doctorId: scenario.doctor._id,
    visitId: null,
    conditionId: scenario.conditionId,
    issuedAt: startAt,
    source: 'qr_code',
    items: [amoxicillinItem(scenario.amoxicillin._id)],
  });

  const { doses, courses } = await startPrescription(prescription._id, startAt);
  const first = doses[0]!;
  return { prescription, courses, doses, first, dueAt: first.scheduledAt };
}

describe('activating doses', () => {
  it('leaves a dose alone until its time arrives', async () => {
    const { first, dueAt } = await startCourse(new Date());

    await tick(minutesAfter(dueAt, -5));

    const dose = await collections.doses.requireById(first._id);
    expect(dose.status).toBe('scheduled');
    expect(await collections.escalationStates.count({ doseId: first._id })).toBe(0);
  });

  it('makes a dose due and opens one escalation when its time comes', async () => {
    const { first, dueAt } = await startCourse(new Date());

    await tick(dueAt);

    const dose = await collections.doses.requireById(first._id);
    expect(dose.status).toBe('due');

    const state = await collections.escalationStates.findOne({ doseId: first._id });
    expect(state?.currentNodeId).toBe('reminder_2');
    expect(state?.history.map((h) => h.nodeId)).toEqual(['reminder_1']);
  });

  it('does not open a second ladder for the same dose', async () => {
    const { first, dueAt } = await startCourse(new Date());

    await tick(dueAt);
    await tick(dueAt);

    expect(await collections.escalationStates.count({ doseId: first._id })).toBe(1);
  });

  it('writes off a dose whose whole window elapsed while the server was down', async () => {
    const { first, dueAt } = await startCourse(new Date());

    // The loop wakes up more than four hours late — past the entire ladder for
    // this dose, but before the next one is due.
    await tick(minutesAfter(dueAt, 250));

    const dose = await collections.doses.requireById(first._id);
    expect(dose.status).toBe('missed');
    // And it does not pester the patient about a tablet whose moment has gone.
    expect(deliveryChannel.recent()).toHaveLength(0);
  });
});

describe('walking the escalation ladder', () => {
  it('climbs one rung per scheduled offset, in order', async () => {
    const { dueAt } = await startCourse(new Date());

    const seen: string[] = [];
    for (const offset of [0, 16, 46, 121, 181]) {
      const result = await tick(minutesAfter(dueAt, offset));
      seen.push(...result.events.map((e) => e.escalationNodeId ?? '?'));
    }

    expect(seen).toEqual([
      'reminder_1',
      'reminder_2',
      'text_message',
      'check_in',
      'notify_family',
    ]);
  });

  it('sends over the channel each rung specifies', async () => {
    const { dueAt } = await startCourse(new Date());

    for (const offset of [0, 16, 46, 121, 181]) {
      await tick(minutesAfter(dueAt, offset));
    }

    const channels = deliveryChannel.recent().reverse().map((d) => d.channel);
    expect(channels).toEqual(['push', 'push', 'sms', 'sms', 'family']);
  });

  it('reaches the patient four times before it reaches the family', async () => {
    const { dueAt } = await startCourse(new Date());

    for (const offset of [0, 16, 46, 121, 181]) {
      await tick(minutesAfter(dueAt, offset));
    }

    const sent = deliveryChannel.recent().reverse();
    const familyIndex = sent.findIndex((d) => d.channel === 'family');
    expect(familyIndex).toBe(4);
    expect(sent.slice(0, 4).every((d) => d.recipientName === 'Nasreen Ahmed')).toBe(true);
    expect(sent[familyIndex]!.recipientName).toBe('Bilal Ahmed');
  });

  it('does not fire the same rung twice when ticked repeatedly', async () => {
    const { dueAt } = await startCourse(new Date());

    await tick(dueAt);
    await tick(minutesAfter(dueAt, 1));
    await tick(minutesAfter(dueAt, 2));

    expect(deliveryChannel.recent()).toHaveLength(1);
  });

  it('tells the family something specific enough to act on', async () => {
    const { dueAt } = await startCourse(new Date());

    for (const offset of [0, 16, 46, 121, 181]) {
      await tick(minutesAfter(dueAt, offset));
    }

    const familyMessage = deliveryChannel.recent().find((d) => d.channel === 'family')?.message;
    expect(familyMessage).toContain('Amoxicillin');
    expect(familyMessage).toContain('Nasreen');
    expect(familyMessage).toMatch(/day \d+ of 7/);
  });

  it('carries on down the ladder when there is no family contact', async () => {
    await resetDatabase();
    scenario = await createScenario({ withFamily: false });
    const { first, dueAt } = await startCourse(new Date());

    for (const offset of [0, 16, 46, 121, 181, 241]) {
      await tick(minutesAfter(dueAt, offset));
    }

    // It still reaches the end rather than stalling on the family step.
    const dose = await collections.doses.requireById(first._id);
    expect(dose.status).toBe('missed');
  });
});

describe('the end of the ladder', () => {
  it('records the dose as missed and replans the rest of the course', async () => {
    const { first, dueAt, courses } = await startCourse(new Date());
    const courseId = courses[0]!._id;

    for (const offset of [0, 16, 46, 121, 181, 241]) {
      await tick(minutesAfter(dueAt, offset));
    }

    const dose = await collections.doses.requireById(first._id);
    expect(dose.status).toBe('missed');

    const rescheduled = await collections.doses.count({
      courseId,
      rescheduledReason: { $ne: null },
    });
    expect(rescheduled).toBeGreaterThan(0);
  });

  it('never drops a dose to protect the original end date', async () => {
    const { dueAt, courses } = await startCourse(new Date());
    const courseId = courses[0]!._id;

    const before = await collections.doses.count({ courseId });
    for (const offset of [0, 16, 46, 121, 181, 241]) {
      await tick(minutesAfter(dueAt, offset));
    }
    const after = await collections.doses.count({ courseId });

    // The goal is all 21 tablets; the finish date is what moves.
    expect(after).toBe(before);
    expect(after).toBe(21);
  });

  it('settles the ladder so it stops doing work', async () => {
    const { first, dueAt } = await startCourse(new Date());

    for (const offset of [0, 16, 46, 121, 181, 241]) {
      await tick(minutesAfter(dueAt, offset));
    }
    const state = await collections.escalationStates.findOne({ doseId: first._id });
    expect(state?.settledAt).not.toBeNull();
    expect(state?.nextRunAt).toBeNull();

    // Later ticks legitimately serve *other* doses, so the check is that this
    // ladder specifically does no more work.
    const stepsTaken = state?.history.length ?? 0;
    await tick(minutesAfter(dueAt, 400));

    const after = await collections.escalationStates.findOne({ doseId: first._id });
    expect(after?.history).toHaveLength(stepsTaken);
    expect(after?.nextRunAt).toBeNull();
  });
});

describe('the patient answering', () => {
  it('stops the ladder the moment a dose is confirmed', async () => {
    const { first, dueAt } = await startCourse(new Date());

    await tick(dueAt);
    await tick(minutesAfter(dueAt, 16));
    const sentBefore = deliveryChannel.recent().length;

    await takeDose(first._id, 'app', minutesAfter(dueAt, 20));

    // Everything further down the ladder is abandoned.
    for (const offset of [46, 121, 181, 241]) {
      await tick(minutesAfter(dueAt, offset));
    }
    expect(deliveryChannel.recent()).toHaveLength(sentBefore);

    const state = await collections.escalationStates.findOne({ doseId: first._id });
    expect(state?.currentNodeId).toBe('resolved');
  });

  it('marks a dose taken within the grace period as on time', async () => {
    const { first, dueAt } = await startCourse(new Date());
    await tick(dueAt);

    await takeDose(first._id, 'app', minutesAfter(dueAt, 20));

    expect((await collections.doses.requireById(first._id)).status).toBe('taken');
  });

  it('marks a dose taken well after its time as late, but still taken', async () => {
    const { first, dueAt } = await startCourse(new Date());
    await tick(dueAt);

    await takeDose(first._id, 'app', minutesAfter(dueAt, 90));

    expect((await collections.doses.requireById(first._id)).status).toBe('taken_late');
  });

  it('counts the tablets off the shelf', async () => {
    const { first, dueAt, courses } = await startCourse(new Date());
    await tick(dueAt);

    await takeDose(first._id, 'app', minutesAfter(dueAt, 5));

    const course = await collections.courses.requireById(courses[0]!._id);
    expect(course.unitsRemaining).toBe(20);
  });

  it('accepts a confirmation that arrived by text, not just in the app', async () => {
    const { first, dueAt } = await startCourse(new Date());
    await tick(dueAt);

    await takeDose(first._id, 'sms', minutesAfter(dueAt, 50));

    expect((await collections.doses.requireById(first._id)).confirmedVia).toBe('sms');
  });

  it('stops chasing a dose the patient deliberately skipped', async () => {
    const { first, dueAt } = await startCourse(new Date());
    await tick(dueAt);
    const sentBefore = deliveryChannel.recent().length;

    await skipDose(first._id);
    for (const offset of [46, 121, 181]) {
      await tick(minutesAfter(dueAt, offset));
    }

    expect(deliveryChannel.recent()).toHaveLength(sentBefore);
    expect((await collections.doses.requireById(first._id)).status).toBe('skipped');
  });
});

describe('bringing the family in early', () => {
  it('short-circuits to the family after a run of misses', async () => {
    const { doses, dueAt } = await startCourse(new Date());

    // Two earlier doses already missed — the contact's threshold.
    await collections.doses.updateById(doses[0]!._id, { status: 'missed' });
    await collections.doses.updateById(doses[1]!._id, { status: 'missed' });

    const third = doses[2]!;
    await tick(third.scheduledAt);

    const familyDelivery = deliveryChannel.recent().find((d) => d.channel === 'family');
    expect(familyDelivery).toBeDefined();
    expect(familyDelivery?.recipientName).toBe('Bilal Ahmed');
    expect(dueAt.getTime()).toBeLessThan(third.scheduledAt.getTime());
  });

  it('does not involve the family on a first slow afternoon', async () => {
    const { dueAt } = await startCourse(new Date());

    await tick(dueAt);
    await tick(minutesAfter(dueAt, 16));

    expect(deliveryChannel.recent().some((d) => d.channel === 'family')).toBe(false);
  });
});

describe('open-ended courses', () => {
  it('keeps planning doses ahead so a long-term medicine never runs dry', async () => {
    const metformin = await collections.medications.insert({
      name: 'Metformin',
      strength: '500mg',
      form: 'tablet',
      purpose: 'Keeps your blood sugar steady',
      spacingRules: [],
      cautions: [],
    });

    const prescription = await createPrescription({
      patientId: scenario.patient._id,
      doctorId: scenario.doctor._id,
      visitId: null,
      conditionId: null,
      issuedAt: new Date(),
      source: 'manual',
      items: [
        {
          medicationId: metformin._id,
          medicationName: 'Metformin',
          amountPerDose: 1,
          frequency: { timesPerDay: 2, foodRule: 'with_food' },
          durationDays: null,
          totalUnits: null,
        },
      ],
    });

    const start = new Date();
    const { courses } = await startPrescription(prescription._id, start);
    const courseId = courses[0]!._id;
    const initial = await collections.doses.count({ courseId });

    // Jump most of the way through the planned horizon.
    const later = new Date(start.getTime() + 28 * 24 * 60 * 60 * 1000);
    await tick(later);

    const upcoming = await collections.doses.count({
      courseId,
      scheduledAt: { $gt: later },
    });
    expect(upcoming).toBeGreaterThanOrEqual(7);
    expect(await collections.doses.count({ courseId })).toBeGreaterThan(initial);
  });

  it('does not top up a course that still has plenty planned', async () => {
    const { courses, dueAt } = await startCourse(new Date());
    const courseId = courses[0]!._id;

    const before = await collections.doses.count({ courseId });
    await tick(dueAt);
    expect(await collections.doses.count({ courseId })).toBe(before);
  });
});

describe('tick reporting', () => {
  it('reports what it did', async () => {
    const { dueAt } = await startCourse(new Date());

    const result = await tick(dueAt);

    expect(result.actionsTaken).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.ranAt).toEqual(dueAt);
  });

  it('does nothing, loudly, when there is nothing to do', async () => {
    const result = await tick(new Date());

    expect(result.actionsTaken).toBe(0);
    expect(result.dosesMarkedMissed).toBe(0);
    expect(result.events).toEqual([]);
  });
});
