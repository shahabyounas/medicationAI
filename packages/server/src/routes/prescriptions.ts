import { Router } from 'express';
import { z } from 'zod';
import {
  CourseReportSchema,
  CreatePrescriptionSchema,
  MedicationSchema,
  PrescriptionDetailSchema,
  PrescriptionSchema,
  StartPrescriptionRequestSchema,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import {
  buildPrescriptionDetail,
  confirmPrescription,
  createPrescription,
  startPrescription,
} from '../services/prescriptionService.js';
import { buildCourseReport } from '../services/viewService.js';

export const prescriptionsRouter: Router = Router();

prescriptionsRouter.get(
  '/medications',
  asyncHandler(async (_req, res) => {
    const medications = await collections.medications.find({}, { sort: { name: 1 } });
    res.json({ medications: z.array(MedicationSchema).parse(medications) });
  }),
);

prescriptionsRouter.get(
  '/prescriptions',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    const prescriptions = await collections.prescriptions.find(
      { patientId },
      { sort: { issuedAt: -1 } },
    );
    res.json({ prescriptions: z.array(PrescriptionSchema).parse(prescriptions) });
  }),
);

prescriptionsRouter.post(
  '/prescriptions',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreatePrescriptionSchema, req.body);
    const prescription = await createPrescription({
      patientId: input.patientId,
      doctorId: input.doctorId,
      visitId: input.visitId,
      conditionId: input.conditionId,
      issuedAt: input.issuedAt,
      source: input.source,
      items: input.items,
      ...(input.notes ? { notes: input.notes } : {}),
    });
    res.status(201).json(PrescriptionSchema.parse(prescription));
  }),
);

/** The read-back screen: the prescription restated in plain words. */
prescriptionsRouter.get(
  '/prescriptions/:prescriptionId',
  asyncHandler(async (req, res) => {
    const prescription = await collections.prescriptions.requireById(pathParam(req, 'prescriptionId'));
    const patient = await collections.patients.requireById(prescription.patientId);
    const detail = await buildPrescriptionDetail(prescription, patient);
    res.json(PrescriptionDetailSchema.parse(detail));
  }),
);

prescriptionsRouter.post(
  '/prescriptions/:prescriptionId/confirm',
  asyncHandler(async (req, res) => {
    const prescription = await confirmPrescription(pathParam(req, 'prescriptionId'));
    res.json(PrescriptionSchema.parse(prescription));
  }),
);

/** "Yes, I have the medicine" — plans every dose and starts the agent. */
prescriptionsRouter.post(
  '/prescriptions/:prescriptionId/start',
  asyncHandler(async (req, res) => {
    const body = parseBody(StartPrescriptionRequestSchema, req.body ?? {});
    const result = await startPrescription(pathParam(req, 'prescriptionId'), body.startAt ?? new Date());

    res.json({
      prescription: PrescriptionSchema.parse(result.prescription),
      coursesCreated: result.courses.length,
      dosesScheduled: result.doses.length,
      firstDoseAt: result.doses[0]?.scheduledAt ?? null,
      lastDoseAt: result.doses.at(-1)?.scheduledAt ?? null,
    });
  }),
);

prescriptionsRouter.get(
  '/conditions/:conditionId/report',
  asyncHandler(async (req, res) => {
    const report = await buildCourseReport(pathParam(req, 'conditionId'));
    res.json(CourseReportSchema.parse(report));
  }),
);
