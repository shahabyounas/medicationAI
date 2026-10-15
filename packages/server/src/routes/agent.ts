import { Router } from 'express';
import { z } from 'zod';
import { AgentTickResponseSchema, escalationPath } from '@medication-ai/shared';
import { asyncHandler } from '../http/errors.js';
import { env } from '../env.js';
import { tick } from '../agent/runner.js';
import { deliveryChannel } from '../agent/channels.js';
import { collections } from '../db/collections.js';
import { recentEvents } from '../services/agentEventService.js';

export const agentRouter: Router = Router();

/**
 * Run one tick by hand.
 *
 * The loop runs on a timer in normal operation, but a medication schedule plays
 * out over days — being able to drive the agent a step at a time is what makes
 * the escalation ladder testable and demonstrable inside a minute.
 */
agentRouter.post(
  '/tick',
  asyncHandler(async (req, res) => {
    const body = z.object({ now: z.coerce.date().optional() }).parse(req.body ?? {});
    const result = await tick(body.now ?? new Date());
    res.json(AgentTickResponseSchema.parse(result));
  }),
);

/**
 * The scheduled tick.
 *
 * Deployed there is no in-process loop — a serverless function is frozen
 * between requests, so a timer inside one cannot be the thing that chases a
 * dose. Vercel Cron calls this instead, and Cron only ever sends GET, hence a
 * second verb for the same work rather than a second implementation.
 *
 * Guarded by `CRON_SECRET` when one is configured: otherwise this would be an
 * open endpoint that lets anyone advance another patient's escalation ladder.
 * Unset (as locally, where the loop runs in-process) it stays open, because a
 * secret that defaults to absent is clearer than one that defaults to a value.
 */
agentRouter.get(
  '/tick',
  asyncHandler(async (req, res) => {
    if (env.CRON_SECRET && req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
      res.status(401).json({
        error: { code: 'unauthorized', message: 'This endpoint requires the cron secret.' },
      });
      return;
    }
    const result = await tick(new Date());
    res.json(AgentTickResponseSchema.parse(result));
  }),
);

/** The ladder itself, walked from the graph — for the "how it works" screen. */
agentRouter.get('/escalation-path', (_req, res) => {
  res.json({
    path: escalationPath().map((node) => ({
      id: node.id,
      label: node.label,
      description: node.description,
      offsetMinutes: node.offsetMinutes,
      channel: node.channel,
      terminal: node.terminal,
    })),
  });
});

/** What the agent has actually sent, and to whom. */
agentRouter.get('/deliveries', (_req, res) => {
  res.json({ deliveries: deliveryChannel.recent(50) });
});

agentRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        patientId: z.string().uuid(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    res.json({ events: await recentEvents(query.patientId, query.limit) });
  }),
);

/** The agent's live working set — which doses it is currently chasing. */
agentRouter.get(
  '/escalations',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    const states = await collections.escalationStates.find(
      { patientId, settledAt: null },
      { sort: { nextRunAt: 1 } },
    );
    res.json({ escalations: states });
  }),
);
