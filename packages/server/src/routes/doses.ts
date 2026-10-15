import { Router } from 'express';
import { z } from 'zod';
import {
  DoseActionResponseSchema,
  DoseSchema,
  SkipDoseRequestSchema,
  SnoozeDoseRequestSchema,
  TakeDoseRequestSchema,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { asyncHandler, parseBody, pathParam } from '../http/errors.js';
import { skipDose, snoozeDose, takeDose } from '../services/doseService.js';

export const dosesRouter: Router = Router();

dosesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        patientId: z.string().uuid(),
        courseId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);

    const doses = await collections.doses.find(
      { patientId: query.patientId, ...(query.courseId ? { courseId: query.courseId } : {}) },
      { sort: { scheduledAt: 1 }, limit: query.limit },
    );
    res.json({ doses: z.array(DoseSchema).parse(doses) });
  }),
);

dosesRouter.post(
  '/:doseId/take',
  asyncHandler(async (req, res) => {
    const body = parseBody(TakeDoseRequestSchema, req.body ?? {});
    const result = await takeDose(pathParam(req, 'doseId'), body.via, body.takenAt ?? new Date());
    res.json(DoseActionResponseSchema.parse(result));
  }),
);

dosesRouter.post(
  '/:doseId/snooze',
  asyncHandler(async (req, res) => {
    const body = parseBody(SnoozeDoseRequestSchema, req.body ?? {});
    const result = await snoozeDose(pathParam(req, 'doseId'), body.minutes);
    res.json(DoseActionResponseSchema.parse(result));
  }),
);

dosesRouter.post(
  '/:doseId/skip',
  asyncHandler(async (req, res) => {
    const body = parseBody(SkipDoseRequestSchema, req.body ?? {});
    const result = await skipDose(pathParam(req, 'doseId'), body.reason);
    res.json(DoseActionResponseSchema.parse(result));
  }),
);
