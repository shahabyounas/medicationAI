import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString, TimestampsSchema } from './common.js';

/**
 * A browser's push endpoint.
 *
 * This is what makes the agent able to reach someone whose phone is in her
 * pocket and whose app is closed — which is the only state that matters, since
 * a reminder that requires the app to be open is not a reminder.
 *
 * The shape is dictated by the Web Push spec: an endpoint URL owned by the
 * browser vendor's push service, plus two keys the server encrypts the payload
 * with. Nothing here is secret to us — it is a capability to message one
 * specific browser install, and it is revoked by the browser, not by us.
 */
export const PushKeysSchema = z.object({
  /** The client's public key, base64url. */
  p256dh: NonEmptyString.max(255),
  /** The client's auth secret, base64url. */
  auth: NonEmptyString.max(255),
});
export type PushKeys = z.infer<typeof PushKeysSchema>;

export const PushSubscriptionSchema = TimestampsSchema.extend({
  _id: IdSchema,
  patientId: IdSchema,
  /** Unique per browser install; the natural key for this collection. */
  endpoint: NonEmptyString.max(2000),
  keys: PushKeysSchema,
  /** Kept only to tell one device from another in the UI. */
  userAgent: z.string().trim().max(400).optional(),
  /** Set when the push service last accepted a message. */
  lastSuccessAt: DateSchema.nullable().default(null),
  /**
   * Consecutive delivery failures. A subscription is dropped on a definitive
   * rejection (404/410), but transient failures are counted so a permanently
   * broken endpoint does not get retried forever.
   */
  failureCount: z.number().int().min(0).default(0),
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

/** What the browser hands us from `pushManager.subscribe()`. */
export const CreatePushSubscriptionSchema = z.object({
  patientId: IdSchema,
  endpoint: NonEmptyString.max(2000),
  keys: PushKeysSchema,
  userAgent: z.string().trim().max(400).optional(),
});
export type CreatePushSubscription = z.infer<typeof CreatePushSubscriptionSchema>;

/**
 * The payload delivered to the service worker.
 *
 * `doseId` is what makes the notification actionable: the worker can confirm
 * the dose straight from the notification, without the app ever being opened.
 */
export const PushPayloadSchema = z.object({
  title: NonEmptyString.max(120),
  body: NonEmptyString.max(400),
  /** Collapses repeat reminders for the same dose into one notification. */
  tag: NonEmptyString.max(120),
  doseId: IdSchema.nullable().default(null),
  patientId: IdSchema,
  /** Which rung of the escalation ladder produced this. */
  escalationNodeId: z.string().max(60).nullable().default(null),
  /** Show "I took it" / "Not yet" buttons. */
  actionable: z.boolean().default(false),
  /** Where to go when the notification body is tapped. */
  url: NonEmptyString.max(200).default('/#today'),
  /** Vibrate and make noise — reserved for a dose actually being due. */
  urgent: z.boolean().default(false),
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;
