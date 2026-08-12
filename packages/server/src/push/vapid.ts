import webpush from 'web-push';
import { env } from '../env.js';

/**
 * VAPID configuration.
 *
 * Web Push needs a keypair identifying this server to the browser vendors' push
 * services. The keys are configuration, not code — generate a pair with
 * `npm run vapid` and put them in `.env`.
 *
 * If they are absent the app still runs: push is reported as unconfigured, the
 * UI says so, and the agent falls back to logging. Reminders silently going
 * nowhere would be a much worse failure than an honest "not set up".
 */

let configured = false;

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
} else {
  console.log(
    '[push] no VAPID keys set — push notifications are disabled. Run `npm run vapid` to create a pair.',
  );
}

export function isPushConfigured(): boolean {
  return configured;
}

export function publicKey(): string | null {
  return configured ? (env.VAPID_PUBLIC_KEY ?? null) : null;
}

export { webpush };
