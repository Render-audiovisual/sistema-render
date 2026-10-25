import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  resolveWilsonUser, isWilsonLeader, reviewTaskOwnedBy, canWilsonAssignPrivately,
  telegramWilsonUserId, wilsonSystemRouteAllowed, requireWilsonService,
  buildWilsonSignatureMessage, createWilsonRouter,
  buildWilsonTaskUpdate, resolveWilsonTaskAssignmentWrite,
} from "../src/wilson-integration.js";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function bind(rows, { channel = "whatsapp", privateChat = false, env = {}, method = "GET", path = "/tareas", actorId = "external" } = {}) {
  const calls = [];
  const req = { method, path, wilson: { channel, privateChat, actorId, actorName: "Agustín Franco Líder", actorRole: "admin", userId: 99, isLeader: true } };
  const res = response();
  let next = false;
  await resolveWilsonUser({ query: async (sql, params) => { calls.push({ sql, params }); return { rows }; } }, env)(req, res, error => { if (error) throw error; next = true; });
  return { req, res, next, calls };
}

test("WhatsApp requires exactly one active linked DB identity, even in groups", async () => {
  for (const rows of [[], [{ id: 1, activo: false, rol: "admin" }], [{ id: 1, activo: true }, { id: 2, activo: true }], [{ id: 0, activo: true }]]) {
    for (const privateChat of [false, true]) {
      const result = await bind(rows, { privateChat });
      assert.equal(result.res.statusCode, 403);
      assert.equal(result.next, false);
      assert.equal(result.req.wilson.userId, null);
      assert.equal(result.req.wilson.isLeader, false);
      assert.doesNotMatch(result.calls[0].sql, /LIMIT 1|lower\(usuario\)/);
    }
  }
});

test("current database role only: renames and privileged-looking names confer no leadership", async () => {
  for (const rol of ["admin", "community", "diseno", "edicion", "produccion", "lider", "unknown", undefined]) {
    for (const nombre of ["Persona renombrada", "Agustín", "Franco", "Líder"]) {
      const { req, next } = await bind([{ id: 11, nombre, usuario: "lider", rol, activo: true }]);
      assert.equal(next, true);
      assert.equal(req.wilson.userId, 11);
      assert.equal(req.wilson.actorName, nombre);
      assert.equal(isWilsonLeader(req), rol === "admin");
      assert.equal(req.wilson.isLeader, rol === "admin");
    }
  }
});

test("Telegram requires explicit numeric server-side user binding, not historical owner IDs", async () => {
  for (const config of [undefined, "bad json", '[]', '{"1826333320":"11"}', '{"1826333320":0}']) {
    const env = { WILSON_TELEGRAM_USER_BINDINGS: config, WILSON_LEADER_TELEGRAM_IDS: "1826333320" };
    assert.equal(telegramWilsonUserId(env, "1826333320"), null);
    const result = await bind([], { channel: "telegram", actorId: "1826333320", env });
    assert.equal(result.res.statusCode, 403);
    assert.equal(result.calls.length, 0);
  }
  const env = { WILSON_TELEGRAM_USER_BINDINGS: '{"external":11}' };
  const result = await bind([{ id: 11, nombre: "Renombrado", rol: "edicion", activo: true }], { channel: "telegram", env });
  assert.equal(result.next, true);
  assert.equal(isWilsonLeader(result.req), false);
  assert.deepEqual(result.calls[0].params, [11]);
  assert.equal((await bind([{ id: 11, activo: false }], { channel: "telegram", env })).res.statusCode, 403);
});

test("task ownership and assignment policy accept stable numeric IDs only", () => {
  const task = { asignado_a: "Franco", propiedades_extra: { colaboradores: ["Agustín"] }, asignado_a_id: 11, colaborador_ids: [22] };
  for (const id of ["Franco", "Agustín", "11", 0, undefined, 33]) assert.equal(reviewTaskOwnedBy(task, id), false);
  assert.equal(reviewTaskOwnedBy(task, 11), true);
  assert.equal(reviewTaskOwnedBy(task, 22), true);
  assert.equal(reviewTaskOwnedBy({ asignado_a: "Franco" }, 11), false);
  for (const actorRole of ["admin", "community", "edicion", "lider", "unknown"]) {
    const actor = { userId: 11, actorRole, actorName: "Agustín", leader: true };
    assert.equal(canWilsonAssignPrivately(actor, 11), true);
    assert.equal(canWilsonAssignPrivately(actor, 22), actorRole === "admin");
    for (const name of ["Agustín", "Augusto", "Mariano", "11"]) assert.equal(canWilsonAssignPrivately(actor, name), false);
  }
  assert.equal(canWilsonAssignPrivately({ actorRole: "admin" }, 11), false);
});

test("system actor is confined to explicit machine routes and never a human admin", async () => {
  const env = { WILSON_SYSTEM_ACTOR_ID: "system" };
  for (const [method, path] of [["POST", "/tareas"], ["PATCH", "/tareas/1"], ["GET", "/tareas"], ["POST", "/lotes/revision/confirmar"], ["GET", "/supervisor/contexto"]]) {
    assert.equal(wilsonSystemRouteAllowed(method, path), false);
    assert.equal((await bind([], { actorId: "system", method, path, env })).res.statusCode, 403);
  }
  for (const [method, path] of [["GET", "/eventos-pendientes"], ["POST", "/supervisor/tick"], ["GET", "/notificaciones-privadas/1/verificar"]]) {
    const result = await bind([], { actorId: "system", method, path, env });
    assert.equal(result.next, true);
    assert.equal(result.req.wilson.systemActor, true);
    assert.equal(result.req.wilson.userId, null);
    assert.equal(isWilsonLeader(result.req), false);
    assert.equal(result.calls.length, 0);
  }
});

const keys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
function signedRequest({ channel = "telegram", target = "/api/wilson/tareas?limit=1", version = "2" } = {}) {
  const timestamp = "1800000000", nonce = crypto.randomUUID(), actorId = channel === "telegram" ? "bound-telegram" : "system";
  const groupId = channel === "whatsapp" ? "group" : "";
  const req = { method: "GET", baseUrl: "/api/wilson", path: "/tareas", url: "/tareas?limit=1", originalUrl: target, body: undefined,
    headers: { "x-wilson-channel": channel, "x-wilson-actor-id": actorId, "x-wilson-group-id": groupId,
      "x-wilson-timestamp": timestamp, "x-wilson-nonce": nonce, "x-wilson-signature-version": version } };
  const message = buildWilsonSignatureMessage({ timestamp, nonce, channel, actorId, groupId, method: "GET", path: target });
  req.headers["x-wilson-signature"] = crypto.sign("sha256", Buffer.from(message), keys.privateKey).toString("base64");
  return req;
}
const signedEnv = { WILSON_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }), WILSON_TELEGRAM_USER_BINDINGS: '{"bound-telegram":11}',
  WILSON_SYSTEM_ACTOR_ID: "system", WILSON_ALLOWED_WHATSAPP_GROUP_IDS: "group,other" };
function verify(req) {
  const res = response(); let accepted = false;
  requireWilsonService(signedEnv, () => 1800000000000)(req, res, () => { accepted = true; });
  return { res, accepted };
}
test("all channels/system require v2; full query target and channel/group/actor are signed", () => {
  for (const channel of ["telegram", "whatsapp"]) {
    for (const version of ["", "1", "3"]) assert.equal(verify(signedRequest({ channel, version })).res.statusCode, 401);
    assert.equal(verify(signedRequest({ channel })).accepted, true);
    const tampered = signedRequest({ channel }); tampered.originalUrl = "/api/wilson/tareas?limit=100";
    assert.equal(verify(tampered).res.statusCode, 401);
    const group = signedRequest({ channel }); group.headers["x-wilson-actor-name"] = "Agustín";
    assert.equal(verify(group).res.statusCode, 401);
  }
  const noQuery = signedRequest({ target: "/api/wilson/tareas" });
  assert.equal(verify(noQuery).accepted, true);
  const fallback = signedRequest(); delete fallback.originalUrl;
  assert.equal(verify(fallback).accepted, true);
  const groupSubstitution = signedRequest({ channel: "whatsapp" });
  groupSubstitution.headers["x-wilson-group-id"] = "other";
  assert.equal(verify(groupSubstitution).res.statusCode, 401);
  const channelSubstitution = signedRequest();
  channelSubstitution.headers["x-wilson-channel"] = "whatsapp";
  channelSubstitution.headers["x-wilson-group-id"] = "group";
  assert.equal(verify(channelSubstitution).res.statusCode, 401);
});

function route(pool, method, path) {
  const router = createWilsonRouter({ pool, env: { NODE_ENV: "test" } });
  return router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
}
const actor = { userId: 11, actorRole: "edicion", actorName: "Franco", actorId: "external", groupId: "group", channel: "whatsapp", privateChat: false };

test("batch confirmation rechecks ID membership after task row locks, before any task update", async () => {
  const calls = [];
  const actorHash = crypto.createHash('sha256').update(actor.actorId).digest('hex');
  const task = { id: 100, titulo: "Carrusel", asignado_a: "Franco", estado: "pendiente", updated_at: "2026-10-19T12:00:00Z",
    propiedades_extra: { workspace: 'render_os' } };
  const client = { release() {}, async query(sql, params = []) {
    calls.push(sql);
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE') {
      assert.deepEqual(params, [actor.userId]);
      return { rows: [{ id: actor.userId, usuario: 'qa-identity', nombre: actor.actorName, rol: actor.actorRole,
        activo: true, whatsapp_id_hash: actorHash, whatsapp_habilitado: true }] };
    }
    if (compact === 'SELECT actor_hash,usuario_id,enabled FROM mia_whatsapp_identities WHERE actor_hash=$1 FOR SHARE') {
      assert.deepEqual(params, [actorHash]); return { rows: [] };
    }
    if (compact.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE')) {
      assert.match(compact, /ORDER BY u.id FOR SHARE OF u$/);
      assert.deepEqual(params, [actorHash]); return { rows: [{ id: actor.userId }] };
    }
    if (compact === 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))') {
      assert.deepEqual(params, [JSON.stringify(['wilson-review-batch-v1', 'wilson', 'whatsapp', 'external', 'group'])]);
      return { rows: [] };
    }
    if (sql.includes("FROM integracion_confirmaciones")) return { rows: [{ token: 'token', actor_id: 'external', grupo_id: 'group',
      integracion: 'wilson', canal: 'whatsapp', operacion: 'revisar_lote', informante_actor_id: "external", payload: { tasks: [task] } }] };
    if (sql.includes("FROM tareas WHERE")) { assert.match(compact, /ORDER BY id FOR UPDATE$/); return { rows: [task] }; }
    if (sql.includes("SELECT tarea_id, usuario_id, tipo")) return { rows: [{ tarea_id: 100, usuario_id: 22, tipo: "responsable" }] };
    return { rows: [] };
  } };
  const res = response();
  await route({ connect: async () => client }, "post", "/lotes/revision/confirmar")({ wilson: actor, body: { confirmacion_token: "token" } }, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.ok(calls.findIndex(sql => sql.includes('FROM usuarios WHERE id=$1 FOR SHARE'))
    < calls.findIndex(sql => sql.includes('FROM integracion_confirmaciones')));
  const hint = calls.findIndex(sql => sql.includes('FROM integracion_confirmaciones'));
  const gate = calls.findIndex(sql => sql.includes('pg_advisory_xact_lock'));
  const locked = calls.findIndex(sql => sql.includes('FROM integracion_confirmaciones') && /FOR UPDATE/.test(sql));
  assert.ok(hint < gate && gate < locked && locked < calls.findIndex(sql => /FROM tareas WHERE/.test(sql)));
  assert.ok(calls.findIndex(sql => /FROM tareas WHERE[\s\S]*FOR UPDATE/.test(sql)) < calls.findIndex(sql => sql.includes("SELECT tarea_id, usuario_id, tipo")));
  assert.equal(calls.some(sql => /UPDATE tareas/.test(sql)), false);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("task POST idempotent row is reauthorized before returning, including group requests", async () => {
  const calls = [];
  const client = { release() {}, async query(sql) {
    calls.push(sql);
    if (sql.includes("wilson_idempotency_key")) return { rows: [{ id: 100, titulo: "Private", asignado_a: "Franco" }] };
    return { rows: [] };
  } };
  const res = response();
  await route({ connect: async () => client }, "post", "/tareas")({ wilson: actor, headers: { "idempotency-key": "known" }, body: {} }, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.stringify(res.body).includes("Private"), false);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("task detail denies matching legacy name without normalized membership, even in groups", async () => {
  const pool = { query: async sql => ({ rows: sql.includes("SELECT tarea_id") ? [] : [{ id: 100, asignado_a: "Franco" }] }) };
  const res = response();
  await route(pool, "get", "/tareas/:id")({ wilson: actor, params: { id: "100" } }, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
});

test("PATCH and archive deny label impostors before mutating tasks", async () => {
  for (const [method,path] of [["patch","/tareas/:id"],["post","/tareas/:id/archivar"]]) {
    const calls = [];
    const client = {release() {},async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash')) return {rows:[{id:11,nombre:'Franco',rol:'edicion',activo:true,whatsapp_habilitado:true,whatsapp_id_hash:crypto.createHash('sha256').update('external').digest('hex')}]};
      if (sql.startsWith('SELECT u.id FROM usuarios')) return {rows:[{id:11}]};
      if (sql.includes("FROM tareas t")) return {rows:[{id:100,revision:7,asignado_a:"Franco",propiedades_extra:{workspace:'render_os'}}]};
      if (sql.startsWith('SELECT tarea_id, usuario_id, tipo')) return {rows:[{tarea_id:100,usuario_id:22,tipo:'responsable'}]};
      return {rows:[]};
    }};
    const res = response();
    await route({connect:async()=>client},method,path)({wilson:{...actor},params:{id:"100"},headers:{"idempotency-key":"update"},body:{expected_revision:7,...(method==='patch'?{titulo:'Cambio válido'}:{}),confirmacion_token:'11111111-1111-4111-8111-111111111111'}},res,error=>{throw error;});
    assert.equal(res.statusCode,403);
    assert.ok(calls.some(sql=>sql.includes('FROM task_operation_receipts')));
    assert.ok(calls.some(sql=>sql.includes('FROM tareas t')&&sql.includes('FOR UPDATE')));
    assert.equal(calls.some(sql=>sql.includes('UPDATE integracion_confirmaciones')),false);
    assert.equal(calls.some(sql=>sql.includes("UPDATE tareas")),false);
    assert.equal(calls.at(-1),"ROLLBACK");
  }
});

test("human list/query/report/context filters use normalized membership, never label authority", () => {
  const source = readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
  const readRoutes = source.slice(source.indexOf('// Bounded, filtered task reads'), source.indexOf('router.get("/eventos-pendientes"'));
  assert.doesNotMatch(readRoutes, /LOWER\(t.asignado_a\)|jsonb_array_elements_text|wilsonPersonAliases|knownWilsonPerson/);
  assert.equal((readRoutes.match(/FROM tarea_asignaciones a/g) || []).length, 5);
  assert.doesNotMatch(source, /reviewTaskOwnedBy\(task, req.wilson.actorName\)/);
});

const patchTask = {
  id: 100, titulo: "Reel existente", asignado_a: "Etiqueta anterior", cliente_id: 1,
  tipo_tarea: "edicion", prioridad: "media", estado: "pendiente",
  propiedades_extra: { colaboradores: ["Colaborador anterior"] },
};
const patchCatalog = { clients: [{id:1,nombre:"Cliente"}], users: [
  {id:11,nombre:"Etiqueta anterior",activo:true}, {id:99,nombre:"Etiqueta anterior",activo:true},
  {id:22,nombre:"Persona renombrada",activo:false}, {id:33,nombre:"Nueva selección",activo:true},
] };

test("content-only PATCH ignores homonymous, renamed and inactive untouched labels", async () => {
  for (const users of [patchCatalog.users, [], [{id:11,nombre:"Etiqueta anterior",activo:false}]]) {
    const result = buildWilsonTaskUpdate({titulo:"Contenido actualizado"},patchTask,{...patchCatalog,users});
    assert.deepEqual(result.errors,[]);
    assert.equal(result.task.asignado_a,patchTask.asignado_a);
    assert.deepEqual(result.task.colaboradores,patchTask.propiedades_extra.colaboradores);
    assert.equal(await resolveWilsonTaskAssignmentWrite({query(){throw new Error("No consultar asignaciones omitidas");}},
      {titulo:"Contenido actualizado"},result.task,patchTask),null);
  }
});

test("partial selection validates only selected recipients and preserves untouched inactive bindings", async () => {
  for (const [input,expectedOwner,expectedCollaborators] of [
    [{responsable:"Nueva selección"},33,[22]],
    [{colaboradores:["Nueva selección"]},11,[33]],
  ]) {
    const result = buildWilsonTaskUpdate(input,patchTask,patchCatalog);
    assert.deepEqual(result.errors,[]);
    const lookups=[];
    const db={async query(sql,params){
      if(sql.includes("SELECT tarea_id")) return {rows:[{tarea_id:100,usuario_id:11,tipo:"responsable"},{tarea_id:100,usuario_id:22,tipo:"colaborador"}]};
      lookups.push(params);
      assert.deepEqual(params[0],[]); // Never revalidate omitted IDs or labels.
      return {rows:[{id:33,nombre:"Nueva selección",activo:true}]};
    }};
    const assignment=await resolveWilsonTaskAssignmentWrite(db,input,result.task,patchTask);
    assert.equal(assignment.ownerId,expectedOwner);
    assert.deepEqual(assignment.collaboratorIds,expectedCollaborators);
    assert.deepEqual(lookups,[[[],["Nueva selección"]]]);
  }
});

test("explicit homonymous, renamed-away or inactive selections still fail validation", () => {
  for (const value of ["Etiqueta anterior","Colaborador anterior","Persona renombrada"]) {
    for(const input of [{responsable:value},{colaboradores:[value]}]) {
      assert.ok(buildWilsonTaskUpdate(input,patchTask,patchCatalog).errors.length>0);
    }
  }
});
