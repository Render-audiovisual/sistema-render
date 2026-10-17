import test from "node:test";
import assert from "node:assert/strict";
import { initializeWithRetry, isDatabaseConnectionError } from "../src/service-startup.js";

test("recupera el arranque tras caídas sucesivas sin duplicar los servicios", async () => {
  let attempts = 0, ready = 0, active = 0;
  const delays = [], errors = [];
  await initializeWithRetry({
    initialize: async () => {
      assert.equal(active++, 0);
      try { if (++attempts < 8) throw Object.assign(new Error("network"), { code: "ETIMEDOUT" }); }
      finally { active--; }
    },
    onReady: () => ready++,
    onError: (error) => errors.push(error.code),
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(ready, 1);
  assert.equal(errors.length, 7);
  assert.deepEqual(delays, [5000,10000,20000,40000,60000,60000,60000]);
});

test("un error al iniciar servicios no repite migraciones ni servicios ya iniciados", async () => {
  let attempts = 0;
  await assert.rejects(initializeWithRetry({
    initialize: async () => attempts++,
    onReady: () => { throw new Error("scheduler failed"); },
    onError: () => assert.fail("no es un fallo de preparación"),
  }), /scheduler failed/);
  assert.equal(attempts, 1);
});

test("clasifica los cortes de conexión sin reintentar errores de datos", () => {
  assert.equal(isDatabaseConnectionError({ code: "ECONNRESET" }), true);
  assert.equal(isDatabaseConnectionError({ message: "Connection terminated unexpectedly" }), true);
  assert.equal(isDatabaseConnectionError({ code: "23505" }), false);
});

test("el pool maneja un corte ocioso y mantiene el proceso activo", async () => {
  const { pool } = await import("../src/db.js");
  assert.equal(pool.options.connectionTimeoutMillis, 8000);
  assert.ok(pool.listenerCount("error") > 0);
  const original = console.error;
  console.error = () => {};
  try { assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("network"), { code: "ECONNRESET" }))); }
  finally { console.error = original; await pool.end(); }
});
