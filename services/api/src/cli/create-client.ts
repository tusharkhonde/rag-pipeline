/**
 * Register an API client and print its credentials (the secret is shown only once).
 *
 *   docker compose exec api node dist/cli/create-client.js --name demo --scopes "documents:write query"
 */
import { parseArgs } from 'node:util';
import { createClientStore } from '../auth/clients.js';
import { SCOPES, type Scope } from '../auth/tokens.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    scopes: { type: 'string', default: SCOPES.join(' ') },
    json: { type: 'boolean', default: false },
  },
});
if (!values.name) {
  console.error('usage: create-client --name <name> [--scopes "documents:write query"] [--json]');
  process.exit(2);
}
const scopes = values.scopes!.split(' ').filter(Boolean);
const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
if (unknown.length) {
  console.error(`unknown scopes: ${unknown.join(', ')} (valid: ${SCOPES.join(', ')})`);
  process.exit(2);
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool, config.MIGRATIONS_DIR);
const creds = await createClientStore(pool).create(values.name, scopes as Scope[]);
await pool.end();

if (values.json) {
  console.log(JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, scopes }));
} else {
  console.log(`client_id:     ${creds.clientId}\nclient_secret: ${creds.clientSecret}\nscopes:        ${scopes.join(' ')}`);
  console.log('\nStore the secret now: it is hashed and cannot be shown again.');
}
