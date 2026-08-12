import { Router } from 'express';
import { z } from 'zod';
import {
  ConditionSchema,
  CreateConditionSchema,
  CreateDoctorSchema,
  CreateVisitSchema,
  DoctorSchema,
  UpdateDoctorSchema,
  UpdateVisitSchema,
  VisitDetailSchema,
  VisitSchema,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import { getVisitDetail, listDoctorsWithHistory, listVisitDetails } from '../services/recordService.js';

/**
 * Doctors, visits and conditions — the medical record.
 */
export const recordsRouter: Router = Router();

// --- Doctors ---------------------------------------------------------------

recordsRouter.get(
  '/doctors',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    res.json({ doctors: await listDoctorsWithHistory(patientId) });
  }),
);

recordsRouter.post(
  '/doctors',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateDoctorSchema, req.body);
    await collections.patients.requireById(input.patientId);
    const doctor = await collections.doctors.insert(input);
    res.status(201).json(DoctorSchema.parse(doctor));
  }),
);

recordsRouter.get(
  '/doctors/:doctorId',
  asyncHandler(async (req, res) => {
    const doctor = await collections.doctors.requireById(pathParam(req, 'doctorId'));
    res.json(DoctorSchema.parse(doctor));
  }),
);

recordsRouter.patch(
  '/doctors/:doctorId',
  asyncHandler(async (req, res) => {
    const patch = parseBody(UpdateDoctorSchema, req.body);
    const doctor = await collections.doctors.updateById(pathParam(req, 'doctorId'), patch);
    res.json(DoctorSchema.parse(doctor));
  }),
);

recordsRouter.delete(
  '/doctors/:doctorId',
  asyncHandler(async (req, res) => {
    const deleted = await collections.doctors.deleteById(pathParam(req, 'doctorId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

// --- Visits ----------------------------------------------------------------

recordsRouter.get(
  '/visits',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    res.json({ visits: z.array(VisitDetailSchema).parse(await listVisitDetails(patientId)) });
  }),
);

recordsRouter.post(
  '/visits',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateVisitSchema, req.body);
    await collections.patients.requireById(input.patientId);
    await collections.doctors.requireById(input.doctorId);
    if (input.conditionId) await collections.conditions.requireById(input.conditionId);

    const visit = await collections.visits.insert(input);
    res.status(201).json(VisitSchema.parse(visit));
  }),
);

recordsRouter.get(
  '/visits/:visitId',
  asyncHandler(async (req, res) => {
    res.json(VisitDetailSchema.parse(await getVisitDetail(pathParam(req, 'visitId'))));
  }),
);

recordsRouter.patch(
  '/visits/:visitId',
  asyncHandler(async (req, res) => {
    const patch = parseBody(UpdateVisitSchema, req.body);
    const visit = await collections.visits.updateById(pathParam(req, 'visitId'), patch);
    res.json(VisitSchema.parse(visit));
  }),
);

recordsRouter.delete(
  '/visits/:visitId',
  asyncHandler(async (req, res) => {
    const deleted = await collections.visits.deleteById(pathParam(req, 'visitId'));
    res.status(deleted ? 204 : 404).end();
  }),
);

// --- Conditions ------------------------------------------------------------

recordsRouter.get(
  '/conditions',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    const conditions = await collections.conditions.find(
      { patientId },
      { sort: { startedAt: -1 } },
    );
    res.json({ conditions: z.array(ConditionSchema).parse(conditions) });
  }),
);

recordsRouter.post(
  '/conditions',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreateConditionSchema, req.body);
    await collections.patients.requireById(input.patientId);
    const condition = await collections.conditions.insert(input);
    res.status(201).json(ConditionSchema.parse(condition));
  }),
);
