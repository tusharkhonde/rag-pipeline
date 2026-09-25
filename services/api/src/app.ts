import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ClientStore } from './auth/clients.js';
import { authenticate, requireScope } from './auth/plugin.js';
import type { TokenService } from './auth/tokens.js';
import type { Config } from './config.js';
import type { Repo } from './db/repo.js';
import type { Answerer } from './generation/answerer.js';
import type { MlClient } from './ml/client.js';
import type { Retriever } from './retrieval/retriever.js';
import { collectionRoutes } from './routes/collections.js';
import { oauthRoutes } from './routes/oauth.js';
import { queryRoutes } from './routes/query.js';
import { searchRoutes } from './routes/search.js';

export interface AppDeps {
  config: Config;
  repo: Repo;
  ml: MlClient;
  retriever: Retriever;
  answerer: Answerer;
  clients: ClientStore;
  tokens: TokenService;
}

// Build the app without listening on a port, so tests can drive it with app.inject().
// Dependencies are passed in, so tests can substitute fakes for Postgres, ml and the LLM.
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, repo, ml, retriever, answerer, clients, tokens } = deps;
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.register(formbody); // OAuth token requests are application/x-www-form-urlencoded
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  app.register(rateLimit, { global: false });
  app.decorateRequest('clientId', '');
  app.decorateRequest('scopes', null as never);

  // Liveness: "is the process up?" Deliberately checks no dependencies, so a Postgres blip
  // doesn't make the orchestrator restart healthy API containers. Readiness comes in Stage 5.
  app.get('/health', async () => ({ status: 'ok' }));

  // Public: token issuance and the JWKS.
  app.register(oauthRoutes, { clients, tokens });

  // Everything else requires a valid access token and is scoped to its tenant.
  app.register(async (protectedApp) => {
    protectedApp.addHook('onRequest', authenticate(tokens.verify));
    protectedApp.addHook('preHandler', requireScope);
    const defaults = { mode: config.RETRIEVAL_MODE, topK: config.RETRIEVAL_TOP_K };
    await protectedApp.register(collectionRoutes, { repo, ml });
    await protectedApp.register(searchRoutes, { repo, retriever, defaults });
    await protectedApp.register(queryRoutes, { repo, answerer, defaults });
  });

  return app;
}
