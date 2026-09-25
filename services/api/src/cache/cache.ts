import { Redis } from 'ioredis';

/** Minimal cache contract. Values are strings; callers own serialization. */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function createRedis(url: string): Redis {
  return new Redis(url, {
    // Fail fast instead of queueing commands while Redis is down: a cache that blocks requests
    // is worse than no cache. With these settings a Redis outage just means cache misses.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });
}

export function redisCache(redis: Redis): Cache {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, 'EX', ttlSeconds);
    },
  };
}

/**
 * Wraps a cache so that failures degrade to misses (and are logged) instead of failing
 * the request. The cache is an optimization, never a dependency the answer relies on.
 */
export function failSafe(cache: Cache, onError: (err: unknown, op: string) => void): Cache {
  return {
    async get(key) {
      try {
        return await cache.get(key);
      } catch (err) {
        onError(err, 'get');
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await cache.set(key, value, ttlSeconds);
      } catch (err) {
        onError(err, 'set');
      }
    },
  };
}

/** In-process cache for tests. */
export function memoryCache(): Cache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
  };
}
