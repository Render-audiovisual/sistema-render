import pg from "pg";

const { Pool } = pg;

// Supabase (y la mayoría de los Postgres administrados) exigen SSL. En
// local, contra localhost, no hace falta y de hecho puede fallar si se
// fuerza — por eso queda condicionado a que la URL no sea local.
const connectionString = process.env.DATABASE_URL;
const requiereSSL = connectionString && !connectionString.includes("localhost");

export const pool = new Pool({
  connectionString,
  ssl: requiereSSL ? { rejectUnauthorized: false } : false,
});

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
