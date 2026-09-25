import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createRepo, ensureDevClient } from './db/repo.js';
import { createMlClient } from './ml/client.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool, config.MIGRATIONS_DIR, (msg) => console.log(msg));
const devClientId = await ensureDevClient(pool);

const app = buildApp({
  config,
  repo: createRepo(pool),
  ml: createMlClient(config.ML_URL),
  resolveClientId: async () => devClientId,
});
await app.listen({ host: '0.0.0.0', port: config.PORT });

// Graceful shutdown: stop accepting requests, let in-flight ones finish, then close the pool.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
