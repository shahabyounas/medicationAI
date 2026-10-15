import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db/collections.js';
import { addSelfCare, flagAllergies, stopSelfCare } from './selfCareService.js';
import { tick } from '../agent/runner.js';
import { deliveryChannel } from '../agent/channels.js';
import {
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  minutesAfter,
  resetDatabase,
} from '../testing/harness.js';

/**
 * The medicines nobody prescribed.
 *
 * Two of these guard failures that are quiet and expensive. A supplement added
 * with reminders off is an open-ended, active course with no doses — which is
 * exactly the shape `topUpOpenEndedCourses` exists to fill in, so the loop will
 * cheerfully plan a fortnight of doses for somebody's cod liver oil and start
 * escalating them. And a course honestly recorded as having started four months
 * ago must not back-date four months of doses, every one of which the
 * activation pass would write off as missed.
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

const NOW = new Date('2026-08-12T07:00:00Z');

describe('adding something the patient takes themselves', () => {
  it('creates a course with no prescription behind it', async () => {
    const scenario = await createScenario();

    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Vitamin D 1000 IU', form: 'tablet', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'with_food',
        durationDays: null,
        conditionId: null,
        remindMe: false,
        unitsInHand: 60,
      },
      NOW,
    );

    const course = await collections.courses.requireById(result.courseId);
    expect(course.origin).toBe('self');
    expect(course.prescriptionId).toBeNull();
    expect(course.prescriptionItemId).toBeNull();
    expect(await collections.prescriptions.count({})).toBe(0);
  });

  it('plans no doses when the patient asked not to be reminded', async () => {
    const scenario = await createScenario();

    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Cod liver oil', form: 'capsule', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'any',
        durationDays: null,
        conditionId: null,
        remindMe: false,
        unitsInHand: null,
      },
      NOW,
    );

    expect(result.dosesScheduled).toBe(0);
    const course = await collections.courses.requireById(result.courseId);
    expect(course.remindersOn).toBe(false);
  });

  /** The top-up loop must not adopt a course the patient opted out of. */
  it('is never chased, even across ticks that top up open-ended courses', async () => {
    const scenario = await createScenario();

    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Cod liver oil', form: 'capsule', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 2,
        foodRule: 'any',
        durationDays: null,
        conditionId: null,
        remindMe: false,
        unitsInHand: null,
      },
      NOW,
    );

    deliveryChannel.clear();
    await tick(minutesAfter(NOW, 60));
    await tick(minutesAfter(NOW, 24 * 60));
    await tick(minutesAfter(NOW, 48 * 60));

    expect(await collections.doses.count({ courseId: result.courseId })).toBe(0);
    expect(deliveryChannel.recent()).toHaveLength(0);
  });

  it('plans doses when the patient does want reminding', async () => {
    const scenario = await createScenario();

    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Vitamin D 1000 IU', form: 'tablet', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'with_food',
        durationDays: 30,
        conditionId: null,
        remindMe: true,
        unitsInHand: 30,
      },
      NOW,
    );

    expect(result.dosesScheduled).toBe(30);
    const course = await collections.courses.requireById(result.courseId);
    expect(course.remindersOn).toBe(true);
  });

  /**
   * An honest start date must not become months of missed doses.
   *
   * The activation pass writes off any dose whose whole window has elapsed, so
   * back-dating the plan would invent four months of misses, wreck every
   * adherence figure, and trip the consecutive-miss rule that texts the
   * patient's son.
   */
  it('plans from today even when the patient started months ago', async () => {
    const scenario = await createScenario();
    const startedMonthsAgo = new Date('2026-04-01T07:00:00Z');

    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Vitamin D 1000 IU', form: 'tablet', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'with_food',
        durationDays: null,
        conditionId: null,
        remindMe: true,
        unitsInHand: 60,
        startedAt: startedMonthsAgo,
      },
      NOW,
    );

    const course = await collections.courses.requireById(result.courseId);
    // The record keeps the real start date...
    expect(course.startedAt?.toISOString()).toBe(startedMonthsAgo.toISOString());

    // ...but not one dose is in the past.
    const doses = await collections.doses.find({ courseId: result.courseId });
    expect(doses.length).toBeGreaterThan(0);
    const earliest = doses.reduce(
      (min, dose) => (dose.scheduledAt < min ? dose.scheduledAt : min),
      doses[0]!.scheduledAt,
    );
    expect(earliest.getTime()).toBeGreaterThanOrEqual(
      new Date(NOW.getTime() - 24 * 60 * 60 * 1000).getTime(),
    );
  });

  it('reuses a medicine already in the catalogue rather than colliding on the name', async () => {
    const scenario = await createScenario();

    const first = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Vitamin D 1000 IU', form: 'tablet', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'any',
        durationDays: null,
        conditionId: null,
        remindMe: false,
        unitsInHand: null,
      },
      NOW,
    );
    const second = await addSelfCare(
      {
        patientId: scenario.patient._id,
        // Same medicine, typed differently.
        medication: { create: { name: 'vitamin d 1000 iu', form: 'tablet', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'any',
        durationDays: null,
        conditionId: null,
        remindMe: false,
        unitsInHand: null,
      },
      NOW,
    );

    expect(second.medicationId).toBe(first.medicationId);
    expect(second.medicationCreated).toBe(false);
  });

  it('refuses to stop a prescribed course through the self-care route', async () => {
    const scenario = await createScenario();
    const course = await collections.courses.insert({
      patientId: scenario.patient._id,
      origin: 'prescription',
      prescriptionId: null,
      prescriptionItemId: null,
      medicationId: scenario.amoxicillin._id,
      medicationName: 'Amoxicillin',
      conditionId: scenario.conditionId,
      status: 'active',
      frequency: { timesPerDay: 3, foodRule: 'after_food' },
      amountPerDose: 1,
      durationDays: 7,
      totalDoses: 21,
      startedAt: NOW,
      expectedEndAt: null,
      completedAt: null,
      unitsRemaining: 21,
      learnedDriftMinutes: 0,
      stoppedReason: null,
      pausedAt: null,
      remindersOn: true,
    });

    await expect(stopSelfCare(course._id, 'I feel better', NOW)).rejects.toThrow(
      /decision for your doctor/i,
    );
  });

  it('records stopping a supplement as finished, not as a course abandoned', async () => {
    const scenario = await createScenario();
    const result = await addSelfCare(
      {
        patientId: scenario.patient._id,
        medication: { create: { name: 'Cod liver oil', form: 'capsule', kind: 'supplement' } },
        amountPerDose: 1,
        timesPerDay: 1,
        foodRule: 'any',
        durationDays: null,
        conditionId: null,
        remindMe: true,
        unitsInHand: null,
      },
      NOW,
    );

    await stopSelfCare(result.courseId, 'Finished the tub', minutesAfter(NOW, 60));

    const course = await collections.courses.requireById(result.courseId);
    // Not `stopped_early`: a patient stopping their own supplement has not
    // abandoned a course of treatment, and should not be marked as if they had.
    expect(course.status).toBe('completed');
    expect(course.stoppedReason).toBe('Finished the tub');
    expect(
      await collections.doses.count({
        courseId: result.courseId,
        status: { $in: ['scheduled', 'due'] },
      }),
    ).toBe(0);
  });
});

describe('the allergy name check', () => {
  it('flags a medicine whose name contains a recorded allergy', async () => {
    const scenario = await createScenario();
    const patient = await collections.patients.updateById(scenario.patient._id, {
      allergies: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          substance: 'Penicillin',
          reaction: 'Rash',
          severity: 'severe',
          recordedAt: NOW,
        },
      ],
    });

    const flags = flagAllergies(patient, 'Penicillin V 250mg');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/severe reaction to Penicillin/i);
    // It says what it cannot do, rather than implying the medicine is unsafe.
    expect(flags[0]).toMatch(/cannot tell whether those are related/i);
  });

  it('says nothing for an unrelated medicine', async () => {
    const scenario = await createScenario();
    const patient = await collections.patients.updateById(scenario.patient._id, {
      allergies: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          substance: 'Penicillin',
          reaction: 'Rash',
          severity: 'severe',
          recordedAt: NOW,
        },
      ],
    });

    expect(flagAllergies(patient, 'Metformin')).toHaveLength(0);
  });

  /**
   * The honest limit, asserted.
   *
   * Amoxicillin *is* a penicillin, and this check does not know that. The test
   * exists so nobody later mistakes the feature for a safety net: it catches
   * the obvious case, and the copy it produces never claims a medicine is safe.
   */
  it('does not pretend to know pharmacology', async () => {
    const scenario = await createScenario();
    const patient = await collections.patients.updateById(scenario.patient._id, {
      allergies: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          substance: 'Penicillin',
          reaction: 'Rash',
          severity: 'severe',
          recordedAt: NOW,
        },
      ],
    });

    expect(flagAllergies(patient, 'Amoxicillin')).toHaveLength(0);
  });

  it('ignores a substance too short to match meaningfully', async () => {
    const scenario = await createScenario();
    const patient = await collections.patients.updateById(scenario.patient._id, {
      allergies: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          substance: 'Soy',
          severity: 'mild',
          recordedAt: NOW,
        },
      ],
    });

    expect(flagAllergies(patient, 'Soybean oil capsules')).toHaveLength(0);
  });
});
