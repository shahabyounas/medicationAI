import { Router } from 'express';
import {
  CreatePatientSchema,
  FamilyResponseSchema,
  MedicinesResponseSchema,
  PatientSchema,
  TodayResponseSchema,
  UpdatePatientSchema,
  type FamilyContact,
} from '@medication-ai/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collections } from '../db/collections.js';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import { buildFamily, buildMedicines, buildToday } from '../services/viewService.js';
import { buildVisitsResponse } from '../services/recordService.js';
import { VisitsResponseSchema } from '@medication-ai/shared';

export const patientsRouter: Router = Router();

patientsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const patients = await collections.patients.find({}, { sort: { createdAt: 1 } });
    res.json({ patients: z.array(PatientSchema).parse(patients) });
  }),
);

patientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(CreatePatientSchema, req.body);
    const patient = await collections.patients.insert({
      ...input,
      familyContacts: input.familyContacts.map(
        (contact): FamilyContact => ({ ...contact, id: randomUUID() }),
      ),
    });
    res.status(201).json(PatientSchema.parse(patient));
  }),
);

patientsRouter.get(
  '/:patientId',
  asyncHandler(async (req, res) => {
    const patient = await collections.patients.requireById(pathParam(req, 'patientId'));
    res.json(PatientSchema.parse(patient));
  }),
);

patientsRouter.patch(
  '/:patientId',
  asyncHandler(async (req, res) => {
    const patch = parseBody(UpdatePatientSchema, req.body);
    const { familyContacts, ...rest } = patch;

    const patient = await collections.patients.updateById(pathParam(req, 'patientId'), {
      ...rest,
      ...(familyContacts
        ? {
            familyContacts: familyContacts.map(
              (contact): FamilyContact => ({ ...contact, id: randomUUID() }),
            ),
          }
        : {}),
    });
    res.json(PatientSchema.parse(patient));
  }),
);

patientsRouter.get(
  '/:patientId/today',
  asyncHandler(async (req, res) => {
    const today = await buildToday(pathParam(req, 'patientId'));
    res.json(TodayResponseSchema.parse(today));
  }),
);

patientsRouter.get(
  '/:patientId/medicines',
  asyncHandler(async (req, res) => {
    const medicines = await buildMedicines(pathParam(req, 'patientId'));
    res.json(MedicinesResponseSchema.parse(medicines));
  }),
);

patientsRouter.get(
  '/:patientId/visits',
  asyncHandler(async (req, res) => {
    await collections.patients.requireById(pathParam(req, 'patientId'));
    const visits = await buildVisitsResponse(pathParam(req, 'patientId'));
    res.json(VisitsResponseSchema.parse(visits));
  }),
);

patientsRouter.get(
  '/:patientId/family',
  asyncHandler(async (req, res) => {
    const family = await buildFamily(pathParam(req, 'patientId'));
    res.json(FamilyResponseSchema.parse(family));
  }),
);
