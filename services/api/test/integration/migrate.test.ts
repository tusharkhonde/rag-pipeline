import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';

const pool = createPool(process.env.DATABASE_URL ?? 'postgresql://rag:rag@localhost:5432/rag');
const dir = new URL('../../../../db/migrations', import.meta.url).pathname;

afterAll(() => pool.end());

describe('migrate', () => {
  it('is idempotent: a second run applies nothing', async () => {
    await migrate(pool, dir);
    expect(await migrate(pool, dir)).toEqual([]);
  });

  it('serializes concurrent runners via the advisory lock', async () => {
    const results = await Promise.all([migrate(pool, dir), migrate(pool, dir), migrate(pool, dir)]);
    expect(results.flat()).toEqual([]);
  });

  it('creates the pgvector HNSW index', async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'chunks_embedding_hnsw'`,
    );
    expect(rows[0]?.indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });
});
