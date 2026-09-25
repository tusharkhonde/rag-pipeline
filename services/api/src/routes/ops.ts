import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Metrics } from '../observability/metrics.js';
import { checkReadiness, type ReadinessCheck } from '../observability/readiness.js';

interface Deps {
  metrics: Metrics;
  readinessChecks: Record<string, ReadinessCheck>;
  metricsToken?: string;
}

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const opsRoutes: FastifyPluginAsync<Deps> = async (app, { metrics, readinessChecks, metricsToken }) => {
  // Liveness: "is the process up?" Deliberately checks no dependencies, so a Postgres blip
  // doesn't make the orchestrator restart every healthy API container at once.
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
    const result = await checkReadiness(readinessChecks);
    return reply.code(result.ready ? 200 : 503).send({ status: result.ready ? 'ready' : 'not_ready', ...result });
  });

  // Prometheus scrape endpoint. Contains no tenant data, but in production it belongs on an
  // internal network; METRICS_TOKEN optionally requires a bearer token as well.
  app.get('/metrics', async (req, reply) => {
    if (metricsToken && !safeEqual(req.headers.authorization ?? '', `Bearer ${metricsToken}`)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return reply.header('content-type', metrics.registry.contentType).send(await metrics.registry.metrics());
  });
};
