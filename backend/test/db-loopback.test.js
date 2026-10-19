import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackDatabaseUrl, pool } from "../src/db.js";

test("only actual loopback PostgreSQL hosts skip TLS", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(isLoopbackDatabaseUrl(`postgres://test@${host}:55594/render2_local_test`), true);
  }
  for (const url of [undefined, "invalid", "postgres://test@localhost.example.com/db", "postgres://test@remote.example/db?application_name=localhost"]) {
    assert.equal(isLoopbackDatabaseUrl(url), false);
  }
});
test.after(async () => { await pool.end(); });
