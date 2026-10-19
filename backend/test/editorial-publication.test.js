import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditorialPublicationRouter, editorialPieceIdentity, normalizePublicationInstant,
  normalizeEditorialPublicationInput, editorialPublicationIntentHash, editorialPublicationDto } from '../src/editorial-publication.js';

const KEY = '10000000-0000-4000-8000-000000000001';
const SECOND = '20000000-0000-4000-8000-000000000002';
const TIME = '2026-01-01T12:00:00.000Z';
const ADMIN = { id: 4, rol: 'admin', activo: true, session_version: 3 };
const input = (request_id = KEY, expected_revision = 0) => ({ request_id, expected_revision, occurred_at: TIME });

test('domain and piece identifiers are closed and int32 positive', () => {
  for (const domain of ['historia', 'publicacion']) assert.equal(editorialPieceIdentity(domain, '1').id, 1);
  for (const [domain, id] of [['historias', '1'], ['__proto__', '1'], ['historia', '0'], ['historia', '01'], ['historia', '1.0'], ['historia', '2147483648'], ['historia', 1]]) {
    assert.throws(() => editorialPieceIdentity(domain, id), { status: 400 });
  }
});

test('strict actual instant normalizes offsets to UTC milliseconds, never a local date', () => {
  const now = Date.parse('2027-01-01T00:00:00Z');
  assert.equal(normalizePublicationInstant('2026-01-01T09:00:00-03:00', now), TIME);
  assert.equal(normalizePublicationInstant('2026-01-01T12:00:00.123456Z', now), '2026-01-01T12:00:00.123Z');
  assert.equal(normalizePublicationInstant('2024-02-29T00:00:00+03:00', now), '2024-02-28T21:00:00.000Z');
  for (const value of ['2026-02-30T00:00:00Z', '0000-01-01T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00', '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z', '2026-13-01T00:00:00Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+03:60', '2028-01-01T00:00:00Z', {}, null]) {
    assert.throws(() => normalizePublicationInstant(value, now), { status: 400 });
  }
});

test('confirmation and withdrawal bodies reject reserved or unknown fields and invalid CAS', () => {
  for (const action of ['confirmar', 'retirar']) {
    const base = action === 'confirmar' ? input() : { request_id: KEY, expected_revision: 0 };
    for (const extra of [{ actor_id: 4 }, { cliente_id: 1 }, { source: 'manual' }, { metadata: {} }, { confirmado: true }]) {
      assert.throws(() => normalizeEditorialPublicationInput(action, { ...base, ...extra }), { status: 400 });
    }
    for (const expected_revision of [-1, '0', 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
      assert.throws(() => normalizeEditorialPublicationInput(action, { ...base, expected_revision }), { status: 400 });
    }
    assert.equal(normalizeEditorialPublicationInput(action, base).expected_revision, 0);
  }
  assert.throws(() => normalizeEditorialPublicationInput('retirar', input()), { status: 400 });
  assert.throws(() => normalizeEditorialPublicationInput('confirmar', { request_id: KEY, expected_revision: 0 }), { status: 400 });
  assert.throws(() => normalizeEditorialPublicationInput('confirmar', { ...input(), request_id: {} }), { status: 400 });
});

test('intent binds domain, piece, action, normalized instant and observed revision, not key', () => {
  const a = normalizeEditorialPublicationInput('confirmar', input());
  const b = normalizeEditorialPublicationInput('confirmar', { ...input(SECOND), occurred_at: '2026-01-01T09:00:00-03:00' });
  const hash = editorialPublicationIntentHash('historia', 1, 'confirmar', a);
  assert.equal(hash, editorialPublicationIntentHash('historia', 1, 'confirmar', b));
  for (const args of [['publicacion', 1, 'confirmar', a], ['historia', 2, 'confirmar', a], ['historia', 1, 'retirar', a], ['historia', 1, 'confirmar', { ...a, expected_revision: 1 }]]) {
    assert.notEqual(hash, editorialPublicationIntentHash(...args));
  }
});

test('DTO proves all evidence fields and current reference, never raw private metadata', () => {
  const piece = { id: 1, dominio: 'historia', cliente_id: 7, estado: 'publicada', fecha_programada: '2025-12-01', fecha_publicacion_real: TIME, metadata: { salario: 999, secret: 'PRIVATE' } };
  const version = { revision: '2', current_event_id: KEY };
  const event = { id: KEY, dominio: 'historia', pieza_id: 1, cliente_id: 7, actor_id: 4, action: 'confirmar', source: 'manual', occurred_at: TIME, recorded_at: TIME };
  const dto = editorialPublicationDto(piece, version, event, ADMIN);
  assert.equal(dto.classification, 'confirmada_manualmente');
  assert.equal(dto.current_confirmation.source, 'manual');
  assert.equal(dto.piece.revision, 2);
  assert.equal(dto.can_confirm, false);
  assert.doesNotMatch(JSON.stringify(dto), /salario|PRIVATE|metadata/);
  for (const change of [{ dominio: 'publicacion' }, { pieza_id: 2 }, { cliente_id: 8 }, { action: 'retirar' }, { source: 'external' }, { occurred_at: '2026-01-02T12:00:00Z' }, { id: SECOND }]) {
    assert.equal(editorialPublicationDto(piece, version, { ...event, ...change }, ADMIN).current_confirmation, null);
  }
  assert.equal(editorialPublicationDto({ ...piece, estado: 'lista' }, version, event, ADMIN).current_confirmation, null);
  assert.equal(editorialPublicationDto(piece, null, event, ADMIN).classification, 'historica_sin_confirmacion');
  assert.equal(editorialPublicationDto({ ...piece, estado: 'lista', fecha_publicacion_real: null }, null, null, ADMIN).classification, 'no_publicada');
});

function harness({ domain = 'historia', user = ADMIN, hidden = false, inactiveClient = false, changedClient = false, fault = null, historical = false } = {}) {
  const routes = new Map(), calls = [];
  let released = false, snapshot;
  let state = { piece: { id: 1, cliente_id: 7, estado: historical ? 'publicada' : 'lista', fecha_programada: '2025-12-01', fecha_publicacion_real: historical ? TIME : null }, version: null, events: [] };
  const db = { release() { released = true; }, async query(sql, params = []) {
    calls.push({ sql, params });
    if (fault?.(sql)) throw Object.assign(new Error('secret driver fault'), { code: 'P0001' });
    if (sql.startsWith('BEGIN')) { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { state = snapshot; return { rows: [] }; }
    if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return { rows: [user] };
    if (sql.startsWith('SELECT cliente_id FROM')) return { rows: [{ cliente_id: 7 }] };
    if (sql.startsWith('SELECT id FROM clientes')) return { rows: inactiveClient ? [] : [{ id: 7 }] };
    if (sql.startsWith('SELECT p.id,p.cliente_id')) return { rows: hidden || inactiveClient ? [] : [{ ...state.piece, ...(changedClient ? { cliente_id: 8 } : {}) }] };
    if (sql.startsWith('SELECT revision,current_event_id')) return { rows: state.version ? [{ ...state.version }] : [] };
    if (sql.startsWith('SELECT e.id,e.dominio')) return { rows: state.events.filter(e => e.id === params[0]) };
    if (sql.startsWith('SELECT id,action,intent_hash')) return { rows: state.events.filter(e => e.actor_id === params[0] && e.request_id === params[1]) };
    if (sql.startsWith('SELECT id FROM editorial_publicacion_eventos')) return { rows: [...state.events].sort((a, b) => b.expected_revision - a.expected_revision).slice(0, 1) };
    if (/^UPDATE (historias|publicaciones) SET/.test(sql)) {
      state.piece.estado = params[1]; state.piece.fecha_publicacion_real = params[2];
      state.version = { revision: (state.version?.revision ?? 0) + 1, current_event_id: null };
    }
    if (sql.includes('INSERT INTO editorial_publicacion_eventos(')) {
      const [id, dominio, pieza_id, historia_id, publicacion_id, cliente_id, actor_id, action, request_id, intent_hash, expected_revision, occurred_at, previous_event_id] = params;
      state.events.push({ id, dominio, pieza_id, historia_id, publicacion_id, cliente_id, actor_id, action, source: 'manual', request_id, intent_hash, expected_revision, occurred_at, previous_event_id, recorded_at: TIME });
    }
    if (sql.startsWith('UPDATE editorial_publicacion_versiones SET current_event_id')) {
      state.version.current_event_id = params[2]; return { rows: [{ revision: state.version.revision }] };
    }
    return { rows: [] };
  } };
  const router = { use(fn) { routes.set('middleware', fn); } };
  for (const method of ['get', 'post']) router[method] = (path, fn) => routes.set(`${method} ${path}`, fn);
  createEditorialPublicationRouter({ express: { Router: () => router }, pool: { connect: async () => db } });
  return { calls, routes, state: () => state, released: () => released, async run(action = null, body = undefined, extra = {}) {
    let status, payload, error;
    const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
    const path = action ? `post /:dominio/:id/${action}` : 'get /:dominio/:id';
    await routes.get(path)({ params: { dominio: domain, id: '1' }, query: {}, auth: { ...user }, body, ...extra }, res, e => { error = e; });
    return { status, payload, error };
  } };
}

for (const domain of ['historia', 'publicacion']) {
  test(`${domain}: confirm, withdraw and replay return current status without duplicate evidence`, async () => {
    const h = harness({ domain });
    const confirmed = await h.run('confirmar', input());
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.payload.classification, 'confirmada_manualmente');
    assert.equal(confirmed.payload.piece.fecha_programada, '2025-12-01');
    assert.equal(confirmed.payload.changed, true);
    assert.equal(h.state().events[0].cliente_id, 7);
    const confirmId = confirmed.payload.operation.id;
    const replay = await h.run('confirmar', input());
    assert.equal(replay.status, 200);
    assert.equal(replay.payload.changed, false);
    assert.equal(replay.payload.replayed, true);
    assert.equal(replay.payload.operation.id, confirmId);
    assert.equal(h.state().events.length, 1);
    const withdrawn = await h.run('retirar', { request_id: SECOND, expected_revision: 1 });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.payload.piece.estado, 'lista');
    assert.equal(withdrawn.payload.piece.fecha_publicacion_real, null);
    assert.equal(withdrawn.payload.current_confirmation, null);
    assert.equal(h.state().events[1].previous_event_id, confirmId);
    assert.equal(h.state().events[0].occurred_at, TIME);
    const replayAfter = await h.run('confirmar', input());
    assert.equal(replayAfter.payload.classification, 'no_publicada');
    assert.equal(replayAfter.payload.current_confirmation, null);
    assert.equal(replayAfter.payload.piece.revision, 2);
    assert.equal(replayAfter.payload.operation.id, confirmId);
    assert.equal(replayAfter.payload.changed, false);
    assert.equal(h.state().events.length, 2);
    assert.equal((await h.run('retirar', { request_id: SECOND, expected_revision: 1 })).payload.replayed, true);
  });
}

test('request lock precedes client then piece then version, writes READ COMMITTED', async () => {
  const h = harness();
  assert.equal((await h.run('confirmar', input())).status, 201);
  const sql = h.calls.map(c => c.sql);
  assert.equal(sql[0], 'BEGIN ISOLATION LEVEL READ COMMITTED');
  const actor = sql.findIndex(s => s.includes('FROM usuarios'));
  const request = sql.findIndex(s => s.includes("hashtext('editorial-publicacion-request')"));
  const client = sql.findIndex(s => s.includes('FROM clientes WHERE') && s.includes('FOR SHARE'));
  const piece = sql.findIndex(s => s.includes('FOR UPDATE OF p'));
  const version = sql.findIndex(s => s.includes('FROM editorial_publicacion_versiones') && s.includes('FOR UPDATE'));
  assert.ok(actor < request && request < client && client < piece && piece < version);
  assert.match(sql[actor], /FOR SHARE$/);
  assert.equal(h.calls[request].params[0], `4:${KEY}`);
  assert.equal(h.released(), true);
});

test('read snapshots are consistent, no row locks; historical output does not manufacture proof', async () => {
  const h = harness({ historical: true });
  const read = await h.run();
  assert.equal(read.status, 200);
  assert.equal(read.payload.classification, 'historica_sin_confirmacion');
  assert.equal(read.payload.piece.revision, 0);
  assert.equal(read.payload.current_confirmation, null);
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(h.calls.some(c => /FOR SHARE|FOR UPDATE|pg_advisory/.test(c.sql)), false);
  assert.equal(h.state().events.length, 0);
});

test('supported readers do not gain confirmation permission through names or role headers', async () => {
  for (const rol of ['diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const h = harness({ user: { ...ADMIN, rol, nombre: 'Administrador' } });
    assert.equal((await h.run()).status, 200);
    assert.equal((await h.run('confirmar', input())).status, 403);
    assert.equal(h.state().events.length, 0);
  }
  const unknown = harness({ user: { ...ADMIN, rol: 'unknown' } });
  assert.equal((await unknown.run()).status, 403);
  for (const user of [{ ...ADMIN, activo: false }, { ...ADMIN, session_version: 4 }, { ...ADMIN, rol: 'edicion' }]) {
    const h = harness({ user });
    assert.equal((await h.run('confirmar', input(), { auth: ADMIN })).status, 401);
  }
});

test('CAS, absent withdrawal, duplicate confirmation and conflicting request deny without new event', async () => {
  const h = harness();
  assert.equal((await h.run('confirmar', input(KEY, 1))).status, 409);
  assert.equal((await h.run('retirar', { request_id: KEY, expected_revision: 0 })).status, 409);
  assert.equal(h.state().events.length, 0);
  assert.equal((await h.run('confirmar', input())).status, 201);
  assert.equal((await h.run('confirmar', input(KEY, 1))).status, 409);
  assert.equal((await h.run('confirmar', input(SECOND, 1))).status, 409);
  assert.equal((await h.run('confirmar', input(), { params: { dominio: 'publicacion', id: '1' } })).status, 409);
  assert.equal(h.state().events.length, 1);
});

test('inactive/hidden pieces are404, changed client409, replay still rechecks visibility and actor', async () => {
  for (const options of [{ hidden: true }, { inactiveClient: true }, { changedClient: true }]) {
    const h = harness(options);
    assert.equal((await h.run('confirmar', input())).status, options.changedClient ? 409 : 404);
    assert.equal(h.state().events.length, 0);
  }
  const user = { ...ADMIN }, h = harness({ user });
  assert.equal((await h.run('confirmar', input())).status, 201);
  user.activo = false;
  assert.equal((await h.run('confirmar', input())).status, 401);
  assert.equal(h.state().events.length, 1);
});

test('unexpected event insertion fault rolls back piece and version; same CAS/key remains reusable', async () => {
  let broken = true;
  const h = harness({ fault: sql => broken && sql.includes('INSERT INTO editorial_publicacion_eventos(') });
  const failed = await h.run('confirmar', input());
  assert.equal(failed.status, undefined);
  assert.equal(failed.error?.code, 'P0001');
  assert.equal(h.state().piece.estado, 'lista');
  assert.equal(h.state().version, null);
  assert.equal(h.state().events.length, 0);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  broken = false;
  assert.equal((await h.run('confirmar', input())).status, 201);
});

test('no-store middleware and closed query prevent unintended alternate contracts', async () => {
  const h = harness();
  let header, continued = false;
  h.routes.get('middleware')({}, { set: (...v) => { header = v; } }, () => { continued = true; });
  assert.deepEqual(header, ['Cache-Control', 'no-store']);
  assert.equal(continued, true);
  assert.equal((await h.run(null, undefined, { query: { actor_id: '4' } })).status, 400);
});

test('source only updates editorial state/actual date, orders lineage by CAS and qualifies evidence', () => {
  const source = readFileSync(new URL('../src/editorial-publication.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /UPDATE tareas|INSERT INTO tareas|UPDATE cliente_objetivo|SELECT \*/);
  assert.match(source, /ORDER BY expected_revision DESC,recorded_at DESC,id DESC/);
  assert.match(source, /e\.cliente_id=p\.cliente_id/);
  assert.match(source, /p\.fecha_publicación_real=e\.occurred_at/);
  assert.match(source, /e\.action='confirmar' AND e\.source='manual'/);
  assert.doesNotMatch(source, /SET[^`]*fecha_programada=/);
});
