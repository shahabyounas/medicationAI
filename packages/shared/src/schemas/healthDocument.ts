import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * A photograph of the paper.
 *
 * Everything else in the record is typed in, and a four-step form is a lot to
 * ask of the patient this is built for. A picture of the prescription label, the
 * discharge letter or the printed result is the thing they can actually produce
 * in the ten seconds after the appointment — and it is what makes the typed
 * record checkable later, by them or by a clinician who does not trust it.
 *
 * The bytes live in Mongo as base64 rather than in an object store, because
 * there is no object store: adding one would mean a second set of credentials,
 * a second failure mode and a second thing to pay for, in exchange for files
 * that are a photograph of one sheet of A4. The cap below is what keeps that
 * honest — a phone camera's full-resolution JPEG is several times it, so the
 * browser downscales before uploading and the server refuses anything bigger
 * rather than writing a document that cannot be read back.
 */
export const DOCUMENT_MAX_BYTES = 1_500_000;

export const DOCUMENT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export const HealthDocumentKindSchema = z.enum([
  'prescription_photo',
  'letter',
  'test_result',
  'discharge_note',
  'other',
]);
export type HealthDocumentKind = z.infer<typeof HealthDocumentKindSchema>;

export const DOCUMENT_KIND_LABELS: Record<HealthDocumentKind, string> = {
  prescription_photo: 'Prescription',
  letter: 'Letter',
  test_result: 'Test result',
  discharge_note: 'Discharge note',
  other: 'Other',
};

export const HealthDocumentSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  kind: HealthDocumentKindSchema.default('other'),
  title: NonEmptyString.max(160),
  capturedAt: DateSchema,
  visitId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  doctorId: IdSchema.nullable().default(null),
  mimeType: z.string().trim().max(80),
  byteSize: z.number().int().min(1).max(DOCUMENT_MAX_BYTES),
  /** The file itself. Never returned by a list — only by fetching one. */
  dataBase64: NonEmptyString,
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type HealthDocument = z.infer<typeof HealthDocumentSchema>;

export const CreateHealthDocumentSchema = HealthDocumentSchema.omit({
  _id: true,
  createdAt: true,
  updatedAt: true,
}).superRefine((value, ctx) => {
  if (!DOCUMENT_MIME_TYPES.includes(value.mimeType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mimeType'],
      message: `only ${DOCUMENT_MIME_TYPES.join(', ')} can be stored`,
    });
  }
});
export type CreateHealthDocument = z.infer<typeof CreateHealthDocumentSchema>;

/**
 * A document without its bytes.
 *
 * Every list view uses this. Loading a megabyte of base64 to render a row that
 * shows a title and a date would make the record screen slower the more the
 * patient actually used it.
 */
export const HealthDocumentSummarySchema = HealthDocumentSchema.omit({ dataBase64: true });
export type HealthDocumentSummary = z.infer<typeof HealthDocumentSummarySchema>;
