import pg from "pg";
import { buildDatabasePoolConfig } from './database-transport.js';
export { isLoopbackDatabaseUrl } from './database-transport.js';

const { Pool } = pg;

const config = buildDatabasePoolConfig(process.env);
const unconfigured = () => Promise.reject(Object.assign(
  new Error('Falta un destino PostgreSQL explícito.'), { code: 'RENDER_DB_NOT_CONFIGURED' },
));
// Disabled imports stay inert; neither pg defaults nor PGHOST may select an
// unknown database when an explicit URL was not provided.
export const pool = config ? new Pool(config) : Object.freeze({
  query: unconfigured, connect: unconfigured, end: async () => {},
});

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
