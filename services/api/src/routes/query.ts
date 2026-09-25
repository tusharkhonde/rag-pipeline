import type { FastifyPluginAsync } from 'fastify';
import type { Repo } from '../db/repo.js';
import type { Answerer } from '../generation/answerer.js';
import { EmbeddingModelMismatchError } from '../retrieval/retriever.js';
import type { RetrievalMode } from '../retrieval/types.js';
import { searchBodySchema } from './search.js';

interface Deps {
  repo: Repo;
  answerer: Answerer;
  defaults: { mode: RetrievalMode; topK: number };
}

interface QueryBody {
  question: string;
  topK?: number;
  mode?: RetrievalMode;
  stream?: boolean;
}

export const queryRoutes: FastifyPluginAsync<Deps> = async (app, { repo, answerer, defaults }) => {
  app.post<{ Params: { collectionId: string }; Body: QueryBody }>(
    '/collections/:collectionId/query',
    {
      schema: {
        params: {
          type: 'object',
          required: ['collectionId'],
          properties: { collectionId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['question'],
          additionalProperties: false,
          properties: {
            question: searchBodySchema.query,
            topK: searchBodySchema.topK,
            mode: searchBodySchema.mode,
            stream: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const collection = await repo.getCollection(req.clientId, req.params.collectionId);
      if (!collection) return reply.code(404).send({ error: 'Collection not found' });

      const request = {
        clientId: req.clientId,
        collection,
        question: req.body.question,
        mode: req.body.mode ?? defaults.mode,
        topK: req.body.topK ?? defaults.topK,
      };

      if (!req.body.stream) {
        try {
          return await answerer.answer(request);
        } catch (err) {
          if (err instanceof EmbeddingModelMismatchError) return reply.code(409).send({ error: err.message });
          throw err;
        }
      }

      // Server-Sent Events: one-way server→client stream over plain HTTP. Simpler than WebSockets
      // (no upgrade, works through proxies, auto-reconnect in browsers' EventSource) and a natural
      // fit for token streaming. We write to the raw response, so Fastify stops managing it.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no', // stop nginx-style proxies from buffering the stream
        'x-request-id': req.id,
      });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      // If the client disconnects, abort the LLM call instead of generating tokens nobody reads.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });

      try {
        for await (const event of answerer.stream(request, abort.signal)) {
          if (event.type === 'delta') send('delta', { text: event.text });
          else if (event.type === 'sources') send('sources', { sources: event.sources });
          else send('done', event.result);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          req.log.error({ err }, 'streaming answer failed');
          const message = err instanceof EmbeddingModelMismatchError ? err.message : 'Answer generation failed';
          send('error', { error: message });
        }
      } finally {
        res.end();
      }
    },
  );
};
