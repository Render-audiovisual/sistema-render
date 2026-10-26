import test from 'node:test';
import assert from 'node:assert/strict';
import { createWilsonEditingProgressAuditRouter } from '../src/wilson-editing-progress-audit.js';
import { EDITING_PROGRESS_SCHEMA } from '../src/editing-progress-ledger.js';

function harness(options = {}) {
  const calls = [], routes = new Map();
  let released = false, discard;
  const db = { release(error) { released = true; discard = error; }, async query(sql, params = []) {
    calls.push({ sql, params });
    const fault = options.fault?.(sql); if (fault) throw fault;
    if (sql.includes('FROM usuarios')) return { rows: options.actors ?? [{ id: 4, rol: 'admin', activo: true }] };
    if (sql.includes('FROM pg_constraint')) return { rows: [options.schema === 0 ? {} : {
      columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name, [type, notNull]]) => ({ name, type, notNull })),
      constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => ({ name, definition, validated: true, deferred: false })),
    }] };
    return { rows: [] };
  } };
  createWilsonEditingProgressAuditRouter({ express: { Router: () => ({ get(path, fn) { routes.set(path, fn); } }) },
    pool: { async connect() { options.onConnect?.(); return db; } } });
  return { calls, released: () => released, discard: () => discard, async run(extra = {}) {
    let status = 200, body, error;
    const headers = {};
    const req = { query: { periodo: '2026-10', editor_id: '9' }, wilson: { privateChat: true, systemActor: false,
      userId: 4, channel: 'whatsapp', actorId: 'synthetic-transport-id', actorRole: 'admin' }, ...extra };
    await routes.get('/auditoria-edicion')(req, { set(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, json(v) { body = v; } }, e => { error = e; });
    return { status, body, error, headers };
  } };
}

test('registered callback reads RR, revalidates binding/admin and commits a no-store DTO', async () => {
  const h = harness(), result = await h.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.contrato, 'editing-progress-v1');
  assert.equal(result.body.alcance.editor_id, 9);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(h.calls[1].sql, /i.enabled IS TRUE/);
  assert.match(h.calls[1].params[0], /^[a-f0-9]{64}$/);
  assert.equal(h.calls.at(-1).sql, 'COMMIT');
  assert.equal(h.released(), true);
  assert.doesNotMatch(h.calls.map(c => c.sql).join('\n'), /UPDATE|INSERT|DELETE|entregas_edicion\b/);
});

test('group, system actor, missing human ID and unbound telegram fail before leasing', async () => {
  for (const change of [{ privateChat: false }, { systemActor: true }, { userId: null }, { channel: 'telegram' }, { channel: 'unknown' }]) {
    const h = harness();
    const result = await h.run({ wilson: { privateChat: true, userId: 4, channel: 'whatsapp', actorId: 'synthetic', ...change } });
    assert.equal(result.status, 403);
    assert.equal(h.calls.length, 0);
  }
});

test('fresh identity must be unique, active, same ID, admin; old leader label grants nothing', async () => {
  for (const actors of [[], [{ id: 4, rol: 'lider', activo: true }], [{ id: 4, rol: 'admin', activo: false }],
    [{ id: 9, rol: 'admin', activo: true }], [{ id: 4, rol: 'admin', activo: true }, { id: 9, rol: 'admin', activo: true }]]) {
    const h = harness({ actors }), result = await h.run();
    assert.equal(result.status, 403);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(h.calls.some(c => c.sql.includes('pg_constraint')), false);
    assert.equal(h.released(), true);
  }
});

test('invalid/repeated query rejected before read; scope is explicitly WhatsApp only', async () => {
  const invalid = harness();
  assert.equal((await invalid.run({ query: { periodo: ['2026-10'] } })).status, 400);
  assert.equal(invalid.calls.length, 0);
  const h = harness();
  const result = await h.run({ wilson: { privateChat: true, userId: 4, channel: 'telegram', actorId: 'synthetic' } });
  assert.equal(result.status, 403);
  assert.equal(h.calls.length, 0);
});

test('captured query and identity cannot be changed during connection lease', async () => {
  const query = { periodo: '2026-10', editor_id: '9' }, wilson = { privateChat: true, userId: 4, channel: 'whatsapp', actorId: 'synthetic' };
  const h = harness({ onConnect() { query.editor_id = '10'; wilson.userId = 9; wilson.actorId = 'changed'; } });
  const result = await h.run({ query, wilson });
  assert.equal(result.status, 200);
  assert.equal(result.body.alcance.editor_id, 9);
});

test('missing schema is 503, not zero; unexpected failure goes to next and rollback failure discards client', async () => {
  const missing = harness({ schema: 0 });
  const result = await missing.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.total_operativo, undefined);
  const rollbackError = new Error('rollback failed'), original = new Error('read failed');
  const h = harness({ fault: sql => sql === 'ROLLBACK' ? rollbackError : sql.includes('pg_constraint') ? original : null });
  assert.equal((await h.run()).error, original);
  assert.equal(h.discard(), rollbackError);
});
