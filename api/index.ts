/**
 * The Vercel function that serves the API.
 *
 * Everything under `/api/*` is rewritten here by `vercel.json`, so this one
 * function is the whole server: Express still does the routing, exactly as it
 * does locally. One function rather than one per route means one cold start and
 * one Mongo connection pool to reason about.
 *
 * The import is a *relative* path to a pre-bundled `.mjs`, and that detail is
 * load-bearing. Vercel's Node builder transpiles this file rather than bundling
 * it, so any import left here has to be resolvable by Node at runtime. The
 * workspace packages publish TypeScript source (no build step — bundlers
 * consume them directly), so importing `@medication-ai/server` by name survives
 * transpilation and then fails in the lambda with ERR_MODULE_NOT_FOUND on a
 * `.ts` file. `npm run build:fn` bundles the server into `api/_server.mjs`
 * first, which is real JavaScript the function can load.
 */
export { default } from './_server.mjs';
