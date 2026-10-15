import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.js';
import { connectToDatabase } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';

/**
 * The app as a serverless function.
 *
 * `index.ts` is the long-lived process: it connects, creates indexes, starts
 * the agent loop and listens. None of that fits a function invocation, so this
 * is the other entry point — same Express app, different lifecycle.
 *
 * Two differences are the whole file:
 *
 *   1. **Setup is lazy and happens once per container.** A function has no boot
 *      phase, so the first request pays for the connection and the index check;
 *      every later request on that warm container pays nothing. Caching the
 *      promise (not the result) means concurrent first requests share one
 *      bootstrap rather than racing.
 *   2. **There is no agent loop.** A `setInterval` in a function that may be
 *      frozen between requests would fire unpredictably or not at all. The tick
 *      is driven by Vercel Cron instead — see `GET /api/agent/tick`.
 */

let bootstrap: Promise<Express> | null = null;

async function start(): Promise<Express> {
  await connectToDatabase();
  // `createIndex` on an existing index is a no-op, so this is safe to repeat
  // once per cold start rather than needing somewhere to record that it ran.
  await ensureIndexes();
  return createApp();
}

/** The configured app, booted on first use. */
export function getApp(): Promise<Express> {
  bootstrap ??= start().catch((error: unknown) => {
    // Let the next invocation try again instead of serving a cached failure for
    // the life of the container — a transient Atlas blip should not be sticky.
    bootstrap = null;
    throw error;
  });
  return bootstrap;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    app(req as never, res as never);
  } catch (error: unknown) {
    // Reaching here means the app never came up, so the error middleware does
    // not exist yet. Answer in the same shape the API uses everywhere else.
    console.error('[serverless] bootstrap failed:', error);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'unavailable',
          message: 'The server could not reach its database. Try again in a moment.',
        },
      }),
    );
  }
}
