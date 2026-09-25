import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

// Arbitrary app-wide constant. Every API instance takes the same lock, so if several
// replicas boot at once only one applies migrations; the others wait, then see them applied.
const MIGRATION_LOCK_ID = 72_431;

export async function migrate(
  pool: pg.Pool,
  dir: string,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((r) => r.name));
    // Zero-padded prefixes (001_, 002_) make lexical order == apply order.
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      // Each migration and its bookkeeping row commit atomically: a failure leaves no half-applied schema.
      // (Caveat: statements like CREATE INDEX CONCURRENTLY can't run inside a transaction.)
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      log(`applied migration ${file}`);
      appliedNow.push(file);
    }
    return appliedNow;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
