import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MEALTIMES, formatClockTime, type Mealtimes } from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { createPrescription, startPrescription } from './prescriptionService.js';
import { reanchorToMealtimes, takeDose } from './doseService.js';
import { buildToday } from './viewService.js';
import {
  amoxicillinItem,
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * Changing your mealtimes.
 *
 * The planner anchors every dose to breakfast, lunch, supper or bedtime, so
 * these four times decide when the whole course happens. Correcting them has to
 * move the course that is already running — a setting that only applies to the
 * next prescription would leave the app reminding the patient at times she has
 * just told it are wrong.
 *
 * The failure these guard against is quiet and specific: shifting every
 * remaining dose by one offset (what a replan after a miss does) drags breakfast
 * along when only supper moved.
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

/** 8am BST on 12 August — a 3×-a-day, 7-day course, taken after food. */
const STARTED_AT = new Date('2026-08-12T07:00:00Z');

/** Mid-morning the same day: the 8:30am dose is behind us, two are still ahead. */
const MID_MORNING = new Date('2026-08-12T09:00:00Z');

async function startCourse(scenario: TestScenario): Promise<string> {
  const prescription = await createPrescription({
    patientId: scenario.patient._id,
    doctorId: scenario.doctor._id,
    visitId: null,
    conditionId: scenario.conditionId,
    issuedAt: STARTED_AT,
    source: 'manual',
    items: [amoxicillinItem(scenario.amoxicillin._id)],
  });
  await startPrescription(prescription._id, STARTED_AT);
  return prescription._id;
}

/** Today's dose times, as the patient reads them. */
async function todaysTimes(patientId: string, at: Date): Promise<string[]> {
  const today = await buildToday(patientId, at);
  return today.doses.map((dose) => dose.clockTime);
}

const SUPPER_AN_HOUR_LATER: Mealtimes = { ...DEFAULT_MEALTIMES, dinner: '21:00' };

describe('changing your mealtimes', () => {
  it('moves only the doses anchored to the meal that changed', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    // 8:30, 1:30, 8:30 — half an hour after each of the default mealtimes,
    // because this prescription is taken after food.
    expect(await todaysTimes(scenario.patient._id, MID_MORNING)).toEqual([
      '8:30 AM',
      '1:30 PM',
      '8:30 PM',
    ]);

    const moved = await reanchorToMealtimes(
      scenario.patient._id,
      DEFAULT_MEALTIMES,
      SUPPER_AN_HOUR_LATER,
      MID_MORNING,
    );

    // Seven evening doses, one a day. Lunch is untouched, and so is the
    // breakfast dose that has already gone by.
    expect(moved).toBe(7);
    expect(await todaysTimes(scenario.patient._id, MID_MORNING)).toEqual([
      '8:30 AM',
      '1:30 PM',
      '9:30 PM',
    ]);
  });

  it('keeps the gap the food rule asks for', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    await reanchorToMealtimes(
      scenario.patient._id,
      DEFAULT_MEALTIMES,
      SUPPER_AN_HOUR_LATER,
      MID_MORNING,
    );

    const evening = await collections.doses.findOne({
      patientId: scenario.patient._id,
      anchor: 'dinner',
      status: 'scheduled',
    });

    // Supper moved to 21:00 and the dose is still half an hour after it, rather
    // than landing on the meal itself.
    expect(evening && formatClockTime(evening.scheduledAt, 'Europe/London')).toBe('9:30 PM');
  });

  it('leaves a dose that has already been taken alone', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const breakfast = await collections.doses.findOne({
      patientId: scenario.patient._id,
      anchor: 'breakfast',
    });
    await takeDose(breakfast!._id, 'app', new Date('2026-08-12T07:35:00Z'));

    await reanchorToMealtimes(
      scenario.patient._id,
      DEFAULT_MEALTIMES,
      { ...DEFAULT_MEALTIMES, breakfast: '10:00' },
      MID_MORNING,
    );

    const after = await collections.doses.requireById(breakfast!._id);
    expect(after.status).toBe('taken');
    expect(formatClockTime(after.scheduledAt, 'Europe/London')).toBe('8:30 AM');
  });

  it('does nothing when the times have not actually changed', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const moved = await reanchorToMealtimes(
      scenario.patient._id,
      DEFAULT_MEALTIMES,
      { ...DEFAULT_MEALTIMES },
      MID_MORNING,
    );

    expect(moved).toBe(0);
  });

  it('says what it did, so the change is not silent', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    await reanchorToMealtimes(
      scenario.patient._id,
      DEFAULT_MEALTIMES,
      SUPPER_AN_HOUR_LATER,
      MID_MORNING,
    );

    const events = await collections.agentEvents.find({
      patientId: scenario.patient._id,
      type: 'course_replanned',
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe('Moved 7 doses to fit your new mealtimes');
    // Not a family matter: nobody needs telling that she eats later now.
    expect(events[0]?.visibleToFamily).toBe(false);
  });
});
