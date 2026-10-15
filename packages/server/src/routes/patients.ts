import { Router } from 'express';
import {
  CreatePatientSchema,
  FamilyResponseSchema,
  HistoryResponseSchema,
  MedicinesResponseSchema,
  PatientSchema,
  TodayResponseSchema,
  UpdatePatientSchema,
  type Allergy,
  type FamilyContact,
} from '@medication-ai/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collections } from '../db/collections.js';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import { buildFamily, buildMedicines, buildToday } from '../services/viewService.js';
import { reanchorToMealtimes } from '../services/doseService.js';
import { buildHistory } from '../services/historyService.js';
import { buildInsights } from '../services/insightsService.js';
import { buildReadings } from '../services/readingService.js';
import { buildAppointments } from '../services/appointmentService.js';
import { buildSideEffects } from '../services/sideEffectService.js';
import { buildResults } from '../services/recordItemsService.js';
import { buildShareSummary } from '../services/shareService.js';
import { buildProfile, updateProfile } from '../services/profileService.js';
import { buildVisitsResponse } from '../services/recordService.js';
import {
  AppointmentsResponseSchema,
  InsightsResponseSchema,
  ProfileResponseSchema,
  ReadingsResponseSchema,
  ResultsResponseSchema,
  ShareSummaryResponseSchema,
  SideEffectsResponseSchema,
  UpdateProfileRequestSchema,
  UpdateProfileResponseSchema,
  VisitsResponseSchema,
} from '@medication-ai/shared';

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
      allergies: input.allergies.map((allergy): Allergy => ({ ...allergy, id: randomUUID() })),
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
    const { familyContacts, allergies, ...rest } = patch;

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
      ...(allergies
        ? { allergies: allergies.map((allergy): Allergy => ({ ...allergy, id: randomUUID() })) }
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
  '/:patientId/history',
  asyncHandler(async (req, res) => {
    const history = await buildHistory(pathParam(req, 'patientId'));
    res.json(HistoryResponseSchema.parse(history));
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

/* ========================================================================== */
/* The outcome side of the record                                             */
/* ========================================================================== */

/** The charts screen: every pattern the app has been holding and not showing. */
patientsRouter.get(
  '/:patientId/insights',
  asyncHandler(async (req, res) => {
    const insights = await buildInsights(pathParam(req, 'patientId'));
    res.json(InsightsResponseSchema.parse(insights));
  }),
);

patientsRouter.get(
  '/:patientId/readings',
  asyncHandler(async (req, res) => {
    const readings = await buildReadings(pathParam(req, 'patientId'));
    res.json(ReadingsResponseSchema.parse(readings));
  }),
);

patientsRouter.get(
  '/:patientId/appointments',
  asyncHandler(async (req, res) => {
    const appointments = await buildAppointments(pathParam(req, 'patientId'));
    res.json(AppointmentsResponseSchema.parse(appointments));
  }),
);

patientsRouter.get(
  '/:patientId/side-effects',
  asyncHandler(async (req, res) => {
    const sideEffects = await buildSideEffects(pathParam(req, 'patientId'));
    res.json(SideEffectsResponseSchema.parse(sideEffects));
  }),
);

patientsRouter.get(
  '/:patientId/results',
  asyncHandler(async (req, res) => {
    const results = await buildResults(pathParam(req, 'patientId'));
    res.json(ResultsResponseSchema.parse(results));
  }),
);

/** One page to hand a clinician. */
patientsRouter.get(
  '/:patientId/share',
  asyncHandler(async (req, res) => {
    const summary = await buildShareSummary(pathParam(req, 'patientId'));
    res.json(ShareSummaryResponseSchema.parse(summary));
  }),
);

patientsRouter.get(
  '/:patientId/profile',
  asyncHandler(async (req, res) => {
    const profile = await buildProfile(pathParam(req, 'patientId'));
    res.json(ProfileResponseSchema.parse(profile));
  }),
);

/**
 * The profile editor.
 *
 * Separate from `PATCH /:patientId` because it carries the two lists that have
 * to be written whole — the allergies and the family contact — and because it
 * is the first thing in the app that can edit either. The ladder's last rung has
 * been unconfigurable from the UI since the beginning: `FamilyResponse` is
 * read-only and no screen could add, change or remove the person who gets rung.
 */
patientsRouter.patch(
  '/:patientId/profile',
  asyncHandler(async (req, res) => {
    const patientId = pathParam(req, 'patientId');
    const input = parseBody(UpdateProfileRequestSchema, req.body);
    const result = await updateProfile(patientId, input);
    res.json(UpdateProfileResponseSchema.parse(result));
  }),
);
