import {
  MINUTE_MS,
  type DoseAnchor,
  type FoodRule,
  type TimeOfDay,
} from '../schemas/common.js';
import type { Mealtimes } from '../schemas/patient.js';
import type { Frequency } from '../schemas/prescription.js';
import { calendarDaysBetween, timeOnDay } from './time.js';

/**
 * Turning a prescription into a schedule.
 *
 * This is the step the design calls "reads it and builds the plan": the doctor
 * writes "three times a day for 7 days, after food" and the agent has to
 * produce twenty-one specific instants, placed around when this particular
 * patient actually eats. Pure functions, no I/O — the planner is the piece most
 * worth testing, so nothing here touches a database or a clock it wasn't given.
 */

/** Which anchors to use when the prescription does not name them. */
export function defaultAnchorsFor(timesPerDay: number): DoseAnchor[] {
  switch (timesPerDay) {
    case 1:
      return ['breakfast'];
    case 2:
      return ['breakfast', 'dinner'];
    case 3:
      return ['breakfast', 'lunch', 'dinner'];
    case 4:
      return ['breakfast', 'lunch', 'dinner', 'bedtime'];
    case 5:
      return ['waking', 'breakfast', 'lunch', 'dinner', 'bedtime'];
    default:
      return ['waking', 'breakfast', 'lunch', 'dinner', 'bedtime', 'bedtime'];
  }
}

/** How far from the meal a dose sits, when the prescription does not say. */
export function defaultOffsetFor(foodRule: FoodRule): number {
  switch (foodRule) {
    case 'before_food':
      return -30;
    case 'after_food':
      return 30;
    case 'with_food':
    case 'any':
      return 0;
  }
}

/** An anchor resolved against this patient's own mealtimes. */
export function anchorTime(anchor: DoseAnchor, mealtimes: Mealtimes): TimeOfDay {
  switch (anchor) {
    case 'breakfast':
      return mealtimes.breakfast;
    case 'lunch':
      return mealtimes.lunch;
    case 'dinner':
      return mealtimes.dinner;
    case 'bedtime':
      return mealtimes.bedtime;
    case 'waking':
      return mealtimes.breakfast;
  }
}

export interface PlannedDose {
  doseNumber: number;
  dayNumber: number;
  anchor: DoseAnchor;
  scheduledAt: Date;
}

export interface PlanDosesInput {
  frequency: Frequency;
  /** Null plans `openEndedDays` worth of doses for a medicine with no end. */
  durationDays: number | null;
  mealtimes: Mealtimes;
  timeZone: string;
  /** When the clock starts — the moment the patient confirms they have it. */
  startAt: Date;
  /** How far ahead to plan an open-ended course. */
  openEndedDays?: number;
}

/**
 * Lay out every dose of a course.
 *
 * Doses always start at the first anchor slot at or after `startAt`, so
 * confirming the medicine at 2pm does not silently drop the morning dose — it
 * shifts the whole course later and still delivers the full count. A seven-day
 * course started at lunchtime therefore finishes on day eight, which is the
 * correct clinical outcome: what matters is that all 21 tablets are taken.
 */
export function planDoses(input: PlanDosesInput): PlannedDose[] {
  const { frequency, durationDays, mealtimes, timeZone, startAt } = input;
  const openEndedDays = input.openEndedDays ?? 30;

  const anchors = frequency.anchors ?? defaultAnchorsFor(frequency.timesPerDay);
  const offsetMinutes = frequency.offsetMinutes ?? defaultOffsetFor(frequency.foodRule);
  const effectiveDays = durationDays ?? openEndedDays;
  const totalDoses = frequency.timesPerDay * effectiveDays;

  // Build slots day by day and keep the ones at or after startAt, until the
  // full count is reached. Scanning a generous window keeps this terminating
  // even when every slot on the first day has already passed.
  const planned: PlannedDose[] = [];
  const maxDaysToScan = effectiveDays + 2;
  let firstDay: number | null = null;

  for (let dayOffset = 0; dayOffset < maxDaysToScan && planned.length < totalDoses; dayOffset += 1) {
    for (const anchor of anchors) {
      if (planned.length >= totalDoses) break;

      const base = timeOnDay(startAt, dayOffset, anchorTime(anchor, mealtimes), timeZone);
      const scheduledAt = new Date(base.getTime() + offsetMinutes * MINUTE_MS);
      if (scheduledAt.getTime() < startAt.getTime()) continue;

      if (firstDay === null) firstDay = dayOffset;
      planned.push({
        doseNumber: planned.length + 1,
        dayNumber: dayOffset - firstDay + 1,
        anchor,
        scheduledAt,
      });
    }
  }

  // Anchors are not guaranteed to be in chronological order (a prescription may
  // list bedtime before lunch), so sort and renumber to keep doseNumber
  // meaningful as "the nth tablet you take".
  planned.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return planned.map((dose, index) => ({ ...dose, doseNumber: index + 1 }));
}

export interface SpacingRule {
  medicationName: string;
  otherMedicationName: string;
  minimumMinutesApart: number;
}

export interface SpacedDose {
  medicationName: string;
  scheduledAt: Date;
}

/**
 * Push doses apart until every spacing rule is satisfied.
 *
 * Two drugs from the same prescription can legitimately land on the same
 * mealtime — a stomach protector before breakfast and an antibiotic after it.
 * When a rule says they must be kept apart, the *later* dose moves, never the
 * earlier one, so the anchor the patient was told about stays put.
 *
 * Returns a new array; the input is not modified.
 */
export function applySpacing<T extends SpacedDose>(doses: readonly T[], rules: readonly SpacingRule[]): T[] {
  if (rules.length === 0) return doses.map((d) => ({ ...d }));

  const minimumFor = (a: string, b: string): number | null => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    let minutes: number | null = null;
    for (const rule of rules) {
      const matches =
        (rule.medicationName.toLowerCase() === left &&
          rule.otherMedicationName.toLowerCase() === right) ||
        (rule.medicationName.toLowerCase() === right &&
          rule.otherMedicationName.toLowerCase() === left);
      if (matches) minutes = Math.max(minutes ?? 0, rule.minimumMinutesApart);
    }
    return minutes;
  };

  const ordered = doses
    .map((d) => ({ ...d }))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  for (let i = 1; i < ordered.length; i += 1) {
    const current = ordered[i];
    if (!current) continue;

    // Only earlier doses can constrain this one, and only the closest
    // conflicting neighbour matters once we move forward in time.
    for (let j = 0; j < i; j += 1) {
      const earlier = ordered[j];
      if (!earlier) continue;
      if (earlier.medicationName === current.medicationName) continue;

      const minimum = minimumFor(earlier.medicationName, current.medicationName);
      if (minimum === null) continue;

      const gapMs = current.scheduledAt.getTime() - earlier.scheduledAt.getTime();
      const requiredMs = minimum * MINUTE_MS;
      if (gapMs < requiredMs) {
        current.scheduledAt = new Date(earlier.scheduledAt.getTime() + requiredMs);
      }
    }
  }

  return ordered.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/**
 * How late the patient habitually is, from their own history.
 *
 * The design's "learns when she actually takes each dose and moves the reminder
 * to match". A median rather than a mean, so one forgotten afternoon does not
 * drag every future reminder an hour later. Returns 0 until there is enough
 * evidence to act on.
 */
export function learnDriftMinutes(
  samples: readonly { scheduledAt: Date; takenAt: Date }[],
  minimumSamples = 3,
): number {
  if (samples.length < minimumSamples) return 0;

  const deltas = samples
    .map((s) => Math.round((s.takenAt.getTime() - s.scheduledAt.getTime()) / MINUTE_MS))
    // Ignore wild outliers — a dose taken six hours late is a miss, not drift.
    .filter((minutes) => Math.abs(minutes) <= 180)
    .sort((a, b) => a - b);

  if (deltas.length < minimumSamples) return 0;

  const middle = Math.floor(deltas.length / 2);
  const median =
    deltas.length % 2 === 0
      ? Math.round(((deltas[middle - 1] ?? 0) + (deltas[middle] ?? 0)) / 2)
      : (deltas[middle] ?? 0);

  // Only act on a drift big enough to be worth moving a reminder for.
  return Math.abs(median) >= 10 ? median : 0;
}

/**
 * Reschedule what is left of a course after a miss.
 *
 * The goal never changes: every dose gets taken. So the remaining doses keep
 * their spacing and slide later, and the course's end date moves out rather
 * than a tablet being dropped to keep the original finish date.
 */
export function replanRemaining(
  remaining: readonly PlannedDose[],
  shiftMinutes: number,
): PlannedDose[] {
  if (shiftMinutes === 0) return remaining.map((d) => ({ ...d }));
  return remaining.map((dose) => ({
    ...dose,
    scheduledAt: new Date(dose.scheduledAt.getTime() + shiftMinutes * MINUTE_MS),
  }));
}

/** Day number of `instant` within a course that began on `startedAt`. */
export function dayNumberFor(startedAt: Date, instant: Date, timeZone: string): number {
  return calendarDaysBetween(startedAt, instant, timeZone) + 1;
}
