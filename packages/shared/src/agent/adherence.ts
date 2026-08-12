import type { CourseProgress } from '../schemas/course.js';
import type { Dose, DoseStatus } from '../schemas/dose.js';
import { calendarDaysBetween } from './time.js';

/** Statuses that count as the patient having actually taken the tablet. */
const TAKEN_STATUSES: readonly DoseStatus[] = ['taken', 'taken_late'];

export function isTaken(status: DoseStatus): boolean {
  return TAKEN_STATUSES.includes(status);
}

export interface AdherenceSummary {
  total: number;
  taken: number;
  missed: number;
  skipped: number;
  pending: number;
  /** Taken as a share of doses whose time has passed. 100 when none have. */
  percentOfElapsed: number;
  /** Taken as a share of the whole course. The number the design cares about. */
  percentOfCourse: number;
  consecutiveMisses: number;
  longestStreak: number;
}

/**
 * Adherence over a set of doses.
 *
 * Two percentages, because they answer different questions. `percentOfCourse`
 * is progress towards the finish line — the ring on the home screen.
 * `percentOfElapsed` is how well the patient is doing *so far*, which is the
 * only fair basis for the agent deciding whether to be more persistent.
 */
export function summariseAdherence(doses: readonly Dose[], now: Date = new Date()): AdherenceSummary {
  let taken = 0;
  let missed = 0;
  let skipped = 0;
  let elapsed = 0;

  for (const dose of doses) {
    if (isTaken(dose.status)) taken += 1;
    else if (dose.status === 'missed') missed += 1;
    else if (dose.status === 'skipped') skipped += 1;

    if (dose.scheduledAt.getTime() <= now.getTime()) elapsed += 1;
  }

  const total = doses.length;
  const pending = total - taken - missed - skipped;

  return {
    total,
    taken,
    missed,
    skipped,
    pending,
    percentOfElapsed: elapsed === 0 ? 100 : Math.round((taken / elapsed) * 100),
    percentOfCourse: total === 0 ? 0 : Math.round((taken / total) * 100),
    consecutiveMisses: countConsecutiveMisses(doses),
    longestStreak: longestTakenStreak(doses),
  };
}

/**
 * Misses at the tail of the course, in schedule order.
 *
 * Counts back from the most recent settled dose and stops at the first one that
 * was taken. Pending doses are ignored — a dose whose time has not come is not
 * evidence of anything.
 */
export function countConsecutiveMisses(doses: readonly Dose[]): number {
  const settled = [...doses]
    .filter((d) => d.status === 'missed' || d.status === 'skipped' || isTaken(d.status))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  let count = 0;
  for (let i = settled.length - 1; i >= 0; i -= 1) {
    const dose = settled[i];
    if (!dose) break;
    if (isTaken(dose.status)) break;
    count += 1;
  }
  return count;
}

export function longestTakenStreak(doses: readonly Dose[]): number {
  const ordered = [...doses].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  let best = 0;
  let current = 0;
  for (const dose of ordered) {
    if (isTaken(dose.status)) {
      current += 1;
      best = Math.max(best, current);
    } else if (dose.status === 'missed' || dose.status === 'skipped') {
      current = 0;
    }
  }
  return best;
}

export interface BuildCourseProgressInput {
  courseId: string;
  medicationName: string;
  status: CourseProgress['status'];
  totalDoses: number | null;
  unitsRemaining: number | null;
  startedAt: Date | null;
  doses: readonly Dose[];
  timeZone: string;
  now?: Date;
}

export function buildCourseProgress(input: BuildCourseProgressInput): CourseProgress {
  const now = input.now ?? new Date();
  const summary = summariseAdherence(input.doses, now);
  const total = input.totalDoses ?? input.doses.length;

  return {
    courseId: input.courseId,
    medicationName: input.medicationName,
    status: input.status,
    totalDoses: input.totalDoses,
    takenCount: summary.taken,
    missedCount: summary.missed,
    skippedCount: summary.skipped,
    remainingCount: input.totalDoses === null ? null : Math.max(0, total - summary.taken),
    percentComplete: total === 0 ? 0 : Math.min(100, Math.round((summary.taken / total) * 100)),
    dayNumber: input.startedAt
      ? Math.max(1, calendarDaysBetween(input.startedAt, now, input.timeZone) + 1)
      : null,
    unitsRemaining: input.unitsRemaining,
  };
}

/**
 * Whether this is the moment to pre-empt the "I feel better" drop-off.
 *
 * The design is specific: day 3–4 of a course is when people stop, because the
 * symptom that was doing the reminding has gone. The nudge is shown then, and
 * only while doses actually remain — congratulating someone into finishing a
 * course they have already finished reads as noise.
 */
export function shouldShowFeelBetterNudge(
  dayNumber: number | null,
  remainingDoses: number,
  courseDurationDays: number | null,
): boolean {
  if (dayNumber === null || remainingDoses <= 0) return false;
  if (courseDurationDays !== null && courseDurationDays <= 3) return false;
  return dayNumber >= 3 && dayNumber <= 5;
}

/**
 * Whether to warn about running out.
 *
 * Fires when what is left on the shelf will not cover what is still scheduled,
 * with a day of slack so the warning arrives before the last tablet.
 */
export function needsRefillWarning(
  unitsRemaining: number | null,
  dosesRemaining: number,
  dosesPerDay: number,
): boolean {
  if (unitsRemaining === null) return false;
  return unitsRemaining < dosesRemaining || unitsRemaining <= dosesPerDay;
}
