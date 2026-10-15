/**
 * The Vercel function that serves the API.
 *
 * Everything under `/api/*` is rewritten here by `vercel.json`, so this one
 * function is the whole server: Express still does the routing, exactly as it
 * does locally. Keeping it a single function rather than a file per route means
 * there is one cold start and one Mongo connection pool to reason about, not
 * one per endpoint.
 */
export { default } from '@medication-ai/server/serverless';
