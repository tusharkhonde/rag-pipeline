import type { FastifyPluginAsync } from 'fastify';
import type { Repo } from '../db/repo.js';
import { EmbeddingModelMismatchError, type Retriever } from '../retrieval/retriever.js';
import type { RetrievalMode } from '../retrieval/types.js';

interface Deps {
  repo: Repo;
  retriever: Retriever;
  defaults: { mode: RetrievalMode; topK: number };
}

export const searchBodySchema = {
  query: { type: 'string', minLength: 1, maxLength: 1000 },
  topK: { type: 'integer', minimum: 1, maximum: 20 },
  mode: { type: 'string', enum: ['hybrid', 'vector', 'keyword'] },
} as const;

/** Retrieval only, no generation: for debugging relevance and for the offline eval harness. */
export const searchRoutes: FastifyPluginAsync<Deps> = async (app, { repo, retriever, defaults }) => {
  app.post<{ Params: { collectionId: string }; Body: { query: string; topK?: number; mode?: RetrievalMode } }>(
    '/collections/:collectionId/search',
    {
      schema: {
        params: {
          type: 'object',
          required: ['collectionId'],
          properties: { collectionId: { type: 'string', format: 'uuid' } },
        },
        body: { type: 'object', required: ['query'], additionalProperties: false, properties: searchBodySchema },
      },
    },
    async (req, reply) => {
      const collection = await repo.getCollection(req.clientId, req.params.collectionId);
      if (!collection) return reply.code(404).send({ error: 'Collection not found' });
      try {
        return await retriever.retrieve({
          collectionId: collection.id,
          query: req.body.query,
          mode: req.body.mode ?? defaults.mode,
          topK: req.body.topK ?? defaults.topK,
        });
      } catch (err) {
        if (err instanceof EmbeddingModelMismatchError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );
};
