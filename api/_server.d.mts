/**
 * Types for the generated `_server.mjs` bundle.
 *
 * The bundle itself is a build artefact and not in the repo, so without this
 * declaration `api/index.ts` would not typecheck from a clean checkout.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

declare const handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export default handler;
