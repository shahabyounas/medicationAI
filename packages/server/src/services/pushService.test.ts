import { createECDH, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PushPayloadSchema } from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import {
  MAX_PUSH_FAILURES,
  countDevices,
  removeSubscription,
  saveSubscription,
  sendToPatient,
  verdictForFailure,
} from './pushService.js';
import {
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * Push subscriptions.
 *
 * What is actually ours here is the storage and the retention policy — the
 * encryption and HTTP are `web-push`'s job, and the browser's push service
 * cannot be stood up locally (Web Push mandates HTTPS endpoints, and a real
 * subscription can only be minted by a browser talking to its vendor).
 *
 * So the policy is tested as a named rule, exhaustively and without a network,
 * and the storage is tested against a real database. The service-worker end —
 * what the notification looks like and what its buttons do — is verified
 * separately by injecting push events into a real browser.
 */

let scenario: TestScenario;

beforeAll(async () => {
  await connectTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  scenario = await createScenario();
});

/**
 * A subscription shaped the way a browser hands it over, with a genuine P-256
 * keypair — `web-push` encrypts to it, so a made-up point fails in crypto.
 */
function subscriptionFor(patientId: string, path = 'device-1') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();

  return {
    patientId,
    endpoint: `https://push.example.test/${path}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
    userAgent: 'vitest',
  };
}

describe('verdictForFailure', () => {
  it('drops an endpoint the push service says is gone', () => {
    expect(verdictForFailure(410, 1)).toBe('drop');
  });

  it('drops an endpoint the push service does not recognise', () => {
    expect(verdictForFailure(404, 1)).toBe('drop');
  });

  it('keeps an endpoint through a server error at the push service', () => {
    expect(verdictForFailure(500, 1)).toBe('keep');
    expect(verdictForFailure(503, 3)).toBe('keep');
  });

  it('keeps an endpoint when the request never got a status at all', () => {
    // A dropped connection is not evidence the subscription is dead.
    expect(verdictForFailure(undefined, 1)).toBe('keep');
  });

  it('keeps an endpoint that is rate limited', () => {
    expect(verdictForFailure(429, 2)).toBe('keep');
  });

  it('gives up once an endpoint has failed enough times', () => {
    expect(verdictForFailure(500, MAX_PUSH_FAILURES - 1)).toBe('keep');
    expect(verdictForFailure(500, MAX_PUSH_FAILURES)).toBe('drop');
    expect(verdictForFailure(undefined, MAX_PUSH_FAILURES + 5)).toBe('drop');
  });

  it('drops on a definitive rejection even on the first failure', () => {
    expect(verdictForFailure(410, 0)).toBe('drop');
  });
});

describe('storing subscriptions', () => {
  it('registers a device', async () => {
    await saveSubscription(subscriptionFor(scenario.patient._id));
    expect(await countDevices(scenario.patient._id)).toBe(1);
  });

  it('updates rather than duplicating when the same browser re-subscribes', async () => {
    await saveSubscription(subscriptionFor(scenario.patient._id));
    await saveSubscription(subscriptionFor(scenario.patient._id));

    expect(await countDevices(scenario.patient._id)).toBe(1);
  });

  it('rotates the keys when a browser re-subscribes', async () => {
    const first = subscriptionFor(scenario.patient._id);
    await saveSubscription(first);

    const second = { ...subscriptionFor(scenario.patient._id), endpoint: first.endpoint };
    await saveSubscription(second);

    const stored = await collections.pushSubscriptions.findOne({ endpoint: first.endpoint });
    expect(stored?.keys.p256dh).toBe(second.keys.p256dh);
    expect(stored?.keys.p256dh).not.toBe(first.keys.p256dh);
  });

  it('keeps a second device separate', async () => {
    await saveSubscription(subscriptionFor(scenario.patient._id, 'device-1'));
    await saveSubscription(subscriptionFor(scenario.patient._id, 'device-2'));

    expect(await countDevices(scenario.patient._id)).toBe(2);
  });

  it('clears the failure count when a browser re-subscribes', async () => {
    const saved = await saveSubscription(subscriptionFor(scenario.patient._id));
    await collections.pushSubscriptions.updateById(saved._id, { failureCount: 4 });

    await saveSubscription({ ...subscriptionFor(scenario.patient._id), endpoint: saved.endpoint });

    const after = await collections.pushSubscriptions.findOne({ endpoint: saved.endpoint });
    expect(after?.failureCount).toBe(0);
  });

  it('removes a subscription by endpoint', async () => {
    const saved = await saveSubscription(subscriptionFor(scenario.patient._id));

    expect(await removeSubscription(saved.endpoint)).toBe(true);
    expect(await countDevices(scenario.patient._id)).toBe(0);
  });

  it('reports nothing removed for an endpoint it does not hold', async () => {
    expect(await removeSubscription('https://push.example.test/never-seen')).toBe(false);
  });

  it('refuses to register against a patient that does not exist', async () => {
    await expect(
      saveSubscription(subscriptionFor('11111111-1111-4111-8111-111111111111')),
    ).rejects.toThrow();
  });

  it('counts devices per patient, not globally', async () => {
    const other = await collections.patients.insert({
      name: 'Someone Else',
      phone: '+447700900999',
      timezone: 'Europe/London',
      mealtimes: scenario.patient.mealtimes,
      allergies: [],
      familyContacts: [],
    });

    await saveSubscription(subscriptionFor(scenario.patient._id, 'a'));
    await saveSubscription(subscriptionFor(other._id, 'b'));

    expect(await countDevices(scenario.patient._id)).toBe(1);
    expect(await countDevices(other._id)).toBe(1);
  });
});

describe('sending', () => {
  it('does nothing, harmlessly, when no device is registered', async () => {
    const result = await sendToPatient(
      scenario.patient._id,
      PushPayloadSchema.parse({
        title: 'Time for your medicine',
        body: 'Take 1 capsule of Amoxicillin.',
        tag: 'dose-1',
        doseId: null,
        patientId: scenario.patient._id,
        escalationNodeId: 'reminder_1',
        actionable: true,
        url: '/#today',
        urgent: true,
      }),
    );

    expect(result).toEqual({ attempted: 0, delivered: 0, removed: 0 });
  });
});
