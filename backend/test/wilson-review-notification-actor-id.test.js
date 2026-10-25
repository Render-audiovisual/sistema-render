import test from 'node:test';
import assert from 'node:assert/strict';
import { createWilsonRouter } from '../src/wilson-integration.js';

// Execute the real registered review-confirmation callback, not a copied
// implementation. Only persistence and the notification sink are injected;
// no authentication middleware, PostgreSQL, listener or provider is exercised.
function fixture({ failure, changed = false, missingConfirmation = false } = {}) {
  const calls = [], notifications = [], errors = [];
  const tasks = [
    { id: 101, titulo: 'QA editing review', tipo_tarea: 'edicion', subtipo: 'video' },
    { id: 102, titulo: 'QA carrusel review', tipo_tarea: 'diseno', subtipo: 'carrusel' },
  ].map(row => ({ ...row, estado: 'en_progreso', asignado_a: 'QA assigned editor',
    material_referencia: 'https://example.invalid/qa-review', cliente_id: 1,
    updated_at: '2026-10-25T12:00:00.000Z', propiedades_extra: { workspace: 'render_os' } }));
  const snapshots = tasks.map(({ id, titulo, asignado_a, estado, updated_at }) => ({ id, titulo, asignado_a, estado, updated_at }));
  let stored = { states: tasks.map(row => row.estado), tokenUsed: false, audits: 0 };
  let pending, released = false;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN') { pending = structuredClone(stored); return { rows: [] }; }
      if (sql === 'ROLLBACK') { pending = undefined; return { rows: [] }; }
      if (sql === 'COMMIT') {
        if (failure === 'commit') throw new Error('Synthetic commit failure');
        stored = pending; pending = undefined; return { rows: [] };
      }
      if (sql.includes('FROM integracion_confirmaciones')) {
        assert.deepEqual(params, ['qa-review-token', 'qa-private-group']);
        return { rows: missingConfirmation ? [] : [{ token: 'qa-review-token',
          informante_actor_id: 'qa-external-actor', informante_actor_nombre: 'QA original reporter',
          payload: { tasks: snapshots } }] };
      }
      if (sql.includes('FROM tareas WHERE id=ANY')) {
        assert.deepEqual(params, [[101, 102]]);
        return { rows: tasks.map(row => ({ ...row, ...(changed && row.id === 101
          ? { updated_at: '2026-10-25T13:00:00.000Z' } : {}) })) };
      }
      if (sql.includes('SELECT tarea_id, usuario_id, tipo')) {
        assert.deepEqual(params, [[101, 102]]);
        return { rows: tasks.map(row => ({ tarea_id: row.id, usuario_id: 11, tipo: 'responsable' })) };
      }
      if (sql.startsWith("UPDATE tareas SET estado='en_revision'")) {
        if (failure === 'update') throw new Error('Synthetic update failure');
        assert.deepEqual(params[0], [101, 102]);
        pending.states = ['en_revision', 'en_revision']; return { rows: [] };
      }
      if (sql.includes('UPDATE integracion_confirmaciones')) {
        assert.deepEqual(params, ['qa-review-token']); pending.tokenUsed = true; return { rows: [] };
      }
      if (sql.includes('INSERT INTO integracion_auditoria')) {
        if (failure === 'audit') throw new Error('Synthetic audit failure');
        pending.audits++; return { rows: [] };
      }
      assert.fail('Unexpected query in bounded review callback fixture');
    },
    release() { released = true; calls.push({ sql: 'RELEASE' }); },
  };
  const pool = { async connect() { return client; } };
  const router = createWilsonRouter({ pool, env: { NODE_ENV: 'test' },
    notifyAssignment(options) {
      assert.equal(pending, undefined, 'Notify only after transaction completion');
      assert.deepEqual(stored, { states: ['en_revision', 'en_revision'], tokenUsed: true, audits: 2 });
      assert.equal(calls.at(-1).sql, 'COMMIT', 'No notification before successful commit');
      notifications.push(options);
    },
  });
  const route = router.stack.find(layer => layer.route?.path === '/lotes/revision/confirmar' && layer.route.methods.post);
  assert.ok(route, 'Actual review-confirmation route remains registered');
  return { calls, notifications, errors, pool, tasks,
    get stored() { return stored; }, get released() { return released; },
    async run({ actorName = 'QA renamed actor', userId = 11 } = {}) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
      await route.route.stack[0].handle({ body: { confirmacion_token: 'qa-review-token' },
        wilson: { channel: 'whatsapp', actorId: 'qa-external-actor', actorName,
          userId, actorRole: 'edicion', groupId: 'qa-private-group' } }, res, error => errors.push(error));
      return res;
    },
  };
}

for (const actorName of ['QA renamed actor', 'Franco']) {
  test(`actual Wilson review callback retains verified actor ID and existing recipients (${actorName})`, async () => {
    const f = fixture(), res = await f.run({ actorName });
    assert.equal(res.statusCode, 200); assert.equal(res.body.updated, true);
    assert.deepEqual(res.body.task_ids, [101, 102]); assert.deepEqual(f.errors, []);
    assert.equal(f.notifications.length, 2);
    for (const [index, notification] of f.notifications.entries()) {
      assert.equal(notification.pool, f.pool);
      assert.equal(notification.actorId, 11, 'Use verified numeric userId, never external actorId or display name');
      assert.equal(notification.actor, actorName);
      assert.equal(notification.motivo, 'revision');
      assert.deepEqual(notification.nombresDestinatarios, index === 0
        ? ['Agustín', 'Franco'] : ['Oriana', 'Agustín', 'Franco']);
      assert.deepEqual(notification.tarea, { ...f.tasks[index], estado: 'en_revision', asignado_a_id: 11, colaborador_ids: [] });
      assert.equal(Object.hasOwn(notification, 'destinatarioIds'), false, 'No recipient-policy migration in actor-ID plumbing');
    }
    assert.equal(f.released, true);
    assert.deepEqual(f.calls.filter(({ sql }) => ['BEGIN', 'COMMIT', 'ROLLBACK', 'RELEASE'].includes(sql)).map(({ sql }) => sql),
      ['BEGIN', 'COMMIT', 'RELEASE']);
  });
}

for (const failure of ['update', 'audit', 'commit']) {
  test(`review ${failure} failure rolls back and never notifies`, async () => {
    const f = fixture({ failure }); await f.run();
    assert.equal(f.errors.length, 1); assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.stored, { states: ['en_progreso', 'en_progreso'], tokenUsed: false, audits: 0 });
    assert.deepEqual(f.calls.slice(-2).map(({ sql }) => sql), ['ROLLBACK', 'RELEASE']);
    assert.equal(f.released, true);
  });
}

for (const options of [{ missingConfirmation: true }, { changed: true }]) {
  test(`review confirmation rejection never notifies (${options.changed ? 'changed snapshot' : 'missing token'})`, async () => {
    const f = fixture(options), res = await f.run();
    assert.equal(res.statusCode, 409); assert.deepEqual(f.errors, []); assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.stored.states, ['en_progreso', 'en_progreso']);
    assert.equal(f.calls.some(({ sql }) => sql.startsWith("UPDATE tareas SET estado='en_revision'")), false);
    assert.equal(f.released, true);
  });
}
