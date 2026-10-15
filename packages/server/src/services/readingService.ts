import {
  READING_METRICS,
  ReadingMetricSchema,
  calendarDaysBetween,
  describeReading,
  formatClockTime,
  formatDayMonth,
  readingRecordedMessage,
  type Reading,
  type ReadingMetric,
  type ReadingPoint,
  type ReadingSeries,
  type ReadingsResponse,
  type RecordReadingRequest,
  type Visit,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { logAgentEvent } from './agentEventService.js';

/**
 * What the patient measured about themselves.
 *
 * The only series in the app the patient owns outright, and the only thing a
 * chronic condition has to show for itself — `isChronic` has existed from the
 * start with nothing behind it, because a long-term condition has no course to
 * finish and no tablet to count.
 *
 * The one rule running through all of this: the app records and draws, it does
 * not judge. There is no "that's a bit high" anywhere, and `referenceBand` is
 * the band printed on the monitor's own leaflet rather than a verdict of ours.
 * The patient can see where their number sits; what it means is a conversation
 * with a person.
 */
export async function recordReading(
  input: RecordReadingRequest,
  now = new Date(),
): Promise<{ reading: Reading; message: string }> {
  const patient = await collections.patients.requireById(input.patientId);
  const spec = READING_METRICS[input.metric];

  if (input.value < spec.min || input.value > spec.max) {
    throw new BadRequestError(
      `${spec.label} should be between ${spec.min} and ${spec.max} ${spec.unit}`,
    );
  }
  if (spec.secondValueLabel !== null && input.secondValue === null) {
    throw new BadRequestError(`${spec.label} needs both numbers`);
  }
  if (spec.secondValueLabel === null && input.secondValue !== null) {
    throw new BadRequestError(`${spec.label} is a single number`);
  }
  // A reading in the future is a typed date, not a measurement.
  if (input.takenAt.getTime() > now.getTime() + 60_000) {
    throw new BadRequestError('That is in the future — when did you take it?');
  }

  const reading = await collections.readings.insert({
    patientId: patient._id,
    metric: input.metric,
    takenAt: input.takenAt,
    value: input.value,
    secondValue: input.secondValue,
    source: 'patient',
    visitId: null,
    conditionId: input.conditionId,
    note: input.note ?? null,
  });

  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const countThisMonth = await collections.readings.count({
    patientId: patient._id,
    metric: input.metric,
    takenAt: { $gte: monthStart },
  });

  const message = readingRecordedMessage({
    label: spec.label,
    reading: describeReading(input.metric, input.value, input.secondValue),
    countThisMonth,
  });

  await logAgentEvent({
    patientId: patient._id,
    type: 'reading_recorded',
    occurredAt: now,
    doseId: null,
    courseId: null,
    conditionId: input.conditionId,
    channel: 'internal',
    summary: `${spec.label} ${describeReading(input.metric, input.value, input.secondValue)}`,
    message: null,
    escalationNodeId: null,
    // A carer watching for missed doses does not need every weigh-in.
    visibleToFamily: false,
  });

  return { reading, message };
}

export async function deleteReading(readingId: string): Promise<boolean> {
  return collections.readings.deleteById(readingId);
}

/**
 * Every metric's series, including the empty ones.
 *
 * The empty ones are the point: a screen that lists only what has been measured
 * never tells the patient they could measure anything else, and this app's
 * readings screen starts empty for everybody.
 */
export async function buildReadings(
  patientId: string,
  now = new Date(),
): Promise<ReadingsResponse> {
  const patient = await collections.patients.requireById(patientId);
  const [stored, visits] = await Promise.all([
    collections.readings.find({ patientId }, { sort: { takenAt: 1 } }),
    collections.visits.find({ patientId }, { sort: { visitDate: 1 } }),
  ]);

  // A nurse's measurement and a home one are the same series. Keeping them
  // apart was the old shape's doing: blood pressure lived on the visit as the
  // string "138/82", which cannot be a point on a chart.
  const fromVisits = visits.flatMap((visit) => readingsFromVisit(visit, patient._id));
  const all = [...stored, ...fromVisits].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
  );

  const series = ReadingMetricSchema.options.map((metric) =>
    buildSeries(
      metric,
      all.filter((reading) => reading.metric === metric),
      patient.timezone,
      now,
    ),
  );

  return {
    timeZone: patient.timezone,
    series,
    trackedMetrics: series.filter((s) => s.points.length > 0).map((s) => s.metric),
  };
}

/**
 * The numbers taken at an appointment, as readings.
 *
 * Synthesised rather than written to the collection, so there is exactly one
 * place each fact lives: editing the visit's vitals changes the chart, and no
 * migration can leave two copies disagreeing. The ids are derived from the
 * visit's so they stay stable across requests.
 */
function readingsFromVisit(visit: Visit, patientId: string): Reading[] {
  const vitals = visit.vitals;
  if (!vitals) return [];

  const base = {
    patientId,
    takenAt: visit.visitDate,
    source: 'visit' as const,
    visitId: visit._id,
    conditionId: visit.conditionId,
    note: 'Taken at your appointment',
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };

  const readings: Reading[] = [];
  if (
    vitals.bloodPressureSystolic !== undefined &&
    vitals.bloodPressureDiastolic !== undefined
  ) {
    readings.push({
      ...base,
      _id: derivedId(visit._id, 'bp'),
      metric: 'blood_pressure',
      value: vitals.bloodPressureSystolic,
      secondValue: vitals.bloodPressureDiastolic,
    });
  }
  if (vitals.weightKg !== undefined) {
    readings.push({
      ...base,
      _id: derivedId(visit._id, 'wt'),
      metric: 'weight',
      value: vitals.weightKg,
      secondValue: null,
    });
  }
  if (vitals.temperatureC !== undefined) {
    readings.push({
      ...base,
      _id: derivedId(visit._id, 'tp'),
      metric: 'temperature',
      value: vitals.temperatureC,
      secondValue: null,
    });
  }
  if (vitals.pulseBpm !== undefined) {
    readings.push({
      ...base,
      _id: derivedId(visit._id, 'pl'),
      metric: 'pulse',
      value: vitals.pulseBpm,
      secondValue: null,
    });
  }
  return readings;
}

/**
 * A stable id for a synthesised reading.
 *
 * It has to parse as a UUID, because that is what `IdSchema` promises and the
 * client validates. Overwriting the last three characters of the visit's own id
 * keeps it a well-formed UUID, keeps it stable, and keeps it obviously derived
 * from the visit it came from.
 */
function derivedId(visitId: string, tag: string): string {
  const suffix = tag
    .padEnd(2, '0')
    .slice(0, 2)
    .split('')
    .map((c) => (c.charCodeAt(0) % 16).toString(16))
    .join('');
  return `${visitId.slice(0, -2)}${suffix}`;
}

function buildSeries(
  metric: ReadingMetric,
  readings: readonly Reading[],
  timeZone: string,
  now: Date,
): ReadingSeries {
  const spec = READING_METRICS[metric];

  const points: ReadingPoint[] = readings.map((reading) => ({
    readingId: reading._id,
    takenAt: reading.takenAt,
    dateLabel: formatDayMonth(reading.takenAt, timeZone),
    timeLabel: formatClockTime(reading.takenAt, timeZone),
    value: reading.value,
    secondValue: reading.secondValue,
    label: describeReading(metric, reading.value, reading.secondValue),
    fromVisit: reading.source === 'visit',
    note: reading.note,
  }));

  const latest = points.at(-1) ?? null;

  return {
    metric,
    label: spec.label,
    unit: spec.unit,
    referenceBand: spec.referenceBand,
    hasPair: spec.secondValueLabel !== null,
    decimals: spec.decimals,
    points,
    latestLabel: latest?.label ?? null,
    latestAtLabel: latest ? describeWhen(latest.takenAt, now, timeZone) : null,
    changeLabel: changeLabelFor(metric, points, timeZone),
    averageLabel: averageLabelFor(metric, points),
  };
}

/** "Today", "Yesterday", "3 days ago", "on 14 August". */
function describeWhen(instant: Date, now: Date, timeZone: string): string {
  const days = calendarDaysBetween(instant, now, timeZone);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `on ${formatDayMonth(instant, timeZone)}`;
}

/**
 * The one derived sentence, and deliberately a subtraction.
 *
 * "2.1 kg less than a month ago" is arithmetic the patient could do with the
 * two numbers in front of them. "Your weight is improving" is a judgement, and
 * not one this app is in any position to make.
 */
function changeLabelFor(
  metric: ReadingMetric,
  points: readonly ReadingPoint[],
  timeZone: string,
): string | null {
  if (points.length < 2) return null;
  const spec = READING_METRICS[metric];
  const latest = points.at(-1)!;
  const earlier = points[0]!;

  const delta = latest.value - earlier.value;
  if (Math.abs(delta) < Math.pow(10, -spec.decimals) / 2) {
    return `No change since ${formatDayMonth(earlier.takenAt, timeZone)}`;
  }

  const direction = delta > 0 ? 'more' : 'less';
  const size = Math.abs(delta).toFixed(spec.decimals);
  return `${size} ${spec.unit} ${direction} than on ${formatDayMonth(earlier.takenAt, timeZone)}`;
}

function averageLabelFor(metric: ReadingMetric, points: readonly ReadingPoint[]): string | null {
  if (points.length < 3) return null;
  const spec = READING_METRICS[metric];
  // The last fortnight is what a doctor asks about: "what have they been
  // running at?" A lifetime mean answers a question nobody asked.
  const recent = points.slice(-14);
  const mean = recent.reduce((sum, p) => sum + p.value, 0) / recent.length;

  if (spec.secondValueLabel === null) {
    return `Average of your last ${recent.length}: ${mean.toFixed(spec.decimals)} ${spec.unit}`;
  }

  const second =
    recent.reduce((sum, p) => sum + (p.secondValue ?? 0), 0) / recent.length;
  return `Average of your last ${recent.length}: ${mean.toFixed(spec.decimals)}/${second.toFixed(
    spec.decimals,
  )} ${spec.unit}`;
}
