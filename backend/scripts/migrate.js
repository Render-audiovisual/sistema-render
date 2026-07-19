// Corre backend/migrations/*.sql en orden (000, 001, 002, ...), una sola
// vez cada una. Guarda qué migraciones ya se aplicaron en la tabla
// _migrations, así se puede correr este script las veces que sea sin
// duplicar trabajo ni romper nada — tanto en un servidor nuevo (arranca
// todo desde 000) como en el servidor viejo (donde algunas tablas ya
// existían antes de que existiera este sistema de migraciones).
//
// Uso: node scripts/migrate.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

async function main() {
  const archivos = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (archivos.length === 0) {
    console.log("No hay migraciones en", migrationsDir);
    return;
  }

  // _migrations se crea dentro de 000_initial_schema.sql, pero si alguien
  // corre este script contra una base que ya tiene todo menos esa tabla,
  // la creamos acá también antes de consultarla.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: aplicadas } = await pool.query(
    "SELECT nombre FROM _migrations",
  );
  const yaAplicadas = new Set(aplicadas.map((r) => r.nombre));

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      console.log(`— ${archivo} (ya aplicada, se salta)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, archivo), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO _migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING",
        [archivo],
      );
      await client.query("COMMIT");
      console.log(`✓ ${archivo} aplicada`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`✗ ${archivo} falló, se revirtió esa migración:`);
      console.error(error.message);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error("Error corriendo migraciones:", error);
  process.exit(1);
});
