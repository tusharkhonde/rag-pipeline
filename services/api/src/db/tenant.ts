import type pg from 'pg';

/**
 * Run `fn` in a transaction that Postgres Row-Level Security scopes to one tenant.
 *
 * SET LOCAL / set_config(..., true) last only until COMMIT/ROLLBACK, so the role and tenant
 * can't leak to the next request that reuses this pooled connection. That's the reason this
 * must be a transaction: a session-level SET on a pooled connection is a cross-tenant leak.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  clientId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE rag_app');
    await client.query(`SELECT set_config('app.client_id', $1, true)`, [clientId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
