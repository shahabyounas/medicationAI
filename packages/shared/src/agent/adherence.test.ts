import { describe, expect, it } from 'vitest';
import {
  countConsecutiveMisses,
  longestTakenStreak,
  needsRefillWarning,
  shouldShowFeelBetterNudge,
  summariseAdherence,
} from './adherence.js';
import type { Dose, DoseStatus } from '../schemas/dose.js';

/** A dose with only the fields the adherence maths reads. */
function dose(status: DoseStatus, scheduledAt: string): Dose {
  const at = new Date(scheduledAt);
  return {
    _id: `dose-${scheduledAt}`,
    patientId: 'patient-1',
    courseId: 'course-1',
    conditionId: null,
    medicationName: 'Amoxicillin',
    doseNumber: 1,
    dayNumber: 1,
    anchor: 'breakfast',
    originallyScheduledAt: at,
    scheduledAt: at,
    status,
    takenAt: status === 'taken' || status === 'taken_late' ? at : null,
    amount: 1,
    confirmedVia: null,
    rescheduledReason: null,
  skipReason: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe('summariseAdherence', () => {
  const now = new Date('2026-08-04T18:00:00Z');

  it('reports zeroes for an empty course without dividing by zero', () => {
    const summary = summariseAdherence([], now);
    expect(summary.total).toBe(0);
    expect(summary.percentOfCourse).toBe(0);
    expect(summary.percentOfElapsed).toBe(100);
  });

  it('counts each status into the right bucket', () => {
    const summary = summariseAdherence(
      [
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('taken_late', '2026-08-04T12:00:00Z'),
        dose('missed', '2026-08-03T07:00:00Z'),
        dose('skipped', '2026-08-03T12:00:00Z'),
        dose('scheduled', '2026-08-05T07:00:00Z'),
      ],
      now,
    );

    expect(summary.taken).toBe(2);
    expect(summary.missed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.total).toBe(5);
  });

  it('measures progress towards the finish line separately from recent behaviour', () => {
    const doses = [
      dose('taken', '2026-08-04T07:00:00Z'),
      dose('taken', '2026-08-04T12:00:00Z'),
      dose('scheduled', '2026-08-05T07:00:00Z'),
      dose('scheduled', '2026-08-05T12:00:00Z'),
    ];
    const summary = summariseAdherence(doses, now);

    // Halfway through the course...
    expect(summary.percentOfCourse).toBe(50);
    // ...but perfect on everything whose time has come.
    expect(summary.percentOfElapsed).toBe(100);
  });

  it('counts a late dose as taken — the tablet still went in', () => {
    const summary = summariseAdherence([dose('taken_late', '2026-08-04T07:00:00Z')], now);
    expect(summary.taken).toBe(1);
    expect(summary.percentOfCourse).toBe(100);
  });
});

describe('countConsecutiveMisses', () => {
  it('is zero for a patient who has not missed anything', () => {
    expect(
      countConsecutiveMisses([
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('taken', '2026-08-04T12:00:00Z'),
      ]),
    ).toBe(0);
  });

  it('counts a run of misses at the end of the course', () => {
    expect(
      countConsecutiveMisses([
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('missed', '2026-08-04T12:00:00Z'),
        dose('missed', '2026-08-04T19:00:00Z'),
      ]),
    ).toBe(2);
  });

  it('resets once the patient takes one again', () => {
    expect(
      countConsecutiveMisses([
        dose('missed', '2026-08-04T07:00:00Z'),
        dose('missed', '2026-08-04T12:00:00Z'),
        dose('taken', '2026-08-04T19:00:00Z'),
      ]),
    ).toBe(0);
  });

  it('ignores doses that have not come round yet', () => {
    expect(
      countConsecutiveMisses([
        dose('missed', '2026-08-04T07:00:00Z'),
        dose('scheduled', '2026-08-05T07:00:00Z'),
        dose('scheduled', '2026-08-05T12:00:00Z'),
      ]),
    ).toBe(1);
  });

  it('reads doses in schedule order, not array order', () => {
    expect(
      countConsecutiveMisses([
        dose('missed', '2026-08-04T19:00:00Z'),
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('missed', '2026-08-04T12:00:00Z'),
      ]),
    ).toBe(2);
  });

  it('treats a deliberate skip as a break in the streak too', () => {
    expect(
      countConsecutiveMisses([
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('skipped', '2026-08-04T12:00:00Z'),
      ]),
    ).toBe(1);
  });
});

describe('longestTakenStreak', () => {
  it('finds the best run in the course', () => {
    expect(
      longestTakenStreak([
        dose('taken', '2026-08-04T07:00:00Z'),
        dose('missed', '2026-08-04T12:00:00Z'),
        dose('taken', '2026-08-04T19:00:00Z'),
        dose('taken', '2026-08-05T07:00:00Z'),
        dose('taken', '2026-08-05T12:00:00Z'),
      ]),
    ).toBe(3);
  });

  it('is zero when nothing has been taken', () => {
    expect(longestTakenStreak([dose('missed', '2026-08-04T07:00:00Z')])).toBe(0);
  });
});

describe('shouldShowFeelBetterNudge', () => {
  it('fires on the days people actually stop', () => {
    expect(shouldShowFeelBetterNudge(3, 9, 7)).toBe(true);
    expect(shouldShowFeelBetterNudge(4, 9, 7)).toBe(true);
  });

  it('stays quiet in the first two days, while symptoms are still doing the reminding', () => {
    expect(shouldShowFeelBetterNudge(1, 18, 7)).toBe(false);
    expect(shouldShowFeelBetterNudge(2, 15, 7)).toBe(false);
  });

  it('stops once the course is nearly done', () => {
    expect(shouldShowFeelBetterNudge(6, 3, 7)).toBe(false);
  });

  it('never nags someone who has already finished', () => {
    expect(shouldShowFeelBetterNudge(4, 0, 7)).toBe(false);
  });

  it('does not apply to a course too short to have a day 3 slump', () => {
    expect(shouldShowFeelBetterNudge(3, 1, 3)).toBe(false);
  });

  it('handles a course that has not started', () => {
    expect(shouldShowFeelBetterNudge(null, 21, 7)).toBe(false);
  });
});

describe('needsRefillWarning', () => {
  it('says nothing when the count is unknown', () => {
    expect(needsRefillWarning(null, 10, 3)).toBe(false);
  });

  it('stays quiet when there is plenty left', () => {
    expect(needsRefillWarning(11, 9, 3)).toBe(false);
  });

  it('warns when what is left will not cover what is scheduled', () => {
    expect(needsRefillWarning(6, 9, 3)).toBe(true);
  });

  it('warns on the last day even when the numbers technically balance', () => {
    expect(needsRefillWarning(3, 3, 3)).toBe(true);
  });

  it('warns when the patient has run out entirely', () => {
    expect(needsRefillWarning(0, 5, 3)).toBe(true);
  });
});
