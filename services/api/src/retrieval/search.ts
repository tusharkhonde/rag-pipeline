import type pg from 'pg';
import type { RetrievedChunk } from './types.js';

export interface SearchStore {
  vectorSearch(collectionId: string, embedding: number[], limit: number): Promise<RetrievedChunk[]>;
  keywordSearch(collectionId: string, query: string, limit: number): Promise<RetrievedChunk[]>;
  /** An embedding model other than `modelId` used by any chunk in the collection, if one exists. */
  foreignEmbeddingModel(collectionId: string, modelId: string): Promise<string | null>;
}

export const toPgVector = (v: number[]) => `[${v.join(',')}]`;

const CHUNK_COLUMNS = `n.id AS "chunkId", n.document_id AS "documentId", d.filename, n.ordinal, n.content, n.metadata`;

export function createSearchStore(pool: pg.Pool, efSearch: number): SearchStore {
  return {
    async vectorSearch(collectionId, embedding, limit) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Per-transaction HNSW tuning (SET LOCAL semantics via set_config(..., true)):
        //  - ef_search: candidate list size during graph search. Higher = better recall, slower.
        //  - iterative_scan (pgvector >= 0.8): the index returns ef_search candidates BEFORE the
        //    WHERE collection_id filter is applied. If this collection is a small slice of the table,
        //    most candidates get filtered out and we'd return fewer than `limit` rows. Iterative scan
        //    keeps walking the graph until enough rows pass the filter. relaxed_order trades strict
        //    ordering for speed, hence the re-sort in the outer query.
        await client.query(
          `SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
          [String(efSearch)],
        );
        const { rows } = await client.query<RetrievedChunk & { distance: number }>(
          `WITH nearest AS MATERIALIZED (
             SELECT id, document_id, ordinal, content, metadata, embedding <=> $1::vector AS distance
               FROM chunks
              WHERE collection_id = $2
              ORDER BY embedding <=> $1::vector   -- <=> is cosine distance; must match vector_cosine_ops
              LIMIT $3
           )
           SELECT ${CHUNK_COLUMNS}, 1 - n.distance AS score
             FROM nearest n JOIN documents d ON d.id = n.document_id
            ORDER BY n.distance`,
          [toPgVector(embedding), collectionId, limit],
        );
        await client.query('COMMIT');
        return rows.map((r) => ({ ...r, score: Number(r.score), vectorScore: Number(r.score) }));
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async keywordSearch(collectionId, query, limit) {
      // plainto_tsquery ANDs every term ('long' & 'data' & 'kept'), so a natural-language question
      // almost never matches. Rewriting & to | gives OR semantics; ts_rank_cd then rewards chunks
      // matching more (and closer together) terms. Stemming + stopwords come from the 'english' config.
      // The rewritten text is cast with ::tsquery, NOT passed to to_tsquery('english', ...): that
      // would stem the already-stemmed lexemes again ('releas' -> 'relea') and silently miss matches.
      const { rows } = await pool.query<RetrievedChunk>(
        `WITH q AS (
           SELECT replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')::tsquery AS query
         )
         SELECT ${CHUNK_COLUMNS}, ts_rank_cd(n.tsv, q.query) AS score
           FROM chunks n JOIN documents d ON d.id = n.document_id, q
          WHERE n.collection_id = $2 AND n.tsv @@ q.query
          ORDER BY score DESC
          LIMIT $3`,
        [query, collectionId, limit],
      );
      return rows.map((r) => ({ ...r, score: Number(r.score), keywordScore: Number(r.score) }));
    },

    async foreignEmbeddingModel(collectionId, modelId) {
      const { rows } = await pool.query<{ embedding_model: string }>(
        `SELECT embedding_model FROM chunks WHERE collection_id = $1 AND embedding_model <> $2 LIMIT 1`,
        [collectionId, modelId],
      );
      return rows[0]?.embedding_model ?? null;
    },
  };
}
