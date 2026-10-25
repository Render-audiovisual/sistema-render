import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWilsonChatRouter } from '../src/wilson-chat.js';
import { acceptSupervisorDeadline, recordSupervisorReply } from '../src/mia-supervisor.js';
import { proposalSnapshot } from '../src/mia-supervisor-policy.js';

const now = new Date('2026-10-19T13:00:00Z');
const env = { MIA_SUPERVISOR_ENABLED: 'true' };
const actor = { privateChat: true, userId: 7, actorId: 'qa-number' };
const user = { id: 7, nombre: 'Editor', usuario: 'editor', rol: 'produccion', activo: true, session_version: 1 };
const task = { id: 10, titulo: 'Visita QA', tipo_tarea: 'produccion', estado: 'pendiente',
  fecha_vencimiento: '2026-10-19', asignado_a_id: 7, colaborador_ids: [],
  propiedades_extra: { workspace: 'render_os' } };
const proposalId = '11111111-1111-4111-8111-111111111111';

function mockDb({ linkedDate = null, mixed = false, owner = 7, selectedDate = '2026-10-20' } = {}) {
  const calls = [];
  let stored = { taskWrites: 0, conversationWrites: 0, tokenUsed: false, proposalAccepted: false }, pending;
  const db = {
    calls,
    async connect() { return db; }, release() { calls.push({ sql: 'RELEASE' }); },
    get stored() { return stored; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') { pending = structuredClone(stored); return { rows: [] }; }
      if (sql === 'ROLLBACK') { pending = undefined; return { rows: [] }; }
      if (sql === 'COMMIT') { stored = pending; pending = undefined; return { rows: [] }; }
      if (sql.includes('FROM wilson_acciones_pendientes')) return { rows: [{ token: 'qa', tarea_id: 10,
        conversacion_id: 1, accion: 'registrar_produccion', payload: { cantidad: 2, fecha: '2026-10-19' } }] };
      if (sql.includes('FROM usuarios WHERE id=$1')) return { rows: [user] };
      if (sql.includes('FROM mia_supervisor_replies WHERE actor_hash=')) return { rows: [] };
      if (sql.includes('FROM tareas t WHERE t.id=$1') && sql.includes('tarea_asignaciones')) {
        assert.deepEqual(params, [10, 7]);
        return { rows: owner === 7 ? [{ id: 10 }] : [] };
      }
      if (sql.includes('FROM tareas')) return { rows: [task] };
      if (sql.includes('FROM tarea_asignaciones')) return { rows: [{ tarea_id: 10, usuario_id: owner, tipo: 'responsable' }] };
      if (sql.includes('FROM mia_supervisor_proposals WHERE id=')) return { rows: [{ id: proposalId,
        fecha: selectedDate, snapshot_hash: proposalSnapshot(task) }] };
      if (sql.includes('FROM mia_supervisor_conversations')) return { rows: [] };
      if (sql.includes('FROM produccion_visitas')) return { rows: sql.includes('WHERE v.tarea_origen_id=$1 LIMIT 1')
        ? (mixed || linkedDate ? [{ id: 'registry' }] : []) : (linkedDate ? [{ id: 'registry', fecha: linkedDate }] : []) };
      if (sql.startsWith('UPDATE tareas')) pending.taskWrites++;
      if (sql.startsWith('INSERT INTO mia_supervisor_conversations')) pending.conversationWrites++;
      if (sql.startsWith('UPDATE mia_supervisor_proposals')) pending.proposalAccepted = true;
      if (sql.startsWith('UPDATE wilson_acciones_pendientes')) pending.tokenUsed = true;
      return { rows: [] };
    },
  };
  return db;
}

async function confirmChat(db) {
  const router = createWilsonChatRouter({ express, pool: db });
  const handler = router.stack.find(layer => layer.route?.path === '/confirmaciones/:token').route.stack[0].handle;
  const errors = [];
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { token: 'qa' }, auth: user }, res, error => errors.push(error));
  return { res, errors };
}

test('chat rejects normalized video/photo registry after source lock and rolls back token/work', async () => {
  const db = mockDb({ mixed: true });
  const { errors } = await confirmChat(db);
  assert.equal(errors[0]?.status, 409);
  const lock = db.calls.findIndex(call => call.sql.includes('FROM tareas') && call.sql.includes('FOR UPDATE'));
  const guard = db.calls.findIndex(call => call.sql.includes('FROM produccion_visitas'));
  assert.ok(lock >= 0 && guard > lock);
  assert.deepEqual(db.calls[guard].params, [10]);
  assert.match(db.calls[guard].sql, /v.tarea_origen_id=\$1/);
  assert.doesNotMatch(db.calls[guard].sql, /produccion_videos|produccion_fotos/);
  assert.equal(db.calls.some(call => call.sql.startsWith('UPDATE tareas')), false);
  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(db.stored.tokenUsed, false);
  assert.equal(db.stored.taskWrites, 0);
});

test('chat preserves legacy registration transaction when no normalized items exist', async () => {
  const db = mockDb();
  assert.deepEqual((await confirmChat(db)).errors, []);
  assert.equal(db.stored.taskWrites, 1);
  assert.equal(db.stored.tokenUsed, true);
  assert.ok(db.calls.some(call => call.sql === 'COMMIT'));
});

const accept = (db, date) => acceptSupervisorDeadline(db, { actor, taskId: 10, proposalId,
  date, messageId: 'accept', now, env });
const report = (db, date = '2026-10-20') => recordSupervisorReply(db, { actor, taskId: 10,
  messageId: 'reply', now, env, input: { texto: `Estoy trabajando porque falta material. Entrego ${date}.`,
    estado: 'en_progreso', motivo: 'falta material', nueva_fecha: date, fecha_texto: date } });

for (const [name, run] of [['deadline acceptance', accept], ['follow-up report', report]]) {
  test(`supervisor ${name} rejects linked source date divergence in same transaction`, async () => {
    const db = mockDb({ linkedDate: '2026-10-19' });
    await assert.rejects(run(db), { status: 409 });
    const lock = db.calls.findIndex(call => call.sql.includes('FROM tareas t') && call.sql.includes('FOR UPDATE'));
    const guard = db.calls.findIndex(call => call.sql.includes('FROM produccion_visitas'));
    assert.ok(lock >= 0 && guard > lock);
    assert.match(db.calls[guard].sql, /FOR UPDATE/);
    assert.deepEqual(db.calls[guard].params, [10]);
    assert.equal(db.calls.some(call => call.sql.startsWith('UPDATE tareas')), false);
    assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(db.stored.taskWrites, 0);
    assert.equal(db.stored.conversationWrites, 0);
    assert.equal(db.stored.proposalAccepted, false);
  });

  test(`supervisor ${name} retains permission checks before registry access`, async () => {
    const db = mockDb({ owner: 8 });
    await assert.rejects(run(db), { status: 403 });
    assert.equal(db.calls.some(call => call.sql.includes('FROM produccion_visitas')), false);
  });

  test(`supervisor ${name} preserves unlinked legacy task flow without backfill`, async () => {
    const db = mockDb();
    await run(db);
    assert.equal(db.stored.taskWrites, 1);
    assert.ok(db.calls.some(call => call.sql === 'COMMIT'));
    assert.equal(db.calls.some(call => /^(INSERT INTO|UPDATE) produccion_visitas/.test(call.sql)), false);
  });
}

test('linked source allows keeping registry date without changing its authority', async () => {
  for (const run of [accept, report]) {
    const db = mockDb({ linkedDate: '2026-10-19', selectedDate: '2026-10-19' });
    await run(db, '2026-10-19');
    assert.equal(db.stored.taskWrites, 1);
    assert.ok(db.calls.some(call => call.sql === 'COMMIT'));
  }
});

test('ordinary follow-up without a date change does not query or mutate the registry', async () => {
  const db = mockDb({ linkedDate: '2026-10-19' });
  const result = await recordSupervisorReply(db, { actor, taskId: 10, messageId: 'progress-only', now, env,
    input: { texto: 'Estoy trabajando porque falta material.', estado: 'en_progreso', motivo: 'falta material' } });
  assert.equal(result.recorded, true);
  assert.equal(db.calls.some(call => call.sql.includes('FROM produccion_visitas')), false);
  assert.equal(db.stored.taskWrites, 1);
});

test('registry lookup failure rolls back follow-up conversation and never saves the new date', async () => {
  const db = mockDb();
  const query = db.query.bind(db);
  const failure = new Error('registry unavailable');
  db.query = async (sql, params) => {
    if (sql.includes('FROM produccion_visitas')) throw failure;
    return query(sql, params);
  };
  await assert.rejects(report(db), error => error === failure);
  assert.equal(db.stored.taskWrites, 0);
  assert.equal(db.stored.conversationWrites, 0);
  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
});
