/* eslint-env serviceworker */

/**
 * The service worker.
 *
 * Deliberately conservative about what it will serve from cache. This is an app
 * that tells someone whether they have taken a tablet — showing a stale answer
 * to that question is worse than showing an error, because the failure mode is
 * a double dose. So:
 *
 *   - The **app shell** (HTML, JS, CSS, icons) is cached and served
 *     cache-first. It changes only on deploy and is safe to serve offline.
 *   - **API responses** are network-first and never fall back to cache. If the
 *     server cannot be reached the request fails and the UI says so.
 *   - **Mutations** (POST/PATCH/DELETE) are passed straight through. Queueing a
 *     "I took it" to replay later would let the agent think a dose was taken at
 *     a time it wasn't.
 *
 * Bumping CACHE_VERSION discards every previous cache on activate.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `medication-agent-shell-${CACHE_VERSION}`;

/**
 * The built asset list, injected at build time by vite-plugin-pwa.
 *
 * It has to be generated rather than hand-written because the JS and CSS
 * filenames are content-hashed — a hard-coded list would cache the shell HTML
 * without the script it loads, which fails offline as a blank page rather than
 * as an error.
 *
 * Only the file list is used; no Workbox runtime is pulled in, so the caching
 * policy below stays the one thing that decides what is served from cache.
 */
const PRECACHE_ENTRIES = self.__WB_MANIFEST || [];

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  ...PRECACHE_ENTRIES.map((entry) => (typeof entry === 'string' ? entry : entry.url)),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One missing file must not abort the whole install.
      .then((cache) => Promise.allSettled([...new Set(SHELL_URLS)].map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve a cached answer to "has she taken it?".
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: try the network, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await matchCached('/index.html')) ?? Response.error()),
    );
    return;
  }

  // Static assets: cache-first, refreshing the entry in the background.
  event.respondWith(serveAsset(event));
});

/* ========================================================================== */
/* Push notifications                                                         */
/* ========================================================================== */

/**
 * A reminder arriving while the app is closed.
 *
 * This is the whole point of the push work: a reminder that requires the app to
 * already be open is not a reminder. `userVisibleOnly` is a condition of the
 * subscription, so every push must show something — there is no silent path
 * here, by design as much as by policy.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still surface something rather than nothing.
    payload = {};
  }

  const title = payload.title || 'Medication Agent';
  const body = payload.body || 'You have a dose waiting.';

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notification per dose: the second reminder replaces the first rather
    // than stacking up a wall of them on the lock screen.
    tag: payload.tag || 'medication-agent',
    renotify: true,
    requireInteraction: Boolean(payload.urgent),
    vibrate: payload.urgent ? [200, 100, 200] : undefined,
    data: {
      doseId: payload.doseId || null,
      url: payload.url || '/#today',
      escalationNodeId: payload.escalationNodeId || null,
    },
    actions: payload.actionable
      ? [
          { action: 'take', title: 'I took it' },
          { action: 'later', title: 'Not yet' },
        ]
      : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Answering the notification.
 *
 * "I took it" confirms the dose straight from the lock screen — the app is
 * never opened. That is the design's one-tap check-in, and it is the difference
 * between a reminder someone acts on and one they mean to get back to.
 *
 * If the confirmation fails (offline, server down) the notification is put back
 * rather than silently swallowed, because the alternative is a dose the patient
 * believes is recorded and is not.
 */
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const data = notification.data || {};
  notification.close();

  if (action === 'later') {
    // Dismissing is a real answer; the agent's ladder keeps running.
    return;
  }

  if (action === 'take' && data.doseId) {
    event.waitUntil(confirmDose(data.doseId));
    return;
  }

  event.waitUntil(openApp(data.url || '/#today'));
});

async function confirmDose(doseId) {
  try {
    const response = await fetch(`/api/doses/${doseId}/take`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ via: 'app' }),
    });

    if (!response.ok && response.status !== 409) {
      throw new Error(`HTTP ${response.status}`);
    }

    // 409 means it was already recorded — still a success from here.
    const result = response.status === 409 ? null : await response.json().catch(() => null);
    await self.registration.showNotification('Well done', {
      body: result?.message || 'Dose recorded.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `dose-${doseId}`,
      requireInteraction: false,
    });
  } catch {
    await self.registration.showNotification("I couldn't record that", {
      body: 'Open the app and tap "I took it" so the dose is saved properly.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `dose-${doseId}`,
      requireInteraction: true,
      data: { url: '/#today' },
    });
  }
}

/** Focus an open window if there is one, otherwise open a new one. */
async function openApp(url) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clientList) {
    if (client.url.includes(self.location.origin)) {
      await client.focus();
      if ('navigate' in client) await client.navigate(url).catch(() => undefined);
      return;
    }
  }
  await self.clients.openWindow(url);
}

/* ========================================================================== */
/* Caching                                                                    */
/* ========================================================================== */

/**
 * Look a request up in the shell cache.
 *
 * `ignoreVary` matters more than it looks. Responses stored during install were
 * fetched by `cache.add(url)`, whose request headers differ from those the
 * browser sends for a module script. If the server sets `Vary`, the default
 * match compares those headers and misses — which presents as a blank page
 * offline, with the file sitting in the cache the whole time.
 */
async function matchCached(request) {
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(request, { ignoreVary: true });
}

async function serveAsset(event) {
  const { request } = event;
  const cached = await matchCached(request);

  if (cached) {
    // Refresh the entry for next time, without delaying this response.
    event.waitUntil(
      fetch(request)
        .then(async (response) => {
          if (response.ok && response.type === 'basic') {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(request, response);
          }
        })
        .catch(() => {
          // Offline. The cached copy already answered.
        }),
    );
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}
