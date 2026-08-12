import { Router } from 'express';
import { z } from 'zod';
import {
  PushPayloadSchema,
  PushPublicKeyResponseSchema,
  PushStatusResponseSchema,
  PushSubscribeRequestSchema,
  PushSubscribeResponseSchema,
} from '@medication-ai/shared';
import { asyncHandler, parseBody } from '../http/errors.js';
import { isPushConfigured, publicKey } from '../push/vapid.js';
import { countDevices, removeSubscription, saveSubscription, sendToPatient } from '../services/pushService.js';

export const pushRouter: Router = Router();

/** The VAPID public key the browser needs to subscribe. */
pushRouter.get('/public-key', (_req, res) => {
  res.json(
    PushPublicKeyResponseSchema.parse({
      publicKey: publicKey(),
      configured: isPushConfigured(),
    }),
  );
});

pushRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const patientId = z.string().uuid().parse(req.query.patientId);
    res.json(
      PushStatusResponseSchema.parse({
        configured: isPushConfigured(),
        deviceCount: await countDevices(patientId),
      }),
    );
  }),
);

pushRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const input = parseBody(PushSubscribeRequestSchema, req.body);
    await saveSubscription(input);
    res.status(201).json(
      PushSubscribeResponseSchema.parse({
        subscribed: true,
        deviceCount: await countDevices(input.patientId),
      }),
    );
  }),
);

pushRouter.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ endpoint: z.string().min(1) }), req.body);
    const removed = await removeSubscription(body.endpoint);
    res.json({ removed });
  }),
);

/**
 * Send a test notification.
 *
 * Push is the one part of this system that cannot be verified from the server
 * alone — it depends on the browser, the OS, and permissions the user granted
 * on a device you cannot see. A button that proves the whole chain works is
 * worth more than any amount of server-side logging.
 */
pushRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ patientId: z.string().uuid() }), req.body);

    const result = await sendToPatient(
      body.patientId,
      PushPayloadSchema.parse({
        title: 'Your agent is set up',
        body: "This is what a reminder will look like. I'll only send one when a dose is due.",
        tag: 'test-notification',
        doseId: null,
        patientId: body.patientId,
        escalationNodeId: null,
        actionable: false,
        url: '/#today',
        urgent: false,
      }),
    );

    res.json({ configured: isPushConfigured(), ...result });
  }),
);
