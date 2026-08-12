import { Router } from 'express';
import { z } from 'zod';
import {
  IntakeOptionsResponseSchema,
  IntakeRequestSchema,
  IntakeResponseSchema,
} from '@medication-ai/shared';
import { asyncHandler, parseBody } from '../http/errors.js';
import { intakeOptions, recordIntake } from '../services/intakeService.js';

export const intakeRouter: Router = Router();

/** The existing doctors, conditions and medicines the form can pick from. */
intakeRouter.get(
  '/options',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    res.json(IntakeOptionsResponseSchema.parse(await intakeOptions(patientId)));
  }),
);

/** Record a whole prescription: doctor, visit, condition and medicines. */
intakeRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(IntakeRequestSchema, req.body);
    res.status(201).json(IntakeResponseSchema.parse(await recordIntake(input)));
  }),
);
