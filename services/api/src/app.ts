import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
}

// Build the app without listening on a port, so tests can drive it with app.inject().
export function buildApp({ config }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  // Liveness: "is the process up?" Deliberately checks no dependencies, so a Postgres blip
  // doesn't make the orchestrator restart healthy API containers. Readiness comes in Stage 5.
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
