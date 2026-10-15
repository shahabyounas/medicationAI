import { Router } from 'express';
import {
  AppointmentSchema,
  CreateAppointmentRequestSchema,
  CreateImmunisationRequestSchema,
  CreateLabResultRequestSchema,
  DocumentResponseSchema,
  HealthDocumentSummarySchema,
  ImmunisationSchema,
  LabResultSchema,
  ReadingSchema,
  RecordReadingRequestSchema,
  RecordSymptomRequestSchema,
  RefillRequestSchema,
  RefillResponseSchema,
  ReportSideEffectRequestSchema,
  ReportSideEffectResponseSchema,
  ResolveSideEffectRequestSchema,
  SelfCareIntakeRequestSchema,
  SelfCareIntakeResponseSchema,
  SideEffectReportSchema,
  StopCourseRequestSchema,
  SymptomEntrySchema,
  UpdateAppointmentStatusRequestSchema,
  UploadDocumentRequestSchema,
} from '@medication-ai/shared';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import {
  reportSideEffect,
  resumeChasing,
  updateSideEffect,
} from '../services/sideEffectService.js';
import { deleteReading, recordReading } from '../services/readingService.js';
import { recordSymptom } from '../services/symptomService.js';
import {
  appointmentFromVisit,
  createAppointment,
  deleteAppointment,
  setAppointmentStatus,
} from '../services/appointmentService.js';
import { addSelfCare, stopSelfCare } from '../services/selfCareService.js';
import { recordRefill, stopCourse } from '../services/doseService.js';
import {
  deleteDocument,
  deleteImmunisation,
  deleteLabResult,
  getDocument,
  recordImmunisation,
  recordLabResult,
  uploadDocument,
} from '../services/recordItemsService.js';

/**
 * Everything on the outcome side of the record.
 *
 * One router rather than seven, because these are seven small resources rather
 * than seven subsystems and the alternative is seven files that each mount one
 * POST. The read endpoints live on the patient — `/patients/:id/readings` and
 * the rest — because every one of them is "this patient's X", and that is what
 * `patients.ts` is for.
 */
export const healthRouter: Router = Router();

/* --- Side effects ------------------------------------------------------- */

healthRouter.post(
  '/side-effects',
  asyncHandler(async (req, res) => {
    const input = parseBody(ReportSideEffectRequestSchema, req.body);
    res.status(201).json(ReportSideEffectResponseSchema.parse(await reportSideEffect(input)));
  }),
);

healthRouter.patch(
  '/side-effects/:reportId',
  asyncHandler(async (req, res) => {
    const input = parseBody(ResolveSideEffectRequestSchema, req.body ?? {});
    const report = await updateSideEffect(pathParam(req, 'reportId'), input);
    res.json(SideEffectReportSchema.parse(report));
  }),
);

/** "The doctor said carry on" — put the reminders back on. */
healthRouter.post(
  '/courses/:courseId/resume',
  asyncHandler(async (req, res) => {
    const message = await resumeChasing(pathParam(req, 'courseId'));
    res.json({ message });
  }),
);

/* --- Refills and stopping ----------------------------------------------- */

healthRouter.post(
  '/courses/:courseId/refill',
  asyncHandler(async (req, res) => {
    const courseId = pathParam(req, 'courseId');
    const input = parseBody(RefillRequestSchema, req.body);
    const result = await recordRefill(courseId, input.unitsNow);
    res.json(RefillResponseSchema.parse({ courseId, ...result }));
  }),
);

healthRouter.post(
  '/courses/:courseId/stop',
  asyncHandler(async (req, res) => {
    const input = parseBody(StopCourseRequestSchema, req.body ?? {});
    res.json(await stopCourse(pathParam(req, 'courseId'), input.reason));
  }),
);

/* --- Self-care: the medicines nobody prescribed -------------------------- */

healthRouter.post(
  '/self-care',
  asyncHandler(async (req, res) => {
    const input = parseBody(SelfCareIntakeRequestSchema, req.body);
    res.status(201).json(SelfCareIntakeResponseSchema.parse(await addSelfCare(input)));
  }),
);

healthRouter.post(
  '/self-care/:courseId/stop',
  asyncHandler(async (req, res) => {
    const input = parseBody(StopCourseRequestSchema, req.body ?? {});
    res.json(await stopSelfCare(pathParam(req, 'courseId'), input.reason));
  }),
);

/* --- Readings and symptoms ---------------------------------------------- */

healthRouter.post(
  '/readings',
  asyncHandler(async (req, res) => {
    const input = parseBody(RecordReadingRequestSchema, req.body);
    const { reading, message } = await recordReading(input);
    res.status(201).json({ reading: ReadingSchema.parse(reading), message });
  }),
);

healthRouter.delete(
  '/readings/:readingId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteReading(pathParam(req, 'readingId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

healthRouter.post(
  '/symptoms',
  asyncHandler(async (req, res) => {
    const input = parseBody(RecordSymptomRequestSchema, req.body);
    const { entry, message } = await recordSymptom(input);
    res.status(201).json({ entry: SymptomEntrySchema.parse(entry), message });
  }),
);

/* --- Appointments -------------------------------------------------------- */

healthRouter.post(
  '/appointments',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateAppointmentRequestSchema, req.body);
    res.status(201).json(AppointmentSchema.parse(await createAppointment(input)));
  }),
);

/** Turn a visit's follow-up date into a real appointment, in one tap. */
healthRouter.post(
  '/visits/:visitId/appointment',
  asyncHandler(async (req, res) => {
    const appointment = await appointmentFromVisit(pathParam(req, 'visitId'));
    res.status(201).json(AppointmentSchema.parse(appointment));
  }),
);

healthRouter.patch(
  '/appointments/:appointmentId',
  asyncHandler(async (req, res) => {
    const input = parseBody(UpdateAppointmentStatusRequestSchema, req.body);
    const appointment = await setAppointmentStatus(
      pathParam(req, 'appointmentId'),
      input.status,
    );
    res.json(AppointmentSchema.parse(appointment));
  }),
);

healthRouter.delete(
  '/appointments/:appointmentId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteAppointment(pathParam(req, 'appointmentId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

/* --- Results, jabs and documents ---------------------------------------- */

healthRouter.post(
  '/lab-results',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateLabResultRequestSchema, req.body);
    res.status(201).json(LabResultSchema.parse(await recordLabResult(input)));
  }),
);

healthRouter.delete(
  '/lab-results/:labResultId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteLabResult(pathParam(req, 'labResultId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

healthRouter.post(
  '/immunisations',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateImmunisationRequestSchema, req.body);
    res.status(201).json(ImmunisationSchema.parse(await recordImmunisation(input)));
  }),
);

healthRouter.delete(
  '/immunisations/:immunisationId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteImmunisation(pathParam(req, 'immunisationId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

healthRouter.post(
  '/documents',
  asyncHandler(async (req, res) => {
    const input = parseBody(UploadDocumentRequestSchema, req.body);
    const document = await uploadDocument(input);
    const { dataBase64: _bytes, ...summary } = document;
    res.status(201).json(HealthDocumentSummarySchema.parse(summary));
  }),
);

/** The only endpoint that returns a document's bytes. */
healthRouter.get(
  '/documents/:documentId',
  asyncHandler(async (req, res) => {
    res.json(DocumentResponseSchema.parse(await getDocument(pathParam(req, 'documentId'))));
  }),
);

healthRouter.delete(
  '/documents/:documentId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteDocument(pathParam(req, 'documentId'));
    res.status(deleted ? 204 : 404).end();
  }),
);
