import { z } from 'zod';

/**
 * Every document uses a string UUID as its `_id`. Keeping ids as plain strings
 * (rather than ObjectId) means one Zod schema describes a document equally well
 * in Mongo, over HTTP, and in the browser — no serialisation layer in between.
 */
export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

/**
 * Dates are coerced, so the same schema parses a `Date` coming out of Mongo and
 * an ISO string coming off the wire.
 */
export const DateSchema = z.coerce.date();

/** "HH:mm" on a 24-hour clock. */
export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a "HH:mm" time of day');
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

export const PhoneSchema = z
  .string()
  .trim()
  .min(6, 'phone number is too short')
  .max(20, 'phone number is too long')
  .regex(/^\+?[\d\s-]+$/, 'phone number may only contain digits, spaces, - and a leading +');

export const NonEmptyString = z.string().trim().min(1);

/** Fields every stored document carries. */
export const TimestampsSchema = z.object({
  createdAt: DateSchema,
  updatedAt: DateSchema,
});

/**
 * The channels the agent can reach someone through. `internal` covers actions
 * that change the plan without contacting anybody (a replan, for instance).
 */
export const ChannelSchema = z.enum(['push', 'sms', 'whatsapp', 'family', 'internal']);
export type Channel = z.infer<typeof ChannelSchema>;

export const FoodRuleSchema = z.enum(['before_food', 'after_food', 'with_food', 'any']);
export type FoodRule = z.infer<typeof FoodRuleSchema>;

/** Which point in the day a dose hangs off. */
export const DoseAnchorSchema = z.enum(['breakfast', 'lunch', 'dinner', 'bedtime', 'waking']);
export type DoseAnchor = z.infer<typeof DoseAnchorSchema>;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
