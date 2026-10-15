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
import { reanchorToMealtimes } from '../services/doseService.js';
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
    const patientId = pathParam(req, 'patientId');
    const patch = parseBody(UpdatePatientSchema, req.body);
    const { familyContacts, ...rest } = patch;

    // Read the old mealtimes before the write: re-anchoring the doses still to
    // come needs both sides to work out each one's offset from its own anchor.
    const before = await collections.patients.requireById(patientId);

    const patient = await collections.patients.updateById(patientId, {
      ...rest,
      ...(familyContacts
        ? {
            familyContacts: familyContacts.map(
              (contact): FamilyContact => ({ ...contact, id: randomUUID() }),
            ),
          }
        : {}),
    });

    // Mealtimes are not a preference that waits for the next prescription: the
    // running course is scheduled against them, so it moves too.
    const movedDoses = patch.mealtimes
      ? await reanchorToMealtimes(patientId, before.mealtimes, patient.mealtimes)
      : 0;

    res.json({ ...PatientSchema.parse(patient), movedDoses });
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
