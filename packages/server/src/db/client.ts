import { MongoClient, type Db } from 'mongodb';
import { env } from '../env.js';

/**
 * The Mongo connection.
 *
 * Shaped by the fact that this runs in two very different places. Locally it is
 * one long-lived process: connect at boot, close on SIGTERM. On Vercel it is a
 * serverless function whose container is reused across requests but can be torn
 * down at any moment, so:
 *
 *   - The connection is cached on `globalThis`, not just in module scope. A warm
 *     container may re-evaluate the module; keeping the handle off the module
 *     means a second evaluation reuses the live socket rather than opening
 *     another one.
 *   - The cached value is the *promise*, not the resolved `Db`. Two requests
 *     landing on a cold container at once would otherwise both see "not
 *     connected" and open a connection each.
 *   - The pool is deliberately small. Atlas caps connections per cluster and
 *     every concurrent lambda holds its own pool, so a large pool per instance
 *     is how a serverless app exhausts a shared cluster.
 *   - Nothing closes the connection on a request path. Leaving the socket open
 *     for the next invocation is the entire performance win of a warm start.
 */

interface ConnectionCache {
  client: MongoClient | null;
  promise: Promise<Db> | null;
  database: Db | null;
}

const globalCache = globalThis as typeof globalThis & {
  __medicationAiMongo?: ConnectionCache;
};

const cache: ConnectionCache = (globalCache.__medicationAiMongo ??= {
  client: null,
  promise: null,
  database: null,
});

/** Serverless-friendly defaults; harmless for the long-lived local process. */
const CLIENT_OPTIONS = {
  // Fail fast on boot rather than hanging: a developer with no Mongo running
  // should see the problem in seconds, not after a 30-second default timeout.
  serverSelectionTimeoutMS: 5_000,
  // See above — one cluster, many concurrent lambdas.
  maxPoolSize: 10,
  minPoolSize: 0,
  // Drop sockets a torn-down container left behind.
  maxIdleTimeMS: 60_000,
} as const;

export async function connectToDatabase(
  uri = env.MONGODB_URI,
  dbName = env.MONGODB_DB,
): Promise<Db> {
  if (cache.database) return cache.database;
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    const client = new MongoClient(uri, CLIENT_OPTIONS);
    await client.connect();
    cache.client = client;
    cache.database = client.db(dbName);
    return cache.database;
  })().catch((error: unknown) => {
    // A failed connect must not poison the cache: the next request should get a
    // fresh attempt, not a rejected promise replayed forever.
    cache.promise = null;
    cache.client = null;
    cache.database = null;
    throw error;
  });

  return cache.promise;
}

export function getDatabase(): Db {
  if (!cache.database) {
    throw new Error('Database not connected. Call connectToDatabase() during startup.');
  }
  return cache.database;
}

export async function closeDatabase(): Promise<void> {
  await cache.client?.close();
  cache.client = null;
  cache.database = null;
  cache.promise = null;
}
