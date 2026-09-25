import { describe, expect, it, vi } from 'vitest';
import { memoryCache } from '../../src/cache/cache.js';
import type { MlClient } from '../../src/ml/client.js';
import { createQueryEmbedder, type QueryEmbedder } from '../../src/retrieval/queryEmbedder.js';
import { createRetriever, EmbeddingModelMismatchError } from '../../src/retrieval/retriever.js';
import type { SearchStore } from '../../src/retrieval/search.js';
import type { RetrievedChunk } from '../../src/retrieval/types.js';

const chunk = (id: string, extra: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: id, documentId: 'd', filename: 'f.md', ordinal: 0, content: id, metadata: {}, score: 0, ...extra,
});

function fakeStore(overrides: Partial<SearchStore> = {}): SearchStore {
  return {
    vectorSearch: vi.fn(async () => [chunk('v1', { vectorScore: 0.8 }), chunk('both', { vectorScore: 0.7 })]),
    keywordSearch: vi.fn(async () => [chunk('k1', { keywordScore: 0.5 }), chunk('both', { keywordScore: 0.4 })]),
    foreignEmbeddingModel: vi.fn(async () => null),
    ...overrides,
  };
}

const fakeEmbedder = (): QueryEmbedder => ({
  modelId: async () => 'ollama:test',
  embed: vi.fn(async () => ({ modelId: 'ollama:test', vector: [1, 0], cached: false })),
});

describe('retriever', () => {
  it('hybrid: fuses both lists, keeps both raw scores, and normalizes whitespace', async () => {
    const store = fakeStore();
    const embedder = fakeEmbedder();
    const r = await createRetriever(store, embedder, { candidates: 20 }).retrieve({
      clientId: 't', collectionId: 'c', query: '  roll   back? ', mode: 'hybrid', topK: 3,
    });
    expect(r.chunks[0]).toMatchObject({ chunkId: 'both', vectorScore: 0.7, keywordScore: 0.4 });
    expect(r.chunks).toHaveLength(3);
    expect(r.topVectorScore).toBe(0.8);
    expect(embedder.embed).toHaveBeenCalledWith('roll back?');
    expect(store.keywordSearch).toHaveBeenCalledWith('t', 'c', 'roll back?', 20);
    expect(Object.keys(r.timings).sort()).toEqual(['embed', 'keyword_search', 'vector_search']);
  });

  it('vector and keyword modes use only their own retriever', async () => {
    const store = fakeStore();
    const embedder = fakeEmbedder();
    const retriever = createRetriever(store, embedder, { candidates: 20 });

    const v = await retriever.retrieve({ clientId: 't', collectionId: 'c', query: 'q', mode: 'vector', topK: 5 });
    expect(v.chunks.map((c) => c.chunkId)).toEqual(['v1', 'both']);
    expect(store.keywordSearch).not.toHaveBeenCalled();

    const k = await retriever.retrieve({ clientId: 't', collectionId: 'c', query: 'q', mode: 'keyword', topK: 5 });
    expect(k.chunks.map((c) => c.chunkId)).toEqual(['k1', 'both']);
    expect(k.topVectorScore).toBeNull();
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('refuses to search vectors produced by a different embedding model', async () => {
    const store = fakeStore({ foreignEmbeddingModel: vi.fn(async () => 'openai:text-embedding-3-small@768') });
    await expect(
      createRetriever(store, fakeEmbedder(), { candidates: 20 }).retrieve({
        clientId: 't', collectionId: 'c', query: 'q', mode: 'hybrid', topK: 5,
      }),
    ).rejects.toBeInstanceOf(EmbeddingModelMismatchError);
    expect(store.vectorSearch).not.toHaveBeenCalled();
  });
});

describe('query embedder cache', () => {
  const ml = (): MlClient => ({
    ingest: vi.fn(),
    info: vi.fn(async () => ({ model_id: 'ollama:nomic-embed-text', dim: 3 })),
    embed: vi.fn(async () => ({ model: 'ollama:nomic-embed-text', embeddings: [[0.25, -0.5, 0.75]] })),
  });

  it('embeds once, then serves the vector from cache (float32 round-trip)', async () => {
    const client = ml();
    const cache = memoryCache();
    const embedder = createQueryEmbedder(client, cache);

    const first = await embedder.embed('how do I roll back?');
    const second = await embedder.embed('how do I roll back?');
    expect(first.cached).toBe(false);
    expect(second).toEqual({ modelId: 'ollama:nomic-embed-text', vector: [0.25, -0.5, 0.75], cached: true });
    expect(client.embed).toHaveBeenCalledTimes(1);
    expect([...cache.store.keys()][0]).toMatch(/^emb:ollama:nomic-embed-text:[0-9a-f]{64}$/);
  });

  it('retries fetching the model id after ml was unavailable', async () => {
    const client = ml();
    vi.mocked(client.info).mockRejectedValueOnce(new Error('ml down'));
    const embedder = createQueryEmbedder(client, memoryCache());
    await expect(embedder.modelId()).rejects.toThrow('ml down');
    await expect(embedder.modelId()).resolves.toBe('ollama:nomic-embed-text');
  });
});
