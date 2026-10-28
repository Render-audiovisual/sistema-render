import { AuthorityBoundPool as Pool } from './database-authority-context.js';
import { buildDatabasePoolConfig } from './database-transport.js';
export { isLoopbackDatabaseUrl } from './database-transport.js';

const config = buildDatabasePoolConfig(process.env);
const unconfigured = () => Promise.reject(Object.assign(
  new Error('Falta un destino PostgreSQL explícito.'), { code: 'RENDER_DB_NOT_CONFIGURED' },
));
// Disabled imports stay inert; neither pg defaults nor PGHOST may select an
// unknown database when an explicit URL was not provided.
export const pool = config ? new Pool(config) : Object.freeze({
  query: unconfigured, connect: unconfigured, end: async () => {},
});

// pg discards failed idle clients itself. Handle its pool-level error event
// without retrying operations or disclosing connection/error/client details.
if (config) pool.on('error', () => {
  console.error('PostgreSQL: conexión ociosa interrumpida.');
});

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
