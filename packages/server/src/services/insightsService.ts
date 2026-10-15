import {
  COURSE_STATUS_LABELS,
  DOSE_STATUS_LABELS,
  ESCALATION_GRAPH,
  MINUTE_MS,
  ON_TIME_GRACE_MINUTES,
  SIDE_EFFECT_SEVERITY_LABELS,
  anchorTime,
  calendarDaysBetween,
  formatClockTime,
  formatDayMonth,
  isTaken,
  summariseAdherence,
  wallClockIn,
  type AnchorAdherence,
  type Condition,
  type Course,
  type Dose,
  type DoseAnchor,
  type DoseCell,
  type DoseGrid,
  type EscalationUse,
  type InsightsResponse,
  type MonthlyAdherence,
  type Patient,
  type Punctuality,
  type TimelineEpisode,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { buildReadings } from './readingService.js';
import { buildSymptomSeries } from './symptomService.js';

/**
 * The screen where the app finally shows the patient what it knows.
 *
 * Every number here was already in the database and none of it was ever on a
 * screen: the planned time and the actual time of every dose, the anchor each
 * one hangs off, the drift the agent quietly taught itself, which rung of the
 * ladder settled each chase. A patient could see a progress bar and a
 * percentage, which is the one summary that tells them nothing they can act on.
 *
 * Three principles hold it together:
 *
 *   - **Patterns, not scores.** "You are 81% adherent" is a mark out of ten for
 *     being ill. "Your supper dose is missed three times as often as the other
 *     two, and your supper is set to 20:00" is a thing to go and change.
 *   - **Honest denominators.** Nothing is counted against a dose whose time has
 *     not come. Mid-course, "8 of 21" reads as failure when thirteen were never
 *     due; the same mistake across a chart screen would be constant.
 *   - **No judgement on a reading.** Readings and symptoms are drawn, labelled
 *     and left alone. What a number means is a conversation with a person.
 *
 * It is one payload because it is one screen, and because all of it derives
 * from the same two queries — the doses and the agent's own events.
 */
const ENOUGH_SETTLED_DOSES = 5;

/** Days of a course the grid shows at once. */
const MAX_GRID_ROWS = 21;

/** Dots on the punctuality plot. Past this it is a cloud, not a pattern. */
const MAX_PUNCTUALITY_POINTS = 400;

export async function buildInsights(
  patientId: string,
  now = new Date(),
): Promise<InsightsResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const [courses, doses, conditions, events, openReports, readings, symptoms] = await Promise.all([
    collections.courses.find({ patientId }),
    collections.doses.find({ patientId }, { sort: { scheduledAt: 1 } }),
    collections.conditions.find({ patientId }, { sort: { startedAt: -1 } }),
    collections.agentEvents.find({ patientId }),
    collections.sideEffects.find({ patientId, resolvedAt: null }, { sort: { reportedAt: -1 } }),
    buildReadings(patientId, now),
    buildSymptomSeries(patientId, now),
  ]);

  // Self-managed courses without reminders have no doses, so they contribute
  // nothing to adherence — which is right: there is no plan to adhere to.
  const settled = doses.filter((dose) => isSettled(dose, now));
  const summary = summariseAdherence(doses, now);

  const grids = await buildGrids(courses, doses, conditions, patient, now);

  return {
    patientName: patient.name,
    timeZone: tz,
    headline: headlineFor(settled.length, summary.percentOfElapsed, grids),
    hasEnoughData: settled.length >= ENOUGH_SETTLED_DOSES,
    settledDoses: settled.length,
    overall: {
      taken: doses.filter((d) => d.status === 'taken').length,
      late: doses.filter((d) => d.status === 'taken_late').length,
      missed: summary.missed,
      skipped: summary.skipped,
      pending: summary.pending,
      percentOfElapsed: summary.percentOfElapsed,
      longestStreak: summary.longestStreak,
      currentStreak: currentStreak(doses),
      coursesCompleted: courses.filter((c) => c.status === 'completed').length,
      coursesStoppedEarly: courses.filter((c) => c.status === 'stopped_early').length,
    },
    byAnchor: byAnchor(doses, patient, now),
    punctuality: punctuality(doses, courses, tz),
    monthly: monthly(doses, tz, now),
    grids,
    escalation: escalationUse(events),
    timeline: timeline(conditions, courses, doses, tz, now),
    symptoms,
    // Only the metrics with points: an empty chart on an insights screen is a
    // blank rectangle, and the Readings screen is where the invitation to start
    // measuring belongs.
    readings: readings.series.filter((series) => series.points.length > 0),
    openSideEffects: openReports.map((report) => ({
      medicationName: report.medicationName,
      symptom: report.symptom,
      severityLabel: SIDE_EFFECT_SEVERITY_LABELS[report.severity],
      startedLabel: formatDayMonth(report.startedAt, tz),
    })),
  };
}

function isSettled(dose: Dose, now: Date): boolean {
  if (isTaken(dose.status) || dose.status === 'missed' || dose.status === 'skipped') return true;
  return dose.scheduledAt.getTime() <= now.getTime();
}

/**
 * One sentence about the whole picture, or the honest admission.
 *
 * A chart screen that draws three dots and calls them a trend is worse than one
 * that says come back later, so below five settled doses it says so and the
 * client draws the empty state instead.
 */
function headlineFor(
  settledCount: number,
  percentOfElapsed: number,
  grids: readonly DoseGrid[],
): string {
  if (settledCount === 0) {
    return 'Nothing to chart yet. Once a few doses have come and gone, this is where the pattern shows up.';
  }
  if (settledCount < ENOUGH_SETTLED_DOSES) {
    return `${settledCount} ${settledCount === 1 ? 'dose' : 'doses'} so far — a few more and there will be a pattern worth showing you.`;
  }

  const running = grids.filter((grid) => grid.status === 'active').length;
  const tail =
    running === 0
      ? ''
      : ` ${running} ${running === 1 ? 'course is' : 'courses are'} still running.`;

  return `${percentOfElapsed}% of the doses that have come due were taken.${tail}`;
}

/** Taken in a row, counting back from the most recent settled dose. */
function currentStreak(doses: readonly Dose[]): number {
  const settled = [...doses]
    .filter((d) => isTaken(d.status) || d.status === 'missed' || d.status === 'skipped')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i -= 1) {
    if (!isTaken(settled[i]!.status)) break;
    streak += 1;
  }
  return streak;
}

/* -------------------------------------------------------------------------- */
/* By mealtime                                                                */
/* -------------------------------------------------------------------------- */

const ANCHOR_LABELS: Record<DoseAnchor, string> = {
  waking: 'First thing',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Supper',
  bedtime: 'Bedtime',
};

/**
 * Adherence by the point of day a dose hangs off.
 *
 * The most directly actionable chart in the app, and it sits next to the one
 * control that fixes what it shows: if supper doses are missed twice as often
 * as the others, the supper time is probably wrong, and the mealtimes editor
 * moves every dose still to come.
 */
function byAnchor(doses: readonly Dose[], patient: Patient, now: Date): AnchorAdherence[] {
  const order: DoseAnchor[] = ['waking', 'breakfast', 'lunch', 'dinner', 'bedtime'];

  return order
    .map((anchor) => {
      const theirs = doses.filter((dose) => dose.anchor === anchor);
      const settled = theirs.filter((dose) => isSettled(dose, now));
      const taken = settled.filter((dose) => dose.status === 'taken').length;
      const late = settled.filter((dose) => dose.status === 'taken_late').length;

      return {
        anchor,
        label: ANCHOR_LABELS[anchor],
        clockTime:
          anchor === 'waking'
            ? patient.mealtimes.breakfast
            : anchorTime(anchor, patient.mealtimes),
        taken,
        late,
        missed: settled.filter((dose) => dose.status === 'missed').length,
        skipped: settled.filter((dose) => dose.status === 'skipped').length,
        settled: settled.length,
        percent:
          settled.length === 0 ? 0 : Math.round(((taken + late) / settled.length) * 100),
      };
    })
    .filter((row) => row.settled > 0 || row.anchor !== 'waking');
}

/* -------------------------------------------------------------------------- */
/* Punctuality                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How late, rather than whether.
 *
 * `learnedDriftMinutes` has been computed from this since the beginning and
 * folded into future reminder times without anybody ever being told. Drawing it
 * turns a piece of invisible magic into something the patient can agree or
 * disagree with — and "you take your morning tablet about forty minutes after
 * I ask" is a far more useful thing to know about yourself than a percentage.
 */
function punctuality(
  doses: readonly Dose[],
  courses: readonly Course[],
  timeZone: string,
): Punctuality {
  const taken = doses.filter((dose) => isTaken(dose.status) && dose.takenAt !== null);

  const lateness = taken.map((dose) =>
    Math.round((dose.takenAt!.getTime() - dose.originallyScheduledAt.getTime()) / MINUTE_MS),
  );

  const onTime = lateness.filter((minutes) => minutes <= ON_TIME_GRACE_MINUTES).length;
  const sorted = [...lateness].sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]!;

  const buckets = [
    { label: 'Early', fromMinutes: null, toMinutes: -5 },
    { label: 'On the dot', fromMinutes: -5, toMinutes: 15 },
    { label: 'Within the hour', fromMinutes: 15, toMinutes: 60 },
    { label: 'Hours late', fromMinutes: 60, toMinutes: 240 },
    { label: 'Much later', fromMinutes: 240, toMinutes: null },
  ].map((bucket) => ({
    ...bucket,
    count: lateness.filter(
      (minutes) =>
        (bucket.fromMinutes === null || minutes >= bucket.fromMinutes) &&
        (bucket.toMinutes === null || minutes < bucket.toMinutes),
    ).length,
  }));

  // The drift the agent has settled on across the running courses. Averaged
  // because it is learned per course and this is one number about the patient.
  const active = courses.filter((course) => course.status === 'active');
  const drift =
    active.length === 0
      ? 0
      : Math.round(
          active.reduce((sum, course) => sum + course.learnedDriftMinutes, 0) / active.length,
        );

  return {
    onTimePercent: taken.length === 0 ? 100 : Math.round((onTime / taken.length) * 100),
    medianMinutesLate: median,
    learnedDriftMinutes: drift,
    driftNote:
      Math.abs(drift) < 10
        ? null
        : drift > 0
          ? `You tend to take things about ${drift} minutes after I ask, so I now remind you that much earlier.`
          : `You tend to be about ${Math.abs(drift)} minutes ahead of me, so I now remind you later.`,
    buckets,
    // Most recent first in the slice, then back into time order for drawing.
    points: taken.slice(-MAX_PUNCTUALITY_POINTS).map((dose) => {
      const clock = wallClockIn(dose.originallyScheduledAt, timeZone);
      return {
        doseId: dose._id,
        scheduledMinuteOfDay: clock.hour * 60 + clock.minute,
        minutesLate: Math.round(
          (dose.takenAt!.getTime() - dose.originallyScheduledAt.getTime()) / MINUTE_MS,
        ),
        dateLabel: formatDayMonth(dose.scheduledAt, timeZone),
        clockTime: formatClockTime(dose.originallyScheduledAt, timeZone),
        medicationName: dose.medicationName,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Month by month                                                             */
/* -------------------------------------------------------------------------- */

function monthly(doses: readonly Dose[], timeZone: string, now: Date): MonthlyAdherence[] {
  const buckets = new Map<string, { taken: number; due: number; label: string }>();

  for (const dose of doses) {
    if (!isSettled(dose, now)) continue;
    const clock = wallClockIn(dose.scheduledAt, timeZone);
    const key = `${clock.year}-${String(clock.month).padStart(2, '0')}`;
    const existing = buckets.get(key) ?? {
      taken: 0,
      due: 0,
      label: monthLabel(dose.scheduledAt, timeZone),
    };
    existing.due += 1;
    if (isTaken(dose.status)) existing.taken += 1;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      label: bucket.label,
      taken: bucket.taken,
      due: bucket.due,
      percent: bucket.due === 0 ? 0 : Math.round((bucket.taken / bucket.due) * 100),
    }));
}

function monthLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: 'short',
    year: '2-digit',
  }).format(instant);
}

/* -------------------------------------------------------------------------- */
/* The dose grid                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A course as days down and doses across.
 *
 * `dayCells` on the home screen collapses a whole day into one square, so a day
 * where two of three doses were missed looks exactly like a day where one was.
 * At the dose level the real pattern appears, and it is almost always a column
 * rather than a scatter: it is the evening dose that goes, every day. That is a
 * fact somebody can act on.
 */
async function buildGrids(
  courses: readonly Course[],
  doses: readonly Dose[],
  conditions: readonly Condition[],
  patient: Patient,
  now: Date,
): Promise<DoseGrid[]> {
  const tz = patient.timezone;
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  // Newest first, and only courses that actually have a plan behind them.
  const withDoses = courses
    .filter((course) => doses.some((dose) => dose.courseId === course._id))
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
    .slice(0, 12);

  return withDoses.map((course) => {
    const theirs = doses
      .filter((dose) => dose.courseId === course._id)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    const byDay = new Map<number, Dose[]>();
    for (const dose of theirs) {
      byDay.set(dose.dayNumber, [...(byDay.get(dose.dayNumber) ?? []), dose]);
    }

    const width = Math.max(course.frequency.timesPerDay, ...[...byDay.values()].map((d) => d.length));

    // Column headings come from the widest day rather than from the frequency,
    // so a course whose first day started at lunchtime still lines up.
    const widest = [...byDay.values()].reduce(
      (best, day) => (day.length > best.length ? day : best),
      [] as Dose[],
    );
    const columns = Array.from({ length: width }, (_, index) => {
      const dose = widest[index];
      return {
        anchor: dose?.anchor ?? 'breakfast',
        label: dose ? formatClockTime(dose.originallyScheduledAt, tz) : `Dose ${index + 1}`,
      };
    });

    /**
     * The most recent three weeks, at most.
     *
     * A seven-day course fits whole, which is the case that matters. An
     * open-ended one does not have a length — the loop tops its doses up
     * forever — so without a cap the grid for a diabetes tablet grows a row a
     * day for years, and the payload with it.
     */
    const allDays = [...byDay.keys()].sort((a, b) => a - b);
    const shownDays = new Set(allDays.slice(-MAX_GRID_ROWS));

    const rows = [...byDay.entries()]
      .filter(([day]) => shownDays.has(day))
      .sort(([a], [b]) => a - b)
      .map(([day, dayDoses]) => {
        const ordered = [...dayDoses].sort(
          (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
        );
        const cells: (DoseCell | null)[] = Array.from({ length: width }, (_, index) => {
          const dose = ordered[index];
          if (!dose) return null;
          return toCell(dose, tz);
        });

        const first = ordered[0];
        return {
          day,
          dateLabel: first ? formatDayMonth(first.scheduledAt, tz) : `Day ${day}`,
          isToday: first
            ? calendarDaysBetween(first.scheduledAt, now, tz) === 0
            : false,
          cells,
        };
      });

    return {
      courseId: course._id,
      medicationName: course.medicationName,
      conditionName: course.conditionId
        ? (conditionsById.get(course.conditionId)?.name ?? null)
        : null,
      origin: course.origin,
      timesPerDay: course.frequency.timesPerDay,
      status: course.status,
      statusLabel: COURSE_STATUS_LABELS[course.status],
      hasFinishLine: course.totalDoses !== null,
      rowsTruncated: allDays.length > shownDays.size,
      columns,
      rows,
      burnDown: burnDown(course, theirs, tz, now),
      projectionNote: projectionNote(course, theirs, tz, now),
    };
  });
}

function toCell(dose: Dose, timeZone: string): DoseCell {
  const minutesLate =
    dose.takenAt === null
      ? null
      : Math.round((dose.takenAt.getTime() - dose.originallyScheduledAt.getTime()) / MINUTE_MS);

  return {
    doseId: dose._id,
    doseNumber: dose.doseNumber,
    status: dose.status,
    statusLabel: DOSE_STATUS_LABELS[dose.status],
    clockTime: formatClockTime(dose.originallyScheduledAt, timeZone),
    takenTimeLabel: dose.takenAt ? formatClockTime(dose.takenAt, timeZone) : null,
    minutesLate,
  };
}

/**
 * Expected against actual, cumulative, by day.
 *
 * The expected line is what the plan said; the actual line is what happened.
 * The gap between them at the right-hand edge is the number of tablets still
 * owed — which is the quantity the product cares about, since the goal is all
 * twenty-one rather than a good percentage.
 */
function burnDown(
  course: Course,
  doses: readonly Dose[],
  timeZone: string,
  now: Date,
): DoseGrid['burnDown'] {
  const days = [...new Set(doses.map((dose) => dose.dayNumber))].sort((a, b) => a - b);

  let expected = 0;
  let actual = 0;

  return days.map((day) => {
    const theirs = doses.filter((dose) => dose.dayNumber === day);
    expected += theirs.length;
    actual += theirs.filter((dose) => isTaken(dose.status)).length;

    const first = theirs[0]!;
    return {
      day,
      dateLabel: formatDayMonth(first.scheduledAt, timeZone),
      expectedTaken: expected,
      actualTaken: actual,
      // Past the present, the actual line stops being a measurement.
      isProjection: first.scheduledAt.getTime() > now.getTime(),
    };
  });
}

/**
 * When the course will actually finish, at the rate it is going.
 *
 * The planner already shifts remaining doses after a miss so the count is
 * preserved and the end date moves — this is that consequence, said out loud.
 * It is arithmetic on the plan, not a prediction about the patient.
 */
function projectionNote(
  course: Course,
  doses: readonly Dose[],
  timeZone: string,
  now: Date,
): string | null {
  if (course.status !== 'active' || course.totalDoses === null) return null;

  const taken = doses.filter((dose) => isTaken(dose.status)).length;
  const outstanding = course.totalDoses - taken;
  if (outstanding <= 0) return null;

  const remaining = doses
    .filter((dose) => dose.status === 'scheduled' || dose.status === 'due')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const last = remaining.at(-1);
  if (!last) {
    return `${outstanding} ${outstanding === 1 ? 'dose' : 'doses'} still owed, and nothing left on the schedule — tell me when you take the rest.`;
  }

  const missedSoFar = doses.filter((dose) => dose.status === 'missed').length;
  const endLabel = formatDayMonth(last.scheduledAt, timeZone);

  if (missedSoFar === 0) {
    return `On track to finish on ${endLabel}.`;
  }

  const daysLate = course.expectedEndAt
    ? calendarDaysBetween(course.expectedEndAt, last.scheduledAt, timeZone)
    : 0;

  return daysLate > 0
    ? `Finishing on ${endLabel} — ${daysLate} ${daysLate === 1 ? 'day' : 'days'} later than first planned, because the doses moved rather than being dropped.`
    : `Finishing on ${endLabel}. The ${missedSoFar} missed ${missedSoFar === 1 ? 'dose was' : 'doses were'} added back on the end.`;
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which rung actually did the work.
 *
 * The agent's own case for existing, and the only honest way to make it. If
 * almost everything settles at the first reminder then this is a reminder app
 * with a great deal of machinery behind it; if the later rungs carry real
 * weight, that is worth knowing. And if the family rung is carrying it, the
 * patient should be the one who finds that out first.
 */
function escalationUse(events: readonly { escalationNodeId: string | null }[]): EscalationUse[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.escalationNodeId) continue;
    counts.set(event.escalationNodeId, (counts.get(event.escalationNodeId) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];

  return Object.values(ESCALATION_GRAPH)
    .filter((node) => !node.terminal)
    .map((node) => {
      const count = counts.get(node.id) ?? 0;
      return {
        nodeId: node.id,
        label: node.label,
        count,
        percent: Math.round((count / total) * 100),
        isFamily: node.channel === 'family',
      };
    })
    .filter((row) => row.count > 0);
}

/* -------------------------------------------------------------------------- */
/* The lifetime timeline                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Illnesses as bars across the years, with the recurrence arrows drawn.
 *
 * `recurrenceOfConditionId` is the strongest thing in this record — a course
 * abandoned in May and the same illness back in October — and until now it has
 * been one line of grey text on a card. As a picture it is the argument the
 * whole product is making.
 */
function timeline(
  conditions: readonly Condition[],
  courses: readonly Course[],
  doses: readonly Dose[],
  timeZone: string,
  now: Date,
): TimelineEpisode[] {
  return conditions.map((condition) => {
    const theirCourses = courses.filter((course) => course.conditionId === condition._id);
    const theirDoses = doses.filter((dose) => dose.conditionId === condition._id);

    const totalDoses = theirCourses.reduce((sum, course) => sum + (course.totalDoses ?? 0), 0);
    const taken = theirDoses.filter((dose) => isTaken(dose.status)).length;
    const endedAt = condition.resolvedAt;

    const state: TimelineEpisode['state'] = condition.isChronic
      ? 'ongoing'
      : theirCourses.some((course) => course.status === 'stopped_early')
        ? 'stopped'
        : endedAt
          ? 'cleared'
          : 'in_progress';

    return {
      conditionId: condition._id,
      name: condition.name,
      startedAt: condition.startedAt,
      endedAt,
      startLabel: formatDayMonth(condition.startedAt, timeZone),
      endLabel: endedAt ? formatDayMonth(endedAt, timeZone) : null,
      durationDays: Math.max(
        0,
        calendarDaysBetween(condition.startedAt, endedAt ?? now, timeZone),
      ),
      state,
      percentComplete: totalDoses === 0 ? 0 : Math.min(100, Math.round((taken / totalDoses) * 100)),
      recurrenceOfConditionId: condition.recurrenceOfConditionId,
      recurrenceNote: null,
    };
  });
}
