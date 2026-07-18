import "dotenv/config";
import { checkDatabaseConnection, pool } from "./db.js";

try {
  const ok = await checkDatabaseConnection();
  console.log(ok ? "Postgres connection OK" : "Postgres connection failed");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error("Postgres connection failed");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
