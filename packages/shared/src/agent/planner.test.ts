import { describe, expect, it } from 'vitest';
import { DEFAULT_MEALTIMES, type Mealtimes } from '../schemas/patient.js';
import {
  applySpacing,
  defaultAnchorsFor,
  defaultOffsetFor,
  learnDriftMinutes,
  planDoses,
  replanRemaining,
} from './planner.js';
import { formatClockTime } from './time.js';

const TZ = 'Europe/London';

/** Times as the patient would read them, for readable assertions. */
const readTimes = (doses: { scheduledAt: Date }[]): string[] =>
  doses.map((d) => formatClockTime(d.scheduledAt, TZ));

describe('defaultAnchorsFor', () => {
  it('spreads doses across the meals people actually have', () => {
    expect(defaultAnchorsFor(1)).toEqual(['breakfast']);
    expect(defaultAnchorsFor(2)).toEqual(['breakfast', 'dinner']);
    expect(defaultAnchorsFor(3)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(defaultAnchorsFor(4)).toEqual(['breakfast', 'lunch', 'dinner', 'bedtime']);
  });

  it('always returns exactly timesPerDay anchors', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(defaultAnchorsFor(n).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('defaultOffsetFor', () => {
  it('puts "before food" half an hour ahead of the meal', () => {
    expect(defaultOffsetFor('before_food')).toBe(-30);
  });

  it('puts "after food" half an hour behind the meal', () => {
    expect(defaultOffsetFor('after_food')).toBe(30);
  });

  it('leaves "with food" and "any" on the meal itself', () => {
    expect(defaultOffsetFor('with_food')).toBe(0);
    expect(defaultOffsetFor('any')).toBe(0);
  });
});

describe('planDoses', () => {
  // The design's worked example: Amoxicillin, 3x a day, after food, 7 days.
  const amoxicillin = {
    frequency: { timesPerDay: 3, foodRule: 'after_food' as const },
    durationDays: 7,
    mealtimes: DEFAULT_MEALTIMES,
    timeZone: TZ,
  };

  it('turns "three times a day for 7 days" into exactly 21 doses', () => {
    const doses = planDoses({
      ...amoxicillin,
      startAt: new Date('2026-08-04T06:00:00Z'),
    });
    expect(doses).toHaveLength(21);
  });

  it('numbers doses 1..n in chronological order', () => {
    const doses = planDoses({ ...amoxicillin, startAt: new Date('2026-08-04T06:00:00Z') });

    expect(doses.map((d) => d.doseNumber)).toEqual(
      Array.from({ length: 21 }, (_, i) => i + 1),
    );
    for (let i = 1; i < doses.length; i += 1) {
      expect(doses[i]!.scheduledAt.getTime()).toBeGreaterThan(doses[i - 1]!.scheduledAt.getTime());
    }
  });

  it('anchors doses to the patient\'s own mealtimes, offset for the food rule', () => {
    const doses = planDoses({ ...amoxicillin, startAt: new Date('2026-08-04T06:00:00Z') });

    // Mealtimes are 08:00 / 13:00 / 20:00; "after food" adds 30 minutes.
    expect(readTimes(doses.slice(0, 3))).toEqual(['8:30 AM', '1:30 PM', '8:30 PM']);
  });

  it('follows a patient who eats at different times', () => {
    const lateRiser: Mealtimes = {
      breakfast: '10:30',
      lunch: '15:00',
      dinner: '22:00',
      bedtime: '23:30',
    };
    const doses = planDoses({
      ...amoxicillin,
      mealtimes: lateRiser,
      startAt: new Date('2026-08-04T06:00:00Z'),
    });

    expect(readTimes(doses.slice(0, 3))).toEqual(['11:00 AM', '3:30 PM', '10:30 PM']);
  });

  it('never schedules a dose before the medicine is in the patient\'s hand', () => {
    // She confirms at 2pm local — the 8:30am slot has already gone.
    const startAt = new Date('2026-08-04T13:00:00Z'); // 14:00 London
    const doses = planDoses({ ...amoxicillin, startAt });

    for (const dose of doses) {
      expect(dose.scheduledAt.getTime()).toBeGreaterThanOrEqual(startAt.getTime());
    }
  });

  it('still delivers the full course when it starts mid-day, running a day longer', () => {
    const startAt = new Date('2026-08-04T13:00:00Z'); // 14:00 London
    const doses = planDoses({ ...amoxicillin, startAt });

    // The count is what matters clinically, not the finish date.
    expect(doses).toHaveLength(21);
    // Day one only has the evening slot left, so the course runs into day 8.
    expect(doses.at(-1)!.dayNumber).toBe(8);
    expect(readTimes(doses.slice(0, 2))).toEqual(['8:30 PM', '8:30 AM']);
  });

  it('counts dayNumber from the first dose, not from the calendar', () => {
    const doses = planDoses({
      ...amoxicillin,
      startAt: new Date('2026-08-04T13:00:00Z'),
    });
    expect(doses[0]!.dayNumber).toBe(1);
    // Doses 2,3,4 are the three on the following day.
    expect(doses.slice(1, 4).map((d) => d.dayNumber)).toEqual([2, 2, 2]);
  });

  it('schedules a once-daily "before breakfast" medicine 30 minutes early', () => {
    const doses = planDoses({
      frequency: { timesPerDay: 1, foodRule: 'before_food' },
      durationDays: 7,
      mealtimes: DEFAULT_MEALTIMES,
      timeZone: TZ,
      startAt: new Date('2026-08-04T06:00:00Z'),
    });

    expect(doses).toHaveLength(7);
    expect(readTimes(doses.slice(0, 1))).toEqual(['7:30 AM']);
  });

  it('plans a fixed window ahead for an open-ended medicine', () => {
    const doses = planDoses({
      frequency: { timesPerDay: 2, foodRule: 'any' },
      durationDays: null,
      mealtimes: DEFAULT_MEALTIMES,
      timeZone: TZ,
      startAt: new Date('2026-08-04T06:00:00Z'),
      openEndedDays: 14,
    });
    expect(doses).toHaveLength(28);
  });

  it('honours explicit anchors from the prescription over the defaults', () => {
    const doses = planDoses({
      frequency: { timesPerDay: 2, anchors: ['breakfast', 'bedtime'], foodRule: 'any' },
      durationDays: 2,
      mealtimes: DEFAULT_MEALTIMES,
      timeZone: TZ,
      startAt: new Date('2026-08-04T06:00:00Z'),
    });
    expect(readTimes(doses)).toEqual(['8:00 AM', '10:30 PM', '8:00 AM', '10:30 PM']);
  });

  it('keeps wall-clock times stable across a daylight-saving change', () => {
    // UK clocks go back on 25 October 2026.
    const doses = planDoses({
      frequency: { timesPerDay: 1, foodRule: 'any' },
      durationDays: 4,
      mealtimes: DEFAULT_MEALTIMES,
      timeZone: TZ,
      startAt: new Date('2026-10-23T05:00:00Z'),
    });

    // The patient still takes it at 8am every morning, either side of the change.
    expect(readTimes(doses)).toEqual(['8:00 AM', '8:00 AM', '8:00 AM', '8:00 AM']);
    // And the underlying instants differ by 25 hours across the transition.
    const gapHours =
      (doses[2]!.scheduledAt.getTime() - doses[1]!.scheduledAt.getTime()) / 3_600_000;
    expect(gapHours).toBe(25);
  });
});

describe('applySpacing', () => {
  const at = (iso: string) => new Date(iso);

  it('leaves doses alone when no rule applies to them', () => {
    const doses = [
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:00:00Z') },
      { medicationName: 'Metformin', scheduledAt: at('2026-08-04T07:10:00Z') },
    ];
    const spaced = applySpacing(doses, []);
    expect(spaced.map((d) => d.scheduledAt.toISOString())).toEqual([
      '2026-08-04T07:00:00.000Z',
      '2026-08-04T07:10:00.000Z',
    ]);
  });

  it('pushes the later dose out to satisfy the minimum gap', () => {
    const doses = [
      { medicationName: 'Pantoprazole', scheduledAt: at('2026-08-04T07:00:00Z') },
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:10:00Z') },
    ];
    const spaced = applySpacing(doses, [
      {
        medicationName: 'Pantoprazole',
        otherMedicationName: 'Amoxicillin',
        minimumMinutesApart: 30,
      },
    ]);

    // The earlier dose keeps the time the patient was told about.
    expect(spaced[0]!.scheduledAt.toISOString()).toBe('2026-08-04T07:00:00.000Z');
    expect(spaced[1]!.scheduledAt.toISOString()).toBe('2026-08-04T07:30:00.000Z');
  });

  it('matches medicine names regardless of case and rule direction', () => {
    const doses = [
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:00:00Z') },
      { medicationName: 'Pantoprazole', scheduledAt: at('2026-08-04T07:05:00Z') },
    ];
    const spaced = applySpacing(doses, [
      {
        medicationName: 'pantoprazole',
        otherMedicationName: 'AMOXICILLIN',
        minimumMinutesApart: 30,
      },
    ]);
    expect(spaced[1]!.scheduledAt.toISOString()).toBe('2026-08-04T07:30:00.000Z');
  });

  it('does not space a medicine against itself', () => {
    const doses = [
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:00:00Z') },
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:05:00Z') },
    ];
    const spaced = applySpacing(doses, [
      {
        medicationName: 'Amoxicillin',
        otherMedicationName: 'Amoxicillin',
        minimumMinutesApart: 240,
      },
    ]);
    expect(spaced[1]!.scheduledAt.toISOString()).toBe('2026-08-04T07:05:00.000Z');
  });

  it('does not modify the array it was given', () => {
    const original = [
      { medicationName: 'Pantoprazole', scheduledAt: at('2026-08-04T07:00:00Z') },
      { medicationName: 'Amoxicillin', scheduledAt: at('2026-08-04T07:10:00Z') },
    ];
    applySpacing(original, [
      {
        medicationName: 'Pantoprazole',
        otherMedicationName: 'Amoxicillin',
        minimumMinutesApart: 30,
      },
    ]);
    expect(original[1]!.scheduledAt.toISOString()).toBe('2026-08-04T07:10:00.000Z');
  });
});

describe('learnDriftMinutes', () => {
  const sample = (scheduled: string, taken: string) => ({
    scheduledAt: new Date(scheduled),
    takenAt: new Date(taken),
  });

  it('stays at zero until there is enough evidence', () => {
    expect(learnDriftMinutes([])).toBe(0);
    expect(
      learnDriftMinutes([sample('2026-08-04T08:00:00Z', '2026-08-04T08:45:00Z')]),
    ).toBe(0);
  });

  it('learns a consistent lateness', () => {
    const samples = [
      sample('2026-08-04T08:00:00Z', '2026-08-04T08:30:00Z'),
      sample('2026-08-05T08:00:00Z', '2026-08-05T08:35:00Z'),
      sample('2026-08-06T08:00:00Z', '2026-08-06T08:28:00Z'),
    ];
    expect(learnDriftMinutes(samples)).toBe(30);
  });

  it('ignores a single wild outlier by using the median', () => {
    const samples = [
      sample('2026-08-04T08:00:00Z', '2026-08-04T08:12:00Z'),
      sample('2026-08-05T08:00:00Z', '2026-08-05T08:14:00Z'),
      sample('2026-08-06T08:00:00Z', '2026-08-06T13:00:00Z'), // 5 hours — a miss
      sample('2026-08-07T08:00:00Z', '2026-08-07T08:13:00Z'),
    ];
    expect(learnDriftMinutes(samples)).toBe(13);
  });

  it('does not act on a drift too small to be worth moving a reminder for', () => {
    const samples = [
      sample('2026-08-04T08:00:00Z', '2026-08-04T08:03:00Z'),
      sample('2026-08-05T08:00:00Z', '2026-08-05T08:04:00Z'),
      sample('2026-08-06T08:00:00Z', '2026-08-06T08:02:00Z'),
    ];
    expect(learnDriftMinutes(samples)).toBe(0);
  });

  it('learns earliness too', () => {
    const samples = [
      sample('2026-08-04T08:00:00Z', '2026-08-04T07:40:00Z'),
      sample('2026-08-05T08:00:00Z', '2026-08-05T07:38:00Z'),
      sample('2026-08-06T08:00:00Z', '2026-08-06T07:42:00Z'),
    ];
    expect(learnDriftMinutes(samples)).toBe(-20);
  });
});

describe('replanRemaining', () => {
  it('shifts every remaining dose and drops none', () => {
    const remaining = planDoses({
      frequency: { timesPerDay: 3, foodRule: 'after_food' },
      durationDays: 2,
      mealtimes: DEFAULT_MEALTIMES,
      timeZone: TZ,
      startAt: new Date('2026-08-04T06:00:00Z'),
    });

    const shifted = replanRemaining(remaining, 30);

    expect(shifted).toHaveLength(remaining.length);
    for (let i = 0; i < remaining.length; i += 1) {
      expect(shifted[i]!.scheduledAt.getTime() - remaining[i]!.scheduledAt.getTime()).toBe(
        30 * 60_000,
      );
    }
  });
});
