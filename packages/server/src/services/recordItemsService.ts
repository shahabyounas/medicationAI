import { randomUUID } from 'node:crypto';
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  HealthDocumentSummarySchema,
  calendarDaysBetween,
  formatDayMonthSmart,
  type CreateImmunisationRequest,
  type CreateLabResultRequest,
  type DocumentResponse,
  type HealthDocument,
  type Immunisation,
  type ImmunisationView,
  type LabResult,
  type LabResultView,
  type LabTrend,
  type ResultsResponse,
  type UploadDocumentRequest,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';

/**
 * Test results, jabs, and photographs of the paper.
 *
 * The three parts of a health record the app did not hold at all. All three are
 * transcription rather than interpretation, which is the only way they can be
 * here at all: the app writes down what the report said and never decides what
 * it means.
 */

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export async function recordLabResult(input: CreateLabResultRequest): Promise<LabResult> {
  await collections.patients.requireById(input.patientId);
  if (input.doctorId) await collections.doctors.requireById(input.doctorId);
  if (input.conditionId) await collections.conditions.requireById(input.conditionId);

  return collections.labResults.insert({
    patientId: input.patientId,
    panelName: input.panelName,
    takenAt: input.takenAt,
    reportedAt: null,
    doctorId: input.doctorId,
    conditionId: input.conditionId,
    visitId: null,
    notes: input.notes ?? null,
    items: input.items.map((item) => ({
      id: randomUUID(),
      name: item.name,
      value: item.value,
      // Parsed for the trend line only. "Negative", "<0.5" and "trace" stay
      // perfectly good records with no number attached.
      numericValue: parseNumeric(item.value),
      unit: item.unit ?? null,
      referenceRange: item.referenceRange ?? null,
      flag: item.flag,
    })),
  });
}

export async function deleteLabResult(labResultId: string): Promise<boolean> {
  return collections.labResults.deleteById(labResultId);
}

/**
 * A plain number out of a printed value, or null.
 *
 * Deliberately strict. "<0.5" is not 0.5 — it is a result below the assay's
 * floor, and plotting it as 0.5 would draw a line through a number nobody
 * measured.
 */
function parseNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------- */
/* Immunisations                                                              */
/* -------------------------------------------------------------------------- */

export async function recordImmunisation(
  input: CreateImmunisationRequest,
): Promise<Immunisation> {
  await collections.patients.requireById(input.patientId);

  return collections.immunisations.insert({
    patientId: input.patientId,
    name: input.name,
    givenAt: input.givenAt,
    doseLabel: input.doseLabel ?? null,
    site: input.site ?? null,
    batchNumber: input.batchNumber ?? null,
    administeredBy: input.administeredBy ?? null,
    doctorId: null,
    nextDueAt: input.nextDueAt,
    notes: input.notes ?? null,
  });
}

export async function deleteImmunisation(immunisationId: string): Promise<boolean> {
  return collections.immunisations.deleteById(immunisationId);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export async function uploadDocument(input: UploadDocumentRequest): Promise<HealthDocument> {
  await collections.patients.requireById(input.patientId);

  if (!DOCUMENT_MIME_TYPES.includes(input.mimeType)) {
    throw new BadRequestError('Only photographs and PDFs can be stored');
  }

  // base64 carries 3 bytes in every 4 characters; padding is at most 2.
  const padding = input.dataBase64.endsWith('==') ? 2 : input.dataBase64.endsWith('=') ? 1 : 0;
  const byteSize = Math.floor((input.dataBase64.length * 3) / 4) - padding;

  if (byteSize > DOCUMENT_MAX_BYTES) {
    throw new BadRequestError(
      `That file is ${Math.round(byteSize / 1000)}kB. The limit is ${Math.round(
        DOCUMENT_MAX_BYTES / 1000,
      )}kB — take the photo again at a smaller size.`,
    );
  }
  if (byteSize <= 0) {
    throw new BadRequestError('That file came through empty');
  }

  return collections.documents.insert({
    patientId: input.patientId,
    kind: input.kind,
    title: input.title,
    capturedAt: input.capturedAt,
    visitId: input.visitId,
    conditionId: input.conditionId,
    doctorId: null,
    mimeType: input.mimeType,
    byteSize,
    dataBase64: input.dataBase64,
    notes: input.notes ?? null,
  });
}

/** One document, with its bytes, ready for an <img> or a download. */
export async function getDocument(documentId: string): Promise<DocumentResponse> {
  const document = await collections.documents.requireById(documentId);
  const { dataBase64, ...summary } = document;

  return {
    document: HealthDocumentSummarySchema.parse(summary),
    dataUrl: `data:${document.mimeType};base64,${dataBase64}`,
  };
}

export async function deleteDocument(documentId: string): Promise<boolean> {
  return collections.documents.deleteById(documentId);
}

/**
 * Documents without their bytes.
 *
 * Projected away at the database rather than deleted after loading: a list of
 * twenty photographs would otherwise pull twenty megabytes of base64 across the
 * wire from Mongo to render twenty rows of a title and a date.
 */
export async function listDocumentSummaries(patientId: string) {
  const raw = await collections.documents.collection
    .find({ patientId }, { projection: { dataBase64: 0 }, sort: { capturedAt: -1 } })
    .toArray();
  return raw.map((row) => HealthDocumentSummarySchema.parse(row));
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

export async function buildResults(
  patientId: string,
  now = new Date(),
): Promise<ResultsResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const [labs, immunisations, documents, doctors, conditions] = await Promise.all([
    collections.labResults.find({ patientId }, { sort: { takenAt: -1 } }),
    collections.immunisations.find({ patientId }, { sort: { givenAt: -1 } }),
    listDocumentSummaries(patientId),
    collections.doctors.find({ patientId }),
    collections.conditions.find({ patientId }),
  ]);

  const doctorsById = new Map(doctors.map((d) => [d._id, d]));
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  const labViews: LabResultView[] = labs.map((lab) => ({
    ...lab,
    doctorName: lab.doctorId ? (doctorsById.get(lab.doctorId)?.name ?? null) : null,
    conditionName: lab.conditionId ? (conditionsById.get(lab.conditionId)?.name ?? null) : null,
    dateLabel: formatDayMonthSmart(lab.takenAt, tz, now),
    flaggedCount: lab.items.filter(
      (item) => item.flag === 'low' || item.flag === 'high' || item.flag === 'abnormal',
    ).length,
  }));

  const immunisationViews: ImmunisationView[] = immunisations.map((jab) => ({
    ...jab,
    dateLabel: formatDayMonthSmart(jab.givenAt, tz, now),
    nextDueLabel: jab.nextDueAt ? formatDayMonthSmart(jab.nextDueAt, tz, now) : null,
    overdue: jab.nextDueAt !== null && jab.nextDueAt.getTime() < now.getTime(),
  }));

  return {
    labs: labViews,
    trends: buildLabTrends(labs, tz, now),
    immunisations: immunisationViews,
    documents: documents.map((document) => ({
      ...document,
      dateLabel: formatDayMonthSmart(document.capturedAt, tz, now),
      kindLabel: DOCUMENT_KIND_LABELS[document.kind],
      sizeLabel: `${Math.max(1, Math.round(document.byteSize / 1000))} kB`,
    })),
  };
}

/**
 * One test, measured more than once, as a line.
 *
 * Grouped on the name as typed, lower-cased, because the same test transcribed
 * twice is the whole point — an HbA1c every three months is the single most
 * useful line a diabetic patient can be shown, and it only exists if the two
 * rows join up. One point is not a line, so a test measured once is left out.
 */
function buildLabTrends(labs: readonly LabResult[], timeZone: string, now: Date): LabTrend[] {
  const byName = new Map<
    string,
    { name: string; unit: string | null; referenceRange: string | null; points: LabTrend['points'] }
  >();

  for (const lab of labs) {
    for (const item of lab.items) {
      if (item.numericValue === null) continue;
      const key = item.name.trim().toLowerCase();
      const existing = byName.get(key) ?? {
        name: item.name,
        unit: item.unit,
        referenceRange: item.referenceRange,
        points: [],
      };
      existing.points.push({
        takenAt: lab.takenAt,
        dateLabel: formatDayMonthSmart(lab.takenAt, timeZone, now),
        value: item.numericValue,
        display: item.unit ? `${item.value} ${item.unit}` : item.value,
        flag: item.flag,
      });
      byName.set(key, existing);
    }
  }

  return [...byName.values()]
    .filter((trend) => trend.points.length >= 2)
    .map((trend) => ({
      ...trend,
      points: trend.points.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime()),
    }))
    .sort((a, b) => b.points.length - a.points.length);
}

/** Jabs due or overdue, for the appointments screen and the reminders. */
export async function immunisationsDue(
  patientId: string,
  now = new Date(),
  withinDays = 60,
): Promise<Immunisation[]> {
  const patient = await collections.patients.requireById(patientId);
  const all = await collections.immunisations.find({ patientId });
  return all.filter((jab) => {
    if (!jab.nextDueAt) return false;
    const days = calendarDaysBetween(now, jab.nextDueAt, patient.timezone);
    return days <= withinDays;
  });
}
