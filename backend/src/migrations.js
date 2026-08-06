import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

export async function runMigrations(pool, logger = console) {
  const archivos = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  if (!archivos.length) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await pool.query("SELECT nombre FROM _migrations");
  const aplicadas = new Set(rows.map((row) => row.nombre));

  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(fs.readFileSync(path.join(migrationsDir, archivo), "utf8"));
      await client.query("INSERT INTO _migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING", [archivo]);
      await client.query("COMMIT");
      logger.log(`✓ ${archivo} aplicada`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`La migración ${archivo} falló: ${error.message}`);
    } finally {
      client.release();
    }
  }
}
