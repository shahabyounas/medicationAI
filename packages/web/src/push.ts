/**
 * Turning on push notifications, from the browser's side.
 *
 * Three things have to line up and any of them can be missing: the browser must
 * support push, the user must grant permission, and the server must have VAPID
 * keys. Each failure gets its own state rather than a generic "couldn't enable
 * notifications", because the fix is different in each case and the person
 * reading it is not a developer.
 */

export type PushState =
  | 'unsupported' // no service worker or Push API (Safari before 16.4, http://)
  | 'no-worker' // supported, but no service worker is registered (dev server)
  | 'unconfigured' // the server has no VAPID keys
  | 'denied' // the user said no; only they can undo it, in browser settings
  | 'off' // available, not yet enabled
  | 'on';

export interface PushStatus {
  state: PushState;
  deviceCount: number;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * The VAPID key arrives base64url; `applicationServerKey` wants raw bytes.
 *
 * Backed by an explicit `ArrayBuffer` rather than `new Uint8Array(length)`, so
 * the result satisfies `BufferSource` — the default could be backed by a
 * `SharedArrayBuffer`, which the DOM types rule out here.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * The active service worker registration, or null.
 *
 * Deliberately `getRegistration()` rather than `ready`: `ready` never settles
 * when nothing is registered, so using it would hang this screen forever on the
 * dev server, where the worker is switched off on purpose.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? null;
}

export async function currentSubscription(): Promise<globalThis.PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Ask for permission and register this browser with the server.
 *
 * Returns the resulting state rather than throwing, because "the user declined"
 * is an ordinary outcome and not an error.
 */
export async function enablePush(
  patientId: string,
  vapidPublicKey: string,
): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await registration();
  if (!reg) return 'no-worker';

  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      // Required by Chrome: every push must show the user something.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) {
    throw new Error('The browser returned a subscription without encryption keys.');
  }

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      patientId,
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 400),
    }),
  });
  if (!response.ok) throw new Error(`The server rejected the subscription (${response.status}).`);

  return 'on';
}

/** Unsubscribe this browser, and tell the server to forget the endpoint. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

/** Work out where this browser currently stands. */
export async function readPushStatus(
  patientId: string,
): Promise<PushStatus & { publicKey: string | null }> {
  const fallback = { deviceCount: 0, publicKey: null };

  if (!pushSupported()) return { state: 'unsupported', ...fallback };

  const keyResponse = await fetch('/api/push/public-key').catch(() => null);
  const key = keyResponse?.ok
    ? ((await keyResponse.json()) as { publicKey: string | null; configured: boolean })
    : null;

  if (!key?.configured || !key.publicKey) return { state: 'unconfigured', ...fallback };

  const reg = await registration();
  if (!reg) return { state: 'no-worker', deviceCount: 0, publicKey: key.publicKey };

  if (Notification.permission === 'denied') {
    return { state: 'denied', deviceCount: 0, publicKey: key.publicKey };
  }

  const statusResponse = await fetch(
    `/api/push/status?patientId=${encodeURIComponent(patientId)}`,
  ).catch(() => null);
  const status = statusResponse?.ok
    ? ((await statusResponse.json()) as { deviceCount: number })
    : { deviceCount: 0 };

  const subscription = await currentSubscription();
  // Both must be true: this browser holds a subscription *and* the server knows
  // about it. Either one alone means reminders will not arrive.
  const on = Boolean(subscription) && status.deviceCount > 0;

  return {
    state: on ? 'on' : 'off',
    deviceCount: status.deviceCount,
    publicKey: key.publicKey,
  };
}

export async function sendTestNotification(patientId: string): Promise<number> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patientId }),
  });
  if (!response.ok) throw new Error('Could not send the test notification.');
  const result = (await response.json()) as { delivered: number };
  return result.delivered;
}
