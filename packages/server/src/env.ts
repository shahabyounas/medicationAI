import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Load `.env` from the repo root.
 *
 * The server runs from `packages/server` but the file lives at the top of the
 * workspace, so the path is found by walking up. Uses Node's built-in loader —
 * no dotenv dependency for something the runtime already does.
 *
 * Real environment variables always win: a value exported in the shell, or set
 * by a deployment platform, must not be silently overridden by a stale local
 * file.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return;

  let directory = resolve(process.cwd());
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch (error) {
        console.warn(`[env] could not read ${candidate}:`, error);
      }
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

loadDotEnv();

/**
 * Environment, validated once at boot.
 *
 * A missing Mongo URI should stop the process with a readable message, not
 * surface as an undefined connection string somewhere inside the driver.
 */
const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27018'),
  MONGODB_DB: z.string().min(1).default('medication_ai'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  AGENT_TICK_MS: z.coerce.number().int().min(1000).max(600_000).default(15_000),
  AGENT_LOOP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Web Push credentials. Optional: without them the server reports push as
   * unconfigured rather than failing to start, so the app is still usable.
   */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default('mailto:agent@medication.local'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
