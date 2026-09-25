import { createHash } from 'node:crypto';
import type { Cache } from '../cache/cache.js';
import type { MlClient } from '../ml/client.js';

const TTL_SECONDS = 7 * 24 * 3600; // an embedding for a given (model, text) never changes

export interface QueryEmbedding {
  modelId: string;
  vector: number[];
  cached: boolean;
}

export interface QueryEmbedder {
  modelId(): Promise<string>;
  embed(query: string): Promise<QueryEmbedding>;
}

// float32 binary + base64: ~4KB per 768-d vector vs ~15KB as a JSON array of decimals.
const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const decode = (s: string) => {
  const buf = Buffer.from(s, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
};

export function createQueryEmbedder(ml: MlClient, cache: Cache): QueryEmbedder {
  let modelIdPromise: Promise<string> | undefined;
  const modelId = () => {
    modelIdPromise ??= ml.info().then((i) => i.model_id);
    modelIdPromise.catch(() => (modelIdPromise = undefined)); // retry on next call if ml was down
    return modelIdPromise;
  };

  return {
    modelId,
    async embed(query) {
      const model = await modelId();
      // The model id is part of the key: switching models must never serve old-space vectors.
      const key = `emb:${model}:${createHash('sha256').update(query).digest('hex')}`;
      const hit = await cache.get(key);
      if (hit) return { modelId: model, vector: decode(hit), cached: true };

      const { embeddings } = await ml.embed([query], 'query');
      const vector = embeddings[0]!;
      await cache.set(key, encode(vector), TTL_SECONDS);
      return { modelId: model, vector, cached: false };
    },
  };
}
