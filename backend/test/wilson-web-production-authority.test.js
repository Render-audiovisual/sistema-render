import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWilsonChatRouter } from '../src/wilson-chat.js';
import * as authority from '../src/legacy-production-authority.js';

// Actual registered callback, memory-only transaction/rows. No HTTP listener,
// PostgreSQL, browser authentication claim, notification or external provider.
function fixture(options = {}) {
  const auth = { id: 7, rol: options.requestRole ?? 'produccion', session_version: 2, nombre: 'Untrusted request label', usuario: 'qa_actor' };
  const current = { ...auth, nombre: 'Verified QA actor', activo: true, ...(options.actor ?? {}) };
  const task = { id: 10, titulo: 'Visita QA authority', tipo_tarea: 'produccion', estado: 'pendiente',
    propiedades_extra: { workspace: options.workspace ?? 'render_os', produccion_registros: [] } };
  const initial = { task: structuredClone(task), tokenUsed: false, audits: [], messages: [], conversations: [] };
  let stored = structuredClone(initial), transaction, expired = false;
  const calls = [], releases = [];
  const writeFailure = new Error('Synthetic write failure'), rollbackFailure = new Error('Synthetic rollback failure');
  const client = {
    release(error) { releases.push(error); },
    async query(sql, params = []) {
      calls.push({ sql, params: structuredClone(params) });
      if (sql === 'BEGIN' || sql.startsWith('BEGIN ISOLATION LEVEL')) {
        assert.equal(sql, 'BEGIN ISOLATION LEVEL READ COMMITTED', 'Fresh ACL/token rereads require explicit READ COMMITTED');
        assert.equal(transaction, undefined); transaction = structuredClone(stored); return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        transaction = undefined;
        if (options.rollbackFails) throw rollbackFailure;
        return { rows: [] };
      }
      if (sql === 'COMMIT') { assert.ok(transaction); stored = transaction; transaction = undefined; return { rows: [] }; }
      if (sql.includes('FROM usuarios WHERE id=$1') && sql.includes('FOR SHARE')) {
        assert.deepEqual(params, [7], 'Current authority uses the captured account ID');
        return { rows: options.missingActor ? [] : [structuredClone(current)] };
      }
      if (sql === 'SELECT nombre,usuario FROM usuarios WHERE id=$1') {
        assert.deepEqual(params, [7]); return { rows: [{ nombre: current.nombre, usuario: current.usuario }] };
      }
      if (sql === 'SELECT id,nombre FROM usuarios WHERE id=$1') {
        if (options.expiry === 'before-message-claim') expired = true;
        assert.deepEqual(params, [8]); return { rows: [{ id: 8, nombre: 'QA message recipient' }] };
      }
      if (sql.includes('FROM wilson_acciones_pendientes')) {
        assert.deepEqual(params, ['qa-owned-token', 7], 'Token remains scoped to the captured actor');
        assert.match(sql, /usuario_id=\$2/); assert.match(sql, /confirmed_at IS NULL/);
        assert.match(sql, /expires_at\s*>\s*clock_timestamp\(\)/i, 'Hint and token lock must use a fresh wall-clock TTL');
        assert.doesNotMatch(sql, /\bNOW\(\)|CURRENT_TIMESTAMP/i);
        const locked = sql.includes('FOR UPDATE');
        if (!locked) assert.doesNotMatch(sql, /FOR (SHARE|NO KEY UPDATE|KEY SHARE)/, 'Hint must not acquire a token row lock');
        if (locked && options.tokenDisappears) return { rows: [] };
        if (locked && expired) return { rows: [] };
        // A SELECT predicate can pass before a token-lock wait. Model expiry
        // during that wait AFTER selection, requiring a fresh atomic claim.
        if (locked && options.expiry === 'after-token-wait') expired = true;
        return { rows: [{ token: 'qa-owned-token', usuario_id: 7,
          tarea_id: locked && options.changedTask ? 11 : options.action === 'enviar_mensaje_empleado' ? null : 10, conversacion_id: 1,
          accion: locked && options.changedAction ? 'enviar_mensaje_empleado' : options.action ?? 'registrar_produccion',
          payload: options.action === 'enviar_mensaje_empleado'
            ? { target_user_id: 8, message: 'QA explicitly confirmed message' } : { cantidad: 2, fecha: '2026-10-20' } }] };
      }
      if (sql.includes('FROM tareas') && sql.includes('FOR UPDATE')) {
        if (options.expiry === 'after-task-wait') expired = true;
        assert.deepEqual(params, [10]); return { rows: [structuredClone(stored.task)] };
      }
      if (sql.includes('FROM tareas t') && sql.includes('tarea_asignaciones')) {
        assert.deepEqual(params, [10, 7]);
        assert.match(sql, /workspace.*render_os/); assert.match(sql, /ta\.usuario_id = \$2::integer/);
        return { rows: options.membership === false || stored.task.propiedades_extra.workspace !== 'render_os' ? [] : [{ id: 10 }] };
      }
      if (sql.includes('FROM produccion_visitas')) {
        if (options.expiry === 'after-mixed-guard') expired = true;
        assert.deepEqual(params, [10]); return { rows: [] };
      }
      if (sql.startsWith('UPDATE tareas')) {
        assert.ok(transaction); assert.equal(params[0], 10);
        assert.equal(transaction.tokenUsed, true, 'Production write follows a successful atomic claim');
        if (options.writeFails) throw writeFailure;
        transaction.task.propiedades_extra = { ...transaction.task.propiedades_extra, ...JSON.parse(params[1]) };
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE wilson_acciones_pendientes')) {
        assert.deepEqual(params, ['qa-owned-token', 7]);
        assert.match(sql, /SET confirmed_at\s*=\s*clock_timestamp\(\)/i);
        assert.match(sql, /token\s*=\s*\$1/); assert.match(sql, /usuario_id\s*=\s*\$2/);
        assert.match(sql, /confirmed_at IS NULL/); assert.match(sql, /expires_at\s*>\s*clock_timestamp\(\)/i);
        assert.match(sql, /RETURNING\s+1\s+AS\s+claimed/i);
        assert.doesNotMatch(sql, /\bNOW\(\)|RETURNING\s+token/i);
        assert.ok(transaction); assert.equal(transaction.tokenUsed, false, 'Exactly one atomic claim per intent');
        if (expired || options.expiryFalse) return { rows: [], rowCount: 0 };
        transaction.tokenUsed = true; return { rows: [{ claimed: 1 }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO integracion_auditoria')) {
        assert.equal(transaction.tokenUsed, true);
        transaction.audits.push(structuredClone(params)); return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO wilson_conversaciones')) {
        assert.equal(transaction.tokenUsed, true, 'Message conversation write follows a successful atomic claim');
        assert.equal(params[0], 8); transaction.conversations.push(structuredClone(params));
        return { rows: [{ id: 2, usuario_id: 8, periodo: params[1] }] };
      }
      if (sql.startsWith('INSERT INTO wilson_mensajes')) {
        assert.equal(transaction.tokenUsed, true);
        transaction.messages.push(structuredClone(params)); return { rows: [{ id: 1 }] };
      }
      assert.fail(`Unexpected SQL in bounded production authority fixture: ${sql}`);
    },
  };
  const request = { params: { token: 'qa-owned-token' }, auth };
  const pool = { async connect() {
    calls.push({ sql: 'LEASE', params: [] });
    if (options.mutateAuthAtLease) {
      Object.assign(auth, { id: 99, rol: 'admin', session_version: 99, nombre: 'Untrusted replacement' });
      request.params.token = 'foreign-replacement-token';
    }
    return client;
  } };
  const router = createWilsonChatRouter({ express, pool });
  const layer = router.stack.find(entry => entry.route?.path === '/confirmaciones/:token' && entry.route.methods.post);
  assert.ok(layer, 'Actual production confirmation callback is registered');
  const handler = layer.route.stack[0].handle;
  const errors = [], response = { statusCode: 200,
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, releases, errors, response, initial, writeFailure, rollbackFailure,
    get stored() { return stored; },
    async run() {
      await handler(request, response, error => errors.push(error));
    },
  };
}

function assertNoMutation(f) {
  assert.deepEqual(f.stored, f.initial, 'No task, token, audit or message can commit on denial');
  assert.equal(f.calls.some(({ sql }) => /^(UPDATE|INSERT INTO|DELETE)/.test(sql)), false, 'Authority denial precedes every DML');
  assert.equal(f.calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.ok(f.calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(f.releases.length, 1);
}
function status(f) { return f.errors[0]?.status ?? f.response.statusCode; }

function assertExpiredNoDomainMutation(f) {
  assert.equal(status(f), 409); assert.deepEqual(f.errors, []);
  assert.deepEqual(f.stored, f.initial, 'Expired claim cannot commit domain rows or consume token');
  const domainWrites = f.calls.filter(({ sql }) => /^(UPDATE|INSERT INTO|DELETE)/.test(sql)
    && !sql.startsWith('UPDATE wilson_acciones_pendientes'));
  assert.deepEqual(domainWrites, [], 'A zero-row conditional claim is allowed; no domain DML is allowed');
  assert.equal(f.calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.ok(f.calls.some(({ sql }) => sql === 'ROLLBACK')); assert.deepEqual(f.releases, [undefined]);
}

for (const [name, options, claims] of [
  ['production expires during task-lock wait', { expiry: 'after-task-wait' }, 0],
  ['production expires during token-lock wait', { expiry: 'after-token-wait' }, 1],
  ['production expires after fresh ACL and mixed-registry guard', { expiry: 'after-mixed-guard' }, 1],
  ['message expires during token-lock wait', { action: 'enviar_mensaje_empleado', requestRole: 'admin', expiry: 'after-token-wait' }, 1],
  ['message expires after target read before conversation write', { action: 'enviar_mensaje_empleado', requestRole: 'admin', expiry: 'before-message-claim' }, 1],
  ['otherwise valid production atomic claim returns no rows', { expiryFalse: true }, 1],
]) test(`fresh TTL gate: ${name}`, async () => {
  const f = fixture(options); await f.run(); assertExpiredNoDomainMutation(f);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes')).length, claims);
});

test('legacy production authority exports are the existing canonical helpers', () => {
  for (const name of ['captureLegacyProductionActor', 'retainLegacyProductionActor', 'assertLegacyProductionTaskAccess'])
    assert.equal(typeof authority[name], 'function', name);
});

for (const [name, options] of [
  ['withdrawn ID membership', { membership: false }],
  ['task moved out of render_os', { workspace: 'private' }],
]) test(`web production confirmation rejects ${name} without consuming the owned token`, async () => {
  const f = fixture(options); await f.run();
  assert.equal(status(f), 404); assertNoMutation(f);
  const lock = f.calls.findIndex(({ sql }) => sql.includes('FROM tareas') && sql.includes('FOR UPDATE'));
  const acl = f.calls.findIndex(({ sql }) => sql.includes('tarea_asignaciones'));
  assert.ok(lock >= 0 && acl > lock, 'Fresh ID/workspace access is checked after the task lock');
  assert.equal(f.calls.some(({ sql }) => sql.includes('FROM produccion_visitas')), false);
});

for (const [name, options] of [
  ['inactive actor', { actor: { activo: false } }],
  ['revoked epoch', { actor: { session_version: 3 } }],
  ['changed current role', { actor: { rol: 'edicion' } }],
  ['deleted actor', { missingActor: true }],
]) test(`web production confirmation rejects ${name} before locking the task`, async () => {
  const f = fixture(options); await f.run();
  assert.equal(status(f), 401); assertNoMutation(f);
  assert.equal(f.calls.some(({ sql }) => sql.includes('FROM wilson_acciones_pendientes')), false,
    'Actor revocation rejects before the pending-token domain lock');
  assert.equal(f.calls.some(({ sql }) => sql.includes('FROM tareas')), false);
});

test('unknown pending action never falls through to production recording', async () => {
  const f = fixture({ action: 'unknown_synthetic_action' }); await f.run();
  assert.equal(status(f), 409); assertNoMutation(f);
  assert.equal(f.calls.some(({ sql }) => sql.includes('FROM tareas')), false);
});

for (const [name, options] of [
  ['action changed after hint', { changedAction: true }],
  ['task ID changed after hint', { changedTask: true }],
  ['token consumed/deleted after hint', { tokenDisappears: true }],
]) test(`pending token revalidation rejects ${name} without writes`, async () => {
  const f = fixture(options); await f.run();
  assert.equal(status(f), 409); assertNoMutation(f);
  const hint = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && !sql.includes('FOR UPDATE'));
  const taskLock = f.calls.findIndex(({ sql }) => sql.includes('FROM tareas') && sql.includes('FOR UPDATE'));
  const tokenLock = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && sql.includes('FOR UPDATE'));
  assert.ok(hint >= 0 && taskLock > hint && tokenLock > taskLock, 'Hint is read unlocked; task locks before token revalidation');
});

test('authorized current member commits one legacy recording with actor retention before task lock and ACL after it', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.errors, []); assert.equal(f.response.statusCode, 200);
  assert.equal(f.response.body.task_id, 10); assert.equal(f.stored.tokenUsed, true);
  const records = f.stored.task.propiedades_extra.produccion_registros;
  assert.equal(records.length, 1); assert.equal(records[0].cantidad, 2);
  assert.equal(records[0].fecha, '2026-10-20'); assert.equal(records[0].usuario, 'Verified QA actor');
  assert.equal(f.stored.task.estado, 'pendiente');
  assert.equal(f.stored.audits.length, 1); assert.equal(f.stored.messages.length, 1);
  assert.equal(f.stored.audits[0][0], '7'); assert.equal(f.stored.audits[0][1], 'Verified QA actor');
  const begin = f.calls.findIndex(({ sql }) => sql.startsWith('BEGIN'));
  const actor = f.calls.findIndex(({ sql }) => sql.includes('FROM usuarios') && sql.includes('FOR SHARE'));
  const hint = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && !sql.includes('FOR UPDATE'));
  const token = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && sql.includes('FOR UPDATE'));
  const lock = f.calls.findIndex(({ sql }) => sql.includes('FROM tareas') && sql.includes('FOR UPDATE'));
  const acl = f.calls.findIndex(({ sql }) => sql.includes('tarea_asignaciones'));
  const update = f.calls.findIndex(({ sql }) => sql.startsWith('UPDATE tareas'));
  const claim = f.calls.findIndex(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes'));
  const mixed = f.calls.findIndex(({ sql }) => sql.includes('FROM produccion_visitas'));
  assert.ok(begin >= 0 && actor > begin && hint > actor && lock > hint && token > lock && acl > lock && update > token && update > acl,
    'BEGIN -> retained actor -> unlocked hint -> task lock -> token lock; fresh ACL after task lock and before write');
  assert.ok(claim > acl && claim > mixed && claim > token && update === claim + 1,
    'Successful claim follows authority/mixed guards and immediately precedes first production write');
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes')).length, 1);
  assert.equal(f.calls.filter(({ sql }) => sql === 'COMMIT').length, 1);
  assert.deepEqual(f.releases, [undefined]);
});

test('actor ID, epoch and token are captured before waiting for the pool lease', async () => {
  const f = fixture({ mutateAuthAtLease: true }); await f.run();
  assert.deepEqual(f.errors, []); assert.equal(f.response.statusCode, 200);
  assert.equal(f.stored.tokenUsed, true);
  assert.equal(f.stored.task.propiedades_extra.produccion_registros[0].usuario, 'Verified QA actor');
  assert.equal(f.stored.audits[0][0], '7');
});

test('retained current admin confirms employee message without any production task query or lock', async () => {
  const f = fixture({ action: 'enviar_mensaje_empleado', requestRole: 'admin' }); await f.run();
  assert.deepEqual(f.errors, []); assert.equal(f.response.statusCode, 200);
  assert.equal(f.response.body.target_user_id, 8); assert.equal(f.stored.tokenUsed, true);
  assert.deepEqual(f.stored.task, f.initial.task);
  assert.equal(f.stored.conversations.length, 1); assert.equal(f.stored.messages.length, 2);
  const [conversationId, sender, content, type, metadata] = f.stored.messages[0];
  assert.deepEqual([conversationId, sender, content, type], [2, 'wilson', 'QA explicitly confirmed message', 'mensaje_lider']);
  assert.deepEqual(JSON.parse(metadata), { ordered_by: 7, ordered_by_name: 'Verified QA actor' });
  assert.equal(f.stored.audits.length, 1);
  assert.deepEqual(f.stored.audits[0].slice(0, 2), ['7', 'Verified QA actor']);
  assert.equal(f.calls.some(({ sql }) => /\b(tareas|tarea_asignaciones|produccion_visitas)\b/.test(sql)), false);
  const actor = f.calls.findIndex(({ sql }) => sql.includes('FROM usuarios') && sql.includes('FOR SHARE'));
  const hint = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && !sql.includes('FOR UPDATE'));
  const token = f.calls.findIndex(({ sql }) => sql.includes('FROM wilson_acciones_pendientes') && sql.includes('FOR UPDATE'));
  assert.ok(actor >= 0 && hint > actor && token > hint);
  const target = f.calls.findIndex(({ sql }) => sql === 'SELECT id,nombre FROM usuarios WHERE id=$1');
  const claim = f.calls.findIndex(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes'));
  const conversation = f.calls.findIndex(({ sql }) => sql.startsWith('INSERT INTO wilson_conversaciones'));
  assert.ok(target > token && claim > target && conversation === claim + 1,
    'Message claim follows target read and immediately precedes conversation mutation');
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes')).length, 1);
  assert.equal(f.calls.filter(({ sql }) => sql === 'COMMIT').length, 1);
  assert.deepEqual(f.releases, [undefined]);
});

test('failed recording rolls back task/token/audit/message without claiming success', async () => {
  const f = fixture({ writeFails: true }); await f.run();
  assert.equal(f.errors[0], f.writeFailure); assert.deepEqual(f.stored, f.initial);
  assert.equal(f.response.body, undefined); assert.ok(f.calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(f.calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.deepEqual(f.releases, [undefined]);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith('UPDATE wilson_acciones_pendientes')).length, 1,
    'Claim succeeded in the transaction but write failure must roll it back');
});

test('rollback failure discards the leased connection while preserving the original recording error', async () => {
  const f = fixture({ writeFails: true, rollbackFails: true }); await f.run();
  assert.equal(f.errors[0], f.writeFailure); assert.deepEqual(f.stored, f.initial);
  assert.equal(f.response.body, undefined); assert.equal(f.calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.deepEqual(f.releases, [f.rollbackFailure]);
});
