import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db/collections.js';
import { createPrescription, startPrescription } from './prescriptionService.js';
import { takeDose } from './doseService.js';
import { buildConditionHistory, buildHistory } from './historyService.js';
import {
  amoxicillinItem,
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * The lifetime record.
 *
 * The app's claim is that it keeps a patient's whole healthcare history for as
 * long as they use it — decades, in principle. Two things have to hold for that
 * to be true rather than aspirational: events must bucket into the right year
 * even when they are years apart, and a dose must remember the time it was
 * actually swallowed rather than the time it was scheduled for.
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

const STARTED_AT = new Date('2026-08-12T07:00:00Z');

async function startCourse(scenario: TestScenario, startAt = STARTED_AT): Promise<string> {
  const prescription = await createPrescription({
    patientId: scenario.patient._id,
    doctorId: scenario.doctor._id,
    visitId: null,
    conditionId: scenario.conditionId,
    issuedAt: startAt,
    source: 'manual',
    items: [amoxicillinItem(scenario.amoxicillin._id)],
  });
  await startPrescription(prescription._id, startAt);
  return prescription._id;
}

describe('the lifetime record', () => {
  it('buckets events into the year and month they happened in', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    // An illness from years earlier, the way a long record accumulates.
    await collections.conditions.insert({
      patientId: scenario.patient._id,
      name: 'Pneumonia',
      status: 'resolved',
      startedAt: new Date('2019-03-04T10:00:00Z'),
      resolvedAt: new Date('2019-04-01T10:00:00Z'),
      originVisitId: null,
      recurrenceOfConditionId: null,
      isChronic: false,
    });

    const history = await buildHistory(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));
    const years = history.years.map((y) => y.year);

    // Newest first, and the two years are kept apart rather than flattened.
    expect(years).toEqual([2026, 2019]);

    const y2019 = history.years.find((y) => y.year === 2019);
    expect(y2019?.months.map((m) => m.label)).toEqual(['April', 'March']);
    expect(y2019?.months.find((m) => m.month === 3)?.entries[0]?.title).toBe('Pneumonia');
    expect(y2019?.months.find((m) => m.month === 4)?.entries[0]?.title).toBe('Pneumonia resolved');
  });

  it('measures the span from the earliest thing recorded', async () => {
    const scenario = await createScenario();
    await collections.conditions.insert({
      patientId: scenario.patient._id,
      name: 'Pneumonia',
      status: 'resolved',
      startedAt: new Date('2014-03-04T10:00:00Z'),
      resolvedAt: null,
      originVisitId: null,
      recurrenceOfConditionId: null,
      isChronic: false,
    });

    const history = await buildHistory(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));

    expect(history.totals.spanLabel).toBe('12 years of records');
    expect(history.totals.firstRecordedAt?.toISOString()).toBe('2014-03-04T10:00:00.000Z');
  });

  it('keeps what is due now at the top rather than inside the timeline', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const history = await buildHistory(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));

    // Three doses today, and the next one pinned out of the year buckets — a
    // dose due in ten minutes must not be something you scroll to find.
    expect(history.todayDoses).toHaveLength(3);
    expect(history.nextDose?.medicationName).toBe('Amoxicillin');
  });

  it('counts only doses actually swallowed', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const first = await collections.doses.findOne(
      { patientId: scenario.patient._id },
      { sort: { scheduledAt: 1 } },
    );
    await takeDose(first!._id, 'app', new Date('2026-08-12T07:35:00Z'));

    const history = await buildHistory(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));
    expect(history.totals.dosesTaken).toBe(1);
  });
});

describe('one illness in full', () => {
  it('logs every dose with the time it was actually taken', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const first = await collections.doses.findOne(
      { patientId: scenario.patient._id },
      { sort: { scheduledAt: 1 } },
    );
    // Scheduled 8:30am, swallowed 9:05 — thirty-five minutes late.
    await takeDose(first!._id, 'app', new Date('2026-08-12T08:05:00Z'));

    const condition = await buildConditionHistory(scenario.conditionId);

    expect(condition.name).toBe('Chest infection');
    expect(condition.medications).toHaveLength(1);

    const medicine = condition.medications[0]!;
    expect(medicine.medicationName).toBe('Amoxicillin');
    expect(medicine.doses).toHaveLength(21);
    expect(medicine.takenCount).toBe(1);

    const taken = medicine.doses.find((d) => d._id === first!._id);
    expect(taken?.takenTimeLabel).toBe('9:05 AM');
    expect(taken?.scheduledTimeLabel).toBe('8:30 AM');
    expect(taken?.minutesLate).toBe(35);

    // A dose never taken says so rather than showing a blank where a time goes.
    const untaken = medicine.doses.find((d) => d.takenAt === null);
    expect(untaken?.takenTimeLabel).toBeNull();
    expect(untaken?.minutesLate).toBeNull();
  });

  it('orders the log newest first, so the last thing taken is the first thing seen', async () => {
    const scenario = await createScenario();
    await startCourse(scenario);

    const condition = await buildConditionHistory(scenario.conditionId);
    const numbers = condition.medications[0]!.doses.map((d) => d.doseNumber);

    expect(numbers[0]).toBe(21);
    expect(numbers.at(-1)).toBe(1);
  });

  it('names the illness returning when it is a recurrence', async () => {
    const scenario = await createScenario();
    const earlier = await collections.conditions.insert({
      patientId: scenario.patient._id,
      name: 'Chest infection',
      status: 'resolved',
      startedAt: new Date('2026-03-01T10:00:00Z'),
      resolvedAt: new Date('2026-03-20T10:00:00Z'),
      originVisitId: null,
      recurrenceOfConditionId: null,
      isChronic: false,
    });
    const returned = await collections.conditions.insert({
      patientId: scenario.patient._id,
      name: 'Chest infection',
      status: 'active',
      startedAt: new Date('2026-08-01T10:00:00Z'),
      resolvedAt: null,
      originVisitId: null,
      recurrenceOfConditionId: earlier._id,
      isChronic: false,
    });

    const history = await buildHistory(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));
    const entries = history.years.flatMap((y) => y.months.flatMap((m) => m.entries));
    const recurrence = entries.find((e) => e.kind === 'condition_recurred');

    expect(recurrence?.title).toBe('Chest infection came back');

    const detail = await buildConditionHistory(returned._id);
    expect(detail.recurrenceOfConditionId).toBe(earlier._id);
    expect(detail.recurrenceNote).toContain('returning');
  });
});
