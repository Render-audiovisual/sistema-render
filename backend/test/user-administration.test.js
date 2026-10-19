import test from "node:test";
import assert from "node:assert/strict";
import { administerUser } from "../src/user-administration.js";

function fixture({ count = 1, target = { id: 1, rol: "admin", activo: true } } = {}) {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.startsWith("SELECT id")) return { rows: target ? [target] : [] };
    if (sql.startsWith("SELECT count")) return { rows: [{ count }] };
    return { rows: [] };
  }, release() { calls.push("release"); } };
  return { calls, pool: { async connect() { return db; } } };
}

test("all owner-removing operations retain the last active admin", async () => {
  for (const next of [{ delete: true }, { activo: false }, { rol: "diseno" }]) {
    const { pool, calls } = fixture();
    await assert.rejects(administerUser(pool, 1, next, () => assert.fail("must not mutate")), { status: 409 });
    assert.match(calls[1], /pg_advisory_xact_lock/);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "release"]);
  }
});

test("permitted changes commit and propagate transaction failure", async () => {
  const { pool, calls } = fixture({ count: 2 });
  assert.equal(await administerUser(pool, 1, { activo: false }, async () => "saved"), "saved");
  assert.deepEqual(calls.slice(-2), ["COMMIT", "release"]);
  const broken = fixture();
  await assert.rejects(administerUser(broken.pool, 1, { rol: "admin" }, async () => { throw Error("failure"); }), /failure/);
  assert.deepEqual(broken.calls.slice(-2), ["ROLLBACK", "release"]);
});

test("missing user is not a successful mutation", async () => {
  const { pool } = fixture({ target: null });
  await assert.rejects(administerUser(pool, 99, {}, () => assert.fail()), { status: 404 });
});
