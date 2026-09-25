import type { QueryEmbedder } from './queryEmbedder.js';
import { reciprocalRankFusion } from './rrf.js';
import type { SearchStore } from './search.js';
import type { RetrievalMode, RetrievedChunk } from './types.js';

export class EmbeddingModelMismatchError extends Error {
  constructor(stored: string, current: string) {
    super(
      `Collection was embedded with ${stored} but the service now embeds with ${current}. ` +
        'Vectors from different models are not comparable: re-ingest the documents.',
    );
  }
}

export interface RetrieveRequest {
  clientId: string;
  collectionId: string;
  query: string;
  mode: RetrievalMode;
  topK: number;
}

export interface RetrieveResult {
  mode: RetrievalMode;
  chunks: RetrievedChunk[];
  /** Best cosine similarity among vector candidates (null in keyword mode). Used for hit-rate. */
  topVectorScore: number | null;
  embeddingCached: boolean | null;
  timings: Record<string, number>;
}

export interface Retriever {
  retrieve(req: RetrieveRequest): Promise<RetrieveResult>;
}

export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, ' ');

async function timed<T>(timings: Record<string, number>, name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = Math.round((performance.now() - start) * 10) / 10;
  }
}

export function createRetriever(
  store: SearchStore,
  embedder: QueryEmbedder,
  opts: { candidates: number },
): Retriever {
  // Checked once per model id per collection; a model switch changes the model id, so it re-checks.
  const verified = new Set<string>();

  async function assertSameModel(clientId: string, collectionId: string) {
    const modelId = await embedder.modelId();
    const key = `${collectionId}:${modelId}`;
    if (verified.has(key)) return;
    const foreign = await store.foreignEmbeddingModel(clientId, collectionId, modelId);
    if (foreign) throw new EmbeddingModelMismatchError(foreign, modelId);
    verified.add(key);
  }

  return {
    async retrieve({ clientId, collectionId, query, mode, topK }) {
      const timings: Record<string, number> = {};
      const text = normalizeQuery(query);
      const useVector = mode !== 'keyword';
      const useKeyword = mode !== 'vector';

      let embeddingCached: boolean | null = null;
      const vectorPromise = useVector
        ? (async () => {
            await assertSameModel(clientId, collectionId);
            const embedding = await timed(timings, 'embed', () => embedder.embed(text));
            embeddingCached = embedding.cached;
            return timed(timings, 'vector_search', () =>
              store.vectorSearch(clientId, collectionId, embedding.vector, opts.candidates),
            );
          })()
        : Promise.resolve([]);
      const keywordPromise = useKeyword
        ? timed(timings, 'keyword_search', () => store.keywordSearch(clientId, collectionId, text, opts.candidates))
        : Promise.resolve([]);

      // The two retrievers are independent, so run them concurrently: latency = max, not sum.
      const [vectorHits, keywordHits] = await Promise.all([vectorPromise, keywordPromise]);
      const topVectorScore = vectorHits[0]?.vectorScore ?? null;

      let chunks: RetrievedChunk[];
      if (mode === 'hybrid') {
        chunks = reciprocalRankFusion([vectorHits, keywordHits], (c) => c.chunkId)
          .slice(0, topK)
          .map(({ item, score }) => ({
            ...item,
            score,
            // Carry both raw signals, whichever list(s) the chunk came from.
            vectorScore: vectorHits.find((c) => c.chunkId === item.chunkId)?.vectorScore,
            keywordScore: keywordHits.find((c) => c.chunkId === item.chunkId)?.keywordScore,
          }));
      } else {
        chunks = (mode === 'vector' ? vectorHits : keywordHits).slice(0, topK);
      }

      return { mode, chunks, topVectorScore, embeddingCached, timings };
    },
  };
}
