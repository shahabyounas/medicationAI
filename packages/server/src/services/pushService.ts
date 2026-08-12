import {
  type CreatePushSubscription,
  type PushPayload,
  type PushSubscription,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { isPushConfigured, webpush } from '../push/vapid.js';

/**
 * Storing and using browser push subscriptions.
 *
 * The one rule that matters here is pruning. A push endpoint outlives the
 * browser that made it — people clear site data, reinstall, change phones — and
 * a dead endpoint answers 404 or 410 forever. Deleting on those two statuses is
 * what stops the agent quietly "reminding" a subscription nobody will ever see
 * and believing it has done its job.
 */

export interface PushResult {
  attempted: number;
  delivered: number;
  removed: number;
}

/** Consecutive failures after which an endpoint is abandoned. */
export const MAX_PUSH_FAILURES = 10;

export type PushFailureVerdict = 'drop' | 'keep';

/**
 * What to do with a subscription after a delivery fails.
 *
 * Named and separated from the sending loop because it is the rule that decides
 * whether the agent is talking to anybody. 404 and 410 are the push service
 * saying the endpoint is gone for good — keeping it means the agent believes it
 * has reminded someone every time it has reminded nobody. Anything else might
 * be a bad afternoon for the push service, so the endpoint survives until it
 * has failed enough times to be clearly dead.
 */
export function verdictForFailure(
  statusCode: number | undefined,
  failureCountAfter: number,
): PushFailureVerdict {
  if (statusCode === 404 || statusCode === 410) return 'drop';
  return failureCountAfter >= MAX_PUSH_FAILURES ? 'drop' : 'keep';
}

/** Store, or refresh, one browser's subscription. */
export async function saveSubscription(input: CreatePushSubscription): Promise<PushSubscription> {
  await collections.patients.requireById(input.patientId);

  const existing = await collections.pushSubscriptions.findOne({ endpoint: input.endpoint });

  if (existing) {
    // Re-subscribing rotates the keys; the endpoint is the stable identity.
    return collections.pushSubscriptions.updateById(existing._id, {
      patientId: input.patientId,
      keys: input.keys,
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      failureCount: 0,
    });
  }

  return collections.pushSubscriptions.insert({
    patientId: input.patientId,
    endpoint: input.endpoint,
    keys: input.keys,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    lastSuccessAt: null,
    failureCount: 0,
  });
}

export async function removeSubscription(endpoint: string): Promise<boolean> {
  const existing = await collections.pushSubscriptions.findOne({ endpoint });
  if (!existing) return false;
  return collections.pushSubscriptions.deleteById(existing._id);
}

export async function countDevices(patientId: string): Promise<number> {
  return collections.pushSubscriptions.count({ patientId });
}

/**
 * Send one payload to every device a patient has registered.
 *
 * Failures are per-device: one dead phone must not stop the reminder reaching
 * the one in her pocket.
 */
export async function sendToPatient(
  patientId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!isPushConfigured()) return { attempted: 0, delivered: 0, removed: 0 };

  const subscriptions = await collections.pushSubscriptions.find({ patientId });
  if (subscriptions.length === 0) return { attempted: 0, delivered: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let delivered = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          body,
          {
            // Hold the message if the device is offline, but not past the point
            // where the dose it is about stops being relevant.
            TTL: 3 * 60 * 60,
            urgency: payload.urgent ? 'high' : 'normal',
          },
        );
        delivered += 1;
        await collections.pushSubscriptions.updateById(subscription._id, {
          lastSuccessAt: new Date(),
          failureCount: 0,
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        const failureCount = subscription.failureCount + 1;

        if (verdictForFailure(status, failureCount) === 'drop') {
          await collections.pushSubscriptions.deleteById(subscription._id);
          removed += 1;
        } else {
          await collections.pushSubscriptions.updateById(subscription._id, { failureCount });
        }

        console.warn(
          `[push] delivery failed (${status ?? 'no status'}) for ${subscription.endpoint.slice(0, 48)}…`,
        );
      }
    }),
  );

  return { attempted: subscriptions.length, delivered, removed };
}
