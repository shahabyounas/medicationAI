import { createApp } from './app.js';
import { env } from './env.js';
import { closeDatabase, connectToDatabase } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { AgentLoop } from './agent/runner.js';

async function main(): Promise<void> {
  await connectToDatabase();
  await ensureIndexes();
  console.log(`[server] connected to ${env.MONGODB_DB}`);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[server] listening on http://127.0.0.1:${env.PORT}`);
  });

  const loop = new AgentLoop(env.AGENT_TICK_MS);
  if (env.AGENT_LOOP_ENABLED) {
    loop.start();
  } else {
    console.log('[agent] loop disabled — drive it with POST /api/agent/tick');
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[server] ${signal} received, shutting down`);
    loop.stop();
    server.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
