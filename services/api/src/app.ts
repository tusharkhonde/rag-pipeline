import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Repo } from './db/repo.js';
import type { MlClient } from './ml/client.js';
import type { Answerer } from './generation/answerer.js';
import type { Retriever } from './retrieval/retriever.js';
import { collectionRoutes } from './routes/collections.js';
import { queryRoutes } from './routes/query.js';
import { searchRoutes } from './routes/search.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Internal id (clients.id) of the tenant making the request. Every data access is scoped by it. */
    clientId: string;
  }
}

export interface AppDeps {
  config: Config;
  repo: Repo;
  ml: MlClient;
  retriever: Retriever;
  answerer: Answerer;
  /** Resolves the calling tenant. Stage 1: a fixed dev client. Stage 4: verified from the JWT. */
  resolveClientId: (req: FastifyRequest) => Promise<string>;
}

// Build the app without listening on a port, so tests can drive it with app.inject().
// Dependencies are passed in, so tests can substitute fakes for Postgres and the ml service.
export function buildApp({ config, repo, ml, retriever, answerer, resolveClientId }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  app.decorateRequest('clientId', '');

  // Liveness: "is the process up?" Deliberately checks no dependencies, so a Postgres blip
  // doesn't make the orchestrator restart healthy API containers. Readiness comes in Stage 5.
  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (tenantScoped) => {
    tenantScoped.addHook('onRequest', async (req) => {
      req.clientId = await resolveClientId(req);
    });
    await tenantScoped.register(collectionRoutes, { repo, ml });
    const defaults = { mode: config.RETRIEVAL_MODE, topK: config.RETRIEVAL_TOP_K };
    await tenantScoped.register(searchRoutes, { repo, retriever, defaults });
    await tenantScoped.register(queryRoutes, { repo, answerer, defaults });
  });

  return app;
}
