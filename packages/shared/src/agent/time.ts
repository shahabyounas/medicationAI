import { MINUTE_MS, type TimeOfDay } from '../schemas/common.js';

/**
 * Timezone helpers built on `Intl`, so the package stays dependency-free.
 *
 * Everything is stored as a UTC instant. These functions are the only place
 * that converts between an instant and the wall-clock time the patient sees —
 * which matters because "take it at 8am" must survive a clock change.
 */

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
}

const PART_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The wall-clock reading an observer in `timeZone` sees at `instant`. */
export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup = new Map(parts.map((p) => [p.type, p.value]));
  const read = (key: (typeof PART_KEYS)[number]): number => {
    const raw = lookup.get(key);
    if (raw === undefined) throw new Error(`Intl did not return a "${key}" part for ${timeZone}`);
    return Number.parseInt(raw, 10);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Discard sub-second precision so the difference is a clean offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which `timeZone`'s wall clock reads the given date and time.
 *
 * Two passes: guess using UTC, then correct by the offset that actually applies
 * at the guessed instant. The second pass is what makes DST transitions land on
 * the right side of the jump.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
  const corrected = guess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(corrected), timeZone);
  return new Date(guess - secondOffset);
}

export function parseTimeOfDay(time: TimeOfDay): { hour: number; minute: number } {
  const [hourPart, minutePart] = time.split(':');
  const hour = Number.parseInt(hourPart ?? '', 10);
  const minute = Number.parseInt(minutePart ?? '', 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`invalid time of day: "${time}"`);
  }
  return { hour, minute };
}

/**
 * The instant of `time` on the calendar day `dayOffset` days after the day
 * `reference` falls on, read in `timeZone`.
 */
export function timeOnDay(
  reference: Date,
  dayOffset: number,
  time: TimeOfDay,
  timeZone: string,
): Date {
  const wall = wallClockIn(reference, timeZone);
  const { hour, minute } = parseTimeOfDay(time);
  // Date.UTC normalises overflow, so day + 40 rolls into the next month.
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + dayOffset));
  const shiftedWall = wallClockIn(shifted, 'UTC');
  return zonedTimeToInstant(
    shiftedWall.year,
    shiftedWall.month,
    shiftedWall.day,
    hour,
    minute,
    timeZone,
  );
}

/** Whether two instants fall on the same calendar day in `timeZone`. */
export function isSameDayIn(a: Date, b: Date, timeZone: string): boolean {
  const wa = wallClockIn(a, timeZone);
  const wb = wallClockIn(b, timeZone);
  return wa.year === wb.year && wa.month === wb.month && wa.day === wb.day;
}

/** Whole calendar days between two instants in `timeZone`. Can be negative. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const wa = wallClockIn(from, timeZone);
  const wb = wallClockIn(to, timeZone);
  const dayA = Date.UTC(wa.year, wa.month - 1, wa.day);
  const dayB = Date.UTC(wb.year, wb.month - 1, wb.day);
  return Math.round((dayB - dayA) / (24 * 60 * MINUTE_MS));
}

/** "2:00 PM" — the format the patient-facing copy uses throughout. */
export function formatClockTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(instant)
    .replace(/ /g, ' ')
    .toUpperCase();
}

/** "4 August" */
export function formatDayMonth(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).format(instant);
}
