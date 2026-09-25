import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = buildApp({ config, pool });

await migrate(pool, config.MIGRATIONS_DIR, (msg) => app.log.info(msg));
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
