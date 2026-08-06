import "dotenv/config";
import { pool } from "../src/db.js";
import { runMigrations } from "../src/migrations.js";

try {
  await runMigrations(pool);
} catch (error) {
  console.error("Error corriendo migraciones:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
