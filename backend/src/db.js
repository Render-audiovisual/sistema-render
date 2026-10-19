import pg from "pg";

const { Pool } = pg;

// Supabase (y la mayoría de los Postgres administrados) exigen SSL. En
// local, contra localhost, no hace falta y de hecho puede fallar si se
// fuerza — por eso queda condicionado a que la URL no sea local.
const connectionString = process.env.DATABASE_URL;
// Parse the host: substring matching could trust a remote host containing
// "localhost", and incorrectly forced TLS for the isolated 127.0.0.1 test DB.
export function isLoopbackDatabaseUrl(value) {
  if (!value) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); }
  catch { return false; }
}
const requiereSSL = connectionString && !isLoopbackDatabaseUrl(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: requiereSSL ? { rejectUnauthorized: false } : false,
});

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
