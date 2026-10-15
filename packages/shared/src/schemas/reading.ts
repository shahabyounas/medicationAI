import { z } from 'zod';
import { DateSchema, IdSchema, TimestampsSchema } from './common.js';

/**
 * Something the patient measured about themselves.
 *
 * The record already holds what a doctor wrote and what the patient swallowed.
 * This is the third thing — how they actually are — and it is the only part of
 * the record the patient owns outright. A chronic condition has no course to
 * finish and no tablet to count, so without these it has nothing to show for
 * itself at all.
 *
 * Two numbers, not one, because blood pressure is a pair and splitting it into
 * two separate readings would make "138/82" two unrelated lines on a chart.
 * Every other metric leaves `secondValue` null.
 */
export const ReadingMetricSchema = z.enum([
  'blood_pressure',
  'weight',
  'blood_glucose',
  'temperature',
  'pulse',
  'oxygen_saturation',
  'peak_flow',
]);
export type ReadingMetric = z.infer<typeof ReadingMetricSchema>;

export interface ReadingMetricSpec {
  label: string;
  /** What the patient is asked for, e.g. "Top number". */
  valueLabel: string;
  secondValueLabel: string | null;
  unit: string;
  /** Sane bounds for the input, not a clinical judgement. */
  min: number;
  max: number;
  decimals: number;
  /**
   * The band printed on a home monitor's own leaflet, drawn behind the line so
   * a reading has something to sit against. Never used to tell the patient
   * anything is wrong — that is the doctor's sentence to say, not the app's.
   */
  referenceBand: { from: number; to: number } | null;
}

export const READING_METRICS: Record<ReadingMetric, ReadingMetricSpec> = {
  blood_pressure: {
    label: 'Blood pressure',
    valueLabel: 'Top number (systolic)',
    secondValueLabel: 'Bottom number (diastolic)',
    unit: 'mmHg',
    min: 40,
    max: 260,
    decimals: 0,
    referenceBand: { from: 90, to: 120 },
  },
  weight: {
    label: 'Weight',
    valueLabel: 'Weight',
    secondValueLabel: null,
    unit: 'kg',
    min: 20,
    max: 400,
    decimals: 1,
    referenceBand: null,
  },
  blood_glucose: {
    label: 'Blood sugar',
    valueLabel: 'Reading',
    secondValueLabel: null,
    unit: 'mmol/L',
    min: 1,
    max: 40,
    decimals: 1,
    referenceBand: { from: 4, to: 7 },
  },
  temperature: {
    label: 'Temperature',
    valueLabel: 'Temperature',
    secondValueLabel: null,
    unit: '°C',
    min: 30,
    max: 45,
    decimals: 1,
    referenceBand: { from: 36.1, to: 37.2 },
  },
  pulse: {
    label: 'Pulse',
    valueLabel: 'Beats per minute',
    secondValueLabel: null,
    unit: 'bpm',
    min: 20,
    max: 250,
    decimals: 0,
    referenceBand: { from: 60, to: 100 },
  },
  oxygen_saturation: {
    label: 'Oxygen level',
    valueLabel: 'Reading',
    secondValueLabel: null,
    unit: '%',
    min: 50,
    max: 100,
    decimals: 0,
    referenceBand: { from: 95, to: 100 },
  },
  peak_flow: {
    label: 'Peak flow',
    valueLabel: 'Best of three',
    secondValueLabel: null,
    unit: 'L/min',
    min: 50,
    max: 900,
    decimals: 0,
    referenceBand: null,
  },
};

/** Where a reading came from. A nurse's measurement is not the patient's own. */
export const ReadingSourceSchema = z.enum(['patient', 'visit']);
export type ReadingSource = z.infer<typeof ReadingSourceSchema>;

export const ReadingSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  metric: ReadingMetricSchema,
  takenAt: DateSchema,
  value: z.number(),
  /** The second half of a pair. Null for every metric but blood pressure. */
  secondValue: z.number().nullable().default(null),
  source: ReadingSourceSchema.default('patient'),
  /** Set when this was taken at an appointment rather than at home. */
  visitId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
export type Reading = z.infer<typeof ReadingSchema>;

export const CreateReadingSchema = ReadingSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
}).superRefine((value, ctx) => {
  const spec = READING_METRICS[value.metric];
  if (value.value < spec.min || value.value > spec.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `${spec.label} should be between ${spec.min} and ${spec.max} ${spec.unit}`,
    });
  }
  if (spec.secondValueLabel === null && value.secondValue !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['secondValue'],
      message: `${spec.label} is a single number`,
    });
  }
  if (spec.secondValueLabel !== null && value.secondValue === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['secondValue'],
      message: `${spec.label} needs both numbers`,
    });
  }
});
export type CreateReading = z.infer<typeof CreateReadingSchema>;

/** "138/82 mmHg", "71.4 kg" — one reading, written the way a person says it. */
export function describeReading(
  metric: ReadingMetric,
  value: number,
  secondValue: number | null,
): string {
  const spec = READING_METRICS[metric];
  const main = value.toFixed(spec.decimals);
  if (secondValue === null) return `${main} ${spec.unit}`;
  return `${main}/${secondValue.toFixed(spec.decimals)} ${spec.unit}`;
}
