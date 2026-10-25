import test from "node:test";
import assert from "node:assert/strict";
import { createWilsonRouter, buildWilsonConfirmationHash } from "../src/wilson-integration.js";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fixture({ failure, created = true, tokenRevision = 7, notifyFailure = false } = {}) {
  const calls = [], notifications = [], errors = [];
  let callbackCount = 0, connects = 0;
  let stored = { tokenUsed: false, confirmed: false, editing: false, audit: false };
  let pending;
  const result = { task: { id: 100, revision: 8, estado: "en_revision" }, editing_task: created ? { id: 200, revision: 1 } : null, created };
  const tokenBody = { expected_revision: tokenRevision };
  const tokenHash = buildWilsonConfirmationHash({ operation: "confirmar_grabacion", taskId: 100, payload: tokenBody });
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN") { pending = structuredClone(stored); return { rows: [] }; }
      if (sql === "ROLLBACK") { pending = undefined; return { rows: [] }; }
      if (sql === "COMMIT") {
        if (failure === "commit") throw new Error("commit failure");
        stored = pending; pending = undefined; return { rows: [] };
      }
      if (sql.includes("UPDATE integracion_confirmaciones")) {
        if (params[0] !== "token" || params[5] !== tokenHash) return { rows: [] };
        pending.tokenUsed = true; return { rows: [{ token: "token" }] };
      }
      if (sql === "UPDATE tareas MOCK CONFIRM") { pending.confirmed = true; return { rows: [result.task] }; }
      if (sql === "INSERT INTO tareas MOCK EDITING") { pending.editing = true; return { rows: [result.editing_task] }; }
      if (sql.includes("INSERT INTO integracion_auditoria")) {
        if (failure === "audit") throw new Error("audit failure");
        pending.audit = true; return { rows: [] };
      }
      throw new Error(`Unexpected mock query: ${sql}`);
    },
    release() { calls.push({ sql: "RELEASE" }); },
  };
  const pool = { async connect() { connects++; return client; } };
  const router = createWilsonRouter({
    pool, env: { NODE_ENV: "test" },
    async confirmProduction(options) {
      callbackCount++;
      assert.equal(options.db, client);
      assert.deepEqual(Object.keys(options).sort(), ["taskId", "actor", "db", "expectedRevision", "actorId"].sort());
      assert.equal(options.taskId, 100);
      assert.equal(options.actor, "Admin renombrado");
      assert.equal(options.actorId, 11);
      assert.equal(options.expectedRevision, 7);
      assert.equal(pending.tokenUsed, true);
      await options.db.query("UPDATE tareas MOCK CONFIRM");
      if (created) await options.db.query("INSERT INTO tareas MOCK EDITING");
      if (failure === "callback") throw Object.assign(new Error("revision conflict"), { status: 409 });
      return result;
    },
    async notifyAssignment(options) {
      assert.equal(pending, undefined);
      assert.equal(stored.audit, true);
      assert.equal(calls.at(-1).sql, "RELEASE");
      notifications.push(options);
      if (notifyFailure) throw new Error("notification unavailable");
    },
  });
  const handler = router.stack.find(layer => layer.route?.path === "/tareas/:id/confirmar-grabacion").route.stack[0].handle;
  return {
    calls, notifications, errors, pool, result,
    get stored() { return stored; }, get callbackCount() { return callbackCount; }, get connects() { return connects; },
    async run(body = { expected_revision: 7, confirmacion_token: "token" }, wilson = {}) {
      const res = response();
      await handler({ params: { id: "100" }, body, wilson: { channel: "whatsapp", userId: 11, actorRole: "admin", actorId: "external", actorName: "Admin renombrado", groupId: "private:hash", ...wilson } }, res, error => errors.push(error));
      return res;
    },
  };
}

test("required revision and verified leader gate run before any connection/token consumption", async () => {
  for (const expected_revision of [undefined, null, "7", 0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture();
    assert.equal((await f.run({ expected_revision, confirmacion_token: "token" })).statusCode, 400);
    assert.equal(f.connects, 0);
    assert.equal(f.callbackCount, 0);
  }
  for (const wilson of [{ userId: null }, { actorRole: "community" }, { actorRole: "lider" }, { systemActor: true }]) {
    const f = fixture();
    assert.equal((await f.run(undefined, wilson)).statusCode, 403);
    assert.equal(f.connects, 0);
  }
});

test("token, callback task writes and audit share one client/commit; notify after commit/release", async () => {
  const f = fixture();
  const res = await f.run();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ...f.result,
    task: { ...f.result.task, responsables: [], url: 'https://sistema.rendercorrientes.com/workspace/tareas?task=100' },
    editing_task: { ...f.result.editing_task, responsables: [], url: 'https://sistema.rendercorrientes.com/workspace/tareas?task=200' },
  });
  assert.deepEqual(f.stored, { tokenUsed: true, confirmed: true, editing: true, audit: true });
  assert.equal(f.connects, 1);
  assert.equal(f.callbackCount, 1);
  assert.deepEqual(f.calls.filter(call => ["BEGIN", "COMMIT", "ROLLBACK", "RELEASE"].includes(call.sql)).map(call => call.sql), ["BEGIN", "COMMIT", "RELEASE"]);
  assert.deepEqual(f.notifications, [{ pool: f.pool, tarea: f.result.editing_task, motivo: "creada", actor: "Admin renombrado", actorId: 11 }]);
  assert.deepEqual(f.errors, []);
});

test("revision is part of confirmation hash; changed revision or invalid token aborts before callback", async () => {
  for (const [tokenRevision, body] of [[8, { expected_revision: 7, confirmacion_token: "token" }], [7, { expected_revision: 7, confirmacion_token: "wrong" }]]) {
    const f = fixture({ tokenRevision });
    assert.equal((await f.run(body)).statusCode, 409);
    assert.equal(f.callbackCount, 0);
    assert.equal(f.notifications.length, 0);
    assert.deepEqual(f.stored, { tokenUsed: false, confirmed: false, editing: false, audit: false });
    assert.equal(f.calls.at(-2).sql, "ROLLBACK");
    assert.equal(f.calls.at(-1).sql, "RELEASE");
  }
});

for (const failure of ["callback", "audit", "commit"]) {
  test(`${failure} failure rolls back token, task and editing creation without notifications`, async () => {
    const f = fixture({ failure });
    await f.run();
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.stored, { tokenUsed: false, confirmed: false, editing: false, audit: false });
    assert.equal(f.notifications.length, 0);
    assert.equal(f.calls.at(-2).sql, "ROLLBACK");
    assert.equal(f.calls.at(-1).sql, "RELEASE");
  });
}

test("no new editing task means no creation notification", async () => {
  const f = fixture({ created: false });
  assert.equal((await f.run()).statusCode, 200);
  assert.equal(f.stored.confirmed, true);
  assert.equal(f.notifications.length, 0);
});

test("notification error after commit does not rollback committed confirmation", async () => {
  const f = fixture({ notifyFailure: true });
  assert.equal((await f.run()).statusCode, 200);
  assert.equal(f.stored.confirmed, true);
  assert.equal(f.calls.some(call => call.sql === "ROLLBACK"), false);
  assert.deepEqual(f.errors, []);
});

test("GET detail and production intake expose persisted revision without manufacturing one", async () => {
  for (const path of ["/tareas/:id", "/visitas-material"]) {
    let taskReads = 0;
    const pool = { async query(sql) {
      if (sql.includes("SELECT tarea_id, usuario_id, tipo")) return { rows: [] };
      taskReads++;
      assert.match(sql, /SELECT t.id,t.revision,t.titulo/);
      return { rows: [{ id: 100, revision: 17, titulo: "Visita producción", tipo_tarea: "produccion", propiedades_extra: {} }] };
    } };
    const router = createWilsonRouter({ pool, env: { NODE_ENV: "test" } });
    const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack[0].handle;
    const res = response();
    await handler({ params: { id: "100" }, query: {}, wilson: { userId: 11, actorRole: "admin" } }, res, error => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(path === "/tareas/:id" ? res.body.task.revision : res.body.tasks[0].revision, 17);
    assert.equal(taskReads, 1);
  }
});
