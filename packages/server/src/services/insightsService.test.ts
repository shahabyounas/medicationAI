import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db/collections.js';
import { createPrescription, startPrescription } from './prescriptionService.js';
import { recordRefill, skipDose, takeDose } from './doseService.js';
import { buildInsights } from './insightsService.js';
import { buildReadings, recordReading } from './readingService.js';
import { recordSymptom } from './symptomService.js';
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
 * The charts.
 *
 * Every assertion here is about an honest denominator or a correct timezone,
 * because those are the two ways a chart screen lies. A percentage counted
 * against doses that were never due reads as failure; a day boundary taken in
 * UTC puts a patient's evening dose on the wrong row of the grid for everyone
 * west of Greenwich.
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

/** 8am BST on 12 August: 3×-a-day amoxicillin for 7 days — 21 doses. */
const STARTED_AT = new Date('2026-08-12T07:00:00Z');

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
  const started = await startPrescription(prescription._id, STARTED_AT);
  return started.courses[0]!._id;
}

describe('insights', () => {
  it('says it has nothing to show rather than charting three dots', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const insights = await buildInsights(scenario.patient._id, minutesAfter(STARTED_AT, 30));

    expect(insights.hasEnoughData).toBe(false);
    expect(insights.headline).toMatch(/pattern/i);
  });

  /**
   * The denominator that matters.
   *
   * Mid-course, counting the taken doses against all 21 reads as failure when
   * thirteen of them were never due yet.
   */
  it('counts only the doses whose time has come', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);

    const doses = await collections.doses.find({ courseId }, { sort: { scheduledAt: 1 } });
    // Day one: take all three.
    for (const dose of doses.slice(0, 3)) {
      await takeDose(dose._id, 'app', minutesAfter(dose.scheduledAt, 5));
    }

    const endOfDayOne = new Date('2026-08-12T22:00:00Z');
    const insights = await buildInsights(scenario.patient._id, endOfDayOne);

    expect(insights.overall.taken).toBe(3);
    expect(insights.overall.percentOfElapsed).toBe(100);
    expect(insights.overall.pending).toBe(18);
  });

  it('groups adherence by the mealtime a dose hangs off', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);

    const doses = await collections.doses.find({ courseId }, { sort: { scheduledAt: 1 } });
    // Take both breakfast doses, skip both suppers — the pattern a patient
    // can actually act on, and invisible in a single percentage.
    for (const dose of doses.filter((d) => d.anchor === 'breakfast').slice(0, 2)) {
      await takeDose(dose._id, 'app', minutesAfter(dose.scheduledAt, 5));
    }
    for (const dose of doses.filter((d) => d.anchor === 'dinner').slice(0, 2)) {
      await skipDose(dose._id, 'Fell asleep');
    }

    const insights = await buildInsights(scenario.patient._id, new Date('2026-08-14T07:00:00Z'));
    const breakfast = insights.byAnchor.find((row) => row.anchor === 'breakfast')!;
    const supper = insights.byAnchor.find((row) => row.anchor === 'dinner')!;

    expect(breakfast.percent).toBe(100);
    expect(supper.percent).toBe(0);
    expect(supper.skipped).toBe(2);
  });

  it('measures lateness against the time the patient was told, not the moved one', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);

    const doses = await collections.doses.find({ courseId }, { sort: { scheduledAt: 1 } });
    const first = doses[0]!;
    await takeDose(first._id, 'app', minutesAfter(first.scheduledAt, 95));

    const insights = await buildInsights(scenario.patient._id, new Date('2026-08-12T22:00:00Z'));

    expect(insights.punctuality.points).toHaveLength(1);
    expect(insights.punctuality.points[0]!.minutesLate).toBe(95);
    // 95 minutes is outside the hour's grace, so it is not "on time".
    expect(insights.punctuality.onTimePercent).toBe(0);
  });

  it('lays a course out as days by doses, with a row per day', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const insights = await buildInsights(scenario.patient._id, new Date('2026-08-14T07:00:00Z'));
    const grid = insights.grids.find((g) => g.medicationName === 'Amoxicillin')!;

    expect(grid.columns).toHaveLength(3);
    expect(grid.rows).toHaveLength(7);
    expect(grid.rows.every((row) => row.cells.length === 3)).toBe(true);
    // Every cell on a fresh course is a real dose, not a gap.
    expect(grid.rows.flatMap((row) => row.cells).filter((cell) => cell === null)).toHaveLength(0);
  });

  it('shows the burn-down pulling away from the plan after a miss', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);

    const doses = await collections.doses.find({ courseId }, { sort: { scheduledAt: 1 } });
    await takeDose(doses[0]!._id, 'app', minutesAfter(doses[0]!.scheduledAt, 5));
    await skipDose(doses[1]!._id, 'Forgot');
    await takeDose(doses[2]!._id, 'app', minutesAfter(doses[2]!.scheduledAt, 5));

    const insights = await buildInsights(scenario.patient._id, new Date('2026-08-13T07:00:00Z'));
    const grid = insights.grids.find((g) => g.medicationName === 'Amoxicillin')!;
    const dayOne = grid.burnDown[0]!;

    expect(dayOne.expectedTaken).toBe(3);
    expect(dayOne.actualTaken).toBe(2);
  });

  it('draws the illnesses as a timeline, keeping the recurrence link', async () => {
    const scenario = await createScenario();
    const earlier = await collections.conditions.insert({
      patientId: scenario.patient._id,
      name: 'Throat infection',
      status: 'resolved',
      startedAt: new Date('2026-02-11T09:00:00Z'),
      resolvedAt: new Date('2026-02-14T09:00:00Z'),
      originVisitId: null,
      recurrenceOfConditionId: null,
      isChronic: false,
    });
    await collections.conditions.updateById(scenario.conditionId, {
      recurrenceOfConditionId: earlier._id,
    });

    const insights = await buildInsights(scenario.patient._id, STARTED_AT);
    const current = insights.timeline.find((e) => e.conditionId === scenario.conditionId)!;

    expect(current.recurrenceOfConditionId).toBe(earlier._id);
    expect(insights.timeline.map((e) => e.name)).toContain('Throat infection');
  });

  it('carries the symptom line, with its day numbers from when treatment started', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    for (const [index, severity] of [7, 5, 2].entries()) {
      await recordSymptom(
        {
          patientId: scenario.patient._id,
          conditionId: scenario.conditionId,
          recordedAt: new Date(STARTED_AT.getTime() + index * 24 * 60 * 60 * 1000),
          severity,
        },
        new Date(STARTED_AT.getTime() + index * 24 * 60 * 60 * 1000),
      );
    }

    const insights = await buildInsights(scenario.patient._id, new Date('2026-08-15T07:00:00Z'));
    const series = insights.symptoms[0]!;

    expect(series.points.map((p) => p.dayNumber)).toEqual([1, 2, 3]);
    expect(series.points.map((p) => p.severity)).toEqual([7, 5, 2]);
    expect(series.turningPointNote).toMatch(/day 3/);
  });
});

describe('readings', () => {
  it('keeps blood pressure as one series of two numbers', async () => {
    const scenario = await createScenario();
    await recordReading(
      {
        patientId: scenario.patient._id,
        metric: 'blood_pressure',
        takenAt: STARTED_AT,
        value: 138,
        secondValue: 82,
        conditionId: null,
      },
      STARTED_AT,
    );

    const readings = await buildReadings(scenario.patient._id, STARTED_AT);
    const bp = readings.series.find((s) => s.metric === 'blood_pressure')!;

    expect(bp.points).toHaveLength(1);
    expect(bp.points[0]!.label).toBe('138/82 mmHg');
    expect(bp.hasPair).toBe(true);
  });

  it('refuses a reading that is not a measurement', async () => {
    const scenario = await createScenario();

    await expect(
      recordReading(
        {
          patientId: scenario.patient._id,
          metric: 'blood_pressure',
          takenAt: STARTED_AT,
          value: 138,
          secondValue: null,
          conditionId: null,
        },
        STARTED_AT,
      ),
    ).rejects.toThrow(/both numbers/i);

    await expect(
      recordReading(
        {
          patientId: scenario.patient._id,
          metric: 'weight',
          takenAt: new Date(STARTED_AT.getTime() + 60 * 60 * 1000),
          value: 72,
          secondValue: null,
          conditionId: null,
        },
        STARTED_AT,
      ),
    ).rejects.toThrow(/future/i);
  });

  /**
   * The nurse's measurement and the patient's own are one series.
   *
   * Blood pressure used to live on the visit as the string "138/82", which
   * cannot be a point on a chart — so the clinic readings and the home ones
   * could not be the same line.
   */
  it('includes the numbers taken at an appointment', async () => {
    const scenario = await createScenario();
    await collections.visits.insert({
      patientId: scenario.patient._id,
      doctorId: scenario.doctor._id,
      visitDate: new Date('2026-08-01T09:00:00Z'),
      type: 'consultation',
      reason: 'Review',
      conditionId: scenario.conditionId,
      followUpDate: null,
      vitals: { bloodPressureSystolic: 141, bloodPressureDiastolic: 86, weightKg: 74.2 },
    });

    await recordReading(
      {
        patientId: scenario.patient._id,
        metric: 'blood_pressure',
        takenAt: STARTED_AT,
        value: 132,
        secondValue: 78,
        conditionId: null,
      },
      STARTED_AT,
    );

    const readings = await buildReadings(scenario.patient._id, STARTED_AT);
    const bp = readings.series.find((s) => s.metric === 'blood_pressure')!;

    expect(bp.points).toHaveLength(2);
    expect(bp.points[0]!.fromVisit).toBe(true);
    expect(bp.points[1]!.fromVisit).toBe(false);
    // In time order, so the line is drawn left to right.
    expect(bp.points[0]!.takenAt.getTime()).toBeLessThan(bp.points[1]!.takenAt.getTime());
  });

  it('states the change as a subtraction rather than a verdict', async () => {
    const scenario = await createScenario();
    for (const [index, weight] of [74.5, 73.1].entries()) {
      await recordReading(
        {
          patientId: scenario.patient._id,
          metric: 'weight',
          takenAt: new Date(STARTED_AT.getTime() + index * 30 * 24 * 60 * 60 * 1000),
          value: weight,
          secondValue: null,
          conditionId: null,
        },
        new Date(STARTED_AT.getTime() + index * 30 * 24 * 60 * 60 * 1000),
      );
    }

    const readings = await buildReadings(
      scenario.patient._id,
      new Date(STARTED_AT.getTime() + 31 * 24 * 60 * 60 * 1000),
    );
    const weight = readings.series.find((s) => s.metric === 'weight')!;

    expect(weight.changeLabel).toMatch(/1\.4 kg less than on/);
    // Nothing about whether that is good.
    expect(weight.changeLabel).not.toMatch(/better|worse|improv|good/i);
  });
});

describe('refills', () => {
  /**
   * `needsRefillWarning` has existed from the start and nothing ever put units
   * back on the shelf, so the warning fired once and could never be cleared.
   */
  it('puts units back and says whether they cover the course', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);
    await collections.courses.updateById(courseId, { unitsRemaining: 2 });

    const result = await recordRefill(courseId, 21);

    expect(result.unitsRemaining).toBe(21);
    expect(result.dosesRemaining).toBe(21);
    expect(result.message).toMatch(/covers the rest of the course/i);
  });

  it('says plainly when a refill still does not cover it', async () => {
    const scenario = await createScenario();
    const courseId = await startCourse(scenario);

    const result = await recordRefill(courseId, 6);
    expect(result.message).toMatch(/15 short/);
  });
});
