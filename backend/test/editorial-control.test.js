import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDITORIAL_CONTROL_SQL, normalizeEditorialControlQuery, readEditorialControl, createEditorialControlRouter } from '../src/editorial-control.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

// Injected DB protocol and actual evidence helper, plus SQL source contracts.
// No PostgreSQL execution/HTTP/UI claims. Current schema makes schedule NOT NULL;
// injected nulls below test projection compatibility, not stored undated pieces.
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const userSql = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
const auth = { id: 7, rol: 'community', session_version: 3 };
const currentUser = { ...auth, activo: true };
const eventId = 'a1234567-1234-4123-8123-123456789abc';
const actual = '2026-10-22T12:00:00.000Z';
const row = (domain = 'historia', overrides = {}) => ({ domain, id: 1, titulo: 'Idea', estado: 'pendiente',
  tipo: domain === 'historia' ? 'historia' : 'reel', cliente_id: 3, cliente_nombre: 'Cliente', cliente_activo: true,
  fecha_programada: '2026-10-22', 'fecha_publicación_real': null, metadata: { archivado_tablero: null }, ...overrides });
const payload = (items = []) => ({ today: '2026-10-22', total: items.length,
  summary: { today: 4, overdue: 5, blocked: 3, upcoming_ready: 7 }, items });
function proof(domain) {
  return { piece_id: 1, piece_cliente_id: 3, piece_estado: 'publicada', piece_actual_at: actual,
    piece_fecha_programada: '2026-10-22', piece_archived: false, cliente_activo: true,
    revision: 2, current_event_id: eventId, event_id: eventId, event_dominio: domain,
    event_pieza_id: 1, event_cliente_id: 3, event_actor_id: 7, event_action: 'confirmar', event_source: 'manual',
    event_occurred_at: actual, event_recorded_at: actual };
}
function fake({ user = currentUser, control = payload(), evidence = {}, fail, rollbackFail = false } = {}) {
  const calls = []; let connects = 0, releases = 0;
  const db = { release() { releases++; }, async query(sql, params) {
    calls.push({ sql, params });
    if (sql === fail || (fail === 'evidence' && sql.includes('AS piece_id')) || (rollbackFail && sql === 'ROLLBACK')) throw new Error('Injected failure');
    if (sql === userSql) return { rows: user ? [user] : [] };
    if (sql === EDITORIAL_CONTROL_SQL) return { rows: control === null ? [] : [{ control }] };
    if (sql.includes('AS piece_id')) return { rows: evidence[params[0]] || [] };
    assert.ok([begin, 'COMMIT', 'ROLLBACK'].includes(sql)); return { rows: [] };
  } };
  return { calls, get releases() { return releases; }, get connects() { return connects; },
    pool: { async connect() { connects++; return db; } } };
}
function router(pool) {
  let handler;
  const instance = { get(path, callback) { assert.equal(path, '/'); assert.equal(handler, undefined); handler = callback; } };
  assert.equal(createEditorialControlRouter({ express: { Router: () => instance }, pool }), instance);
  return async (request = {}) => {
    const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
    let forwarded;
    await handler({ auth, query: {}, ...request }, res, error => { forwarded = error; });
    return { res, forwarded };
  };
}

test('closed query defaults and canonical bounds for all four independent buckets', () => {
  assert.deepEqual(normalizeEditorialControlQuery(), { bucket: 'today', offset: 0, limit: 20 });
  for (const bucket of ['today', 'overdue', 'blocked', 'upcoming_ready']) {
    assert.deepEqual(normalizeEditorialControlQuery({ bucket, offset: '1000000', limit: '50' }), { bucket, offset: 1000000, limit: 50 });
  }
  for (const query of [null, [], '', { usuario_id: '7' }, { cliente_id: '3' }, { bucket: 'all' }, { bucket: ['today'] },
    { limit: '0' }, { limit: '51' }, { limit: 20 }, { offset: '1000001' }, { offset: '-1' },
    { offset: '00' }, { offset: '1.0' }, { offset: '+1' }, { offset: '1\n' }, { offset: ['0', '20'] }, { limit: undefined }]) {
    assert.throws(() => normalizeEditorialControlQuery(query), { status: 400 });
  }
});

test('all current system roles can read team editorial data in one verified RR readonly snapshot', async () => {
  for (const rol of SYSTEM_USER_ROLES) {
    const m = fake({ user: { ...currentUser, rol } });
    const result = await readEditorialControl(m.pool, { ...auth, rol }, { bucket: 'blocked', offset: '40', limit: '10' });
    assert.equal(result.version, 1); assert.equal(result.bucket, 'blocked'); assert.equal(result.offset, 40);
    assert.deepEqual(result.summary, payload().summary); assert.equal(result.has_more, false);
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, EDITORIAL_CONTROL_SQL, 'COMMIT']);
    assert.deepEqual(m.calls[1].params, [7]); assert.deepEqual(m.calls[2].params, ['blocked', 40, 10]);
    assert.equal(m.releases, 1);
  }
});

test('unknown role is 403; invalid, mismatched or revoked sessions are 401 before editorial query', async () => {
  const unknown = fake({ user: { ...currentUser, rol: 'unknown' } });
  await assert.rejects(readEditorialControl(unknown.pool, { ...auth, rol: 'unknown' }), { status: 403 });
  for (const user of [null, { ...currentUser, activo: false }, { ...currentUser, activo: null },
    { ...currentUser, id: 8 }, { ...currentUser, session_version: 4 }, { ...currentUser, rol: 'admin' }]) {
    const m = fake({ user }); await assert.rejects(readEditorialControl(m.pool, auth), { status: 401 });
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, 'ROLLBACK']); assert.equal(m.releases, 1);
  }
  for (const invalid of [null, {}, { ...auth, id: '7' }, { ...auth, id: 0 }, { ...auth, id: 2147483648 },
    { ...auth, session_version: undefined }]) {
    const m = fake(); await assert.rejects(readEditorialControl(m.pool, invalid), { status: 401 });
    assert.deepEqual(m.calls.map(call => call.sql), [begin, 'ROLLBACK']);
  }
  const m = fake(); await assert.rejects(readEditorialControl(m.pool, auth, { role: 'admin' }), { status: 400 }); assert.equal(m.connects, 0);
});

test('actual shared evidence annotation uses same snapshot, paged IDs by domain and stable cross-domain order', async () => {
  const items = [row('historia', { estado: 'publicada', 'fecha_publicación_real': actual }),
    row('publicacion', { estado: 'publicada', 'fecha_publicación_real': actual })];
  const m = fake({ control: payload(items), evidence: { historia: [proof('historia')], publicacion: [] } });
  const result = await readEditorialControl(m.pool, auth);
  assert.deepEqual(result.items.map(item => [item.domain, item.id, item.publication_classification]), [
    ['historia', 1, 'confirmada_manualmente'], ['publicacion', 1, 'historica_sin_confirmacion'],
  ]);
  const evidenceCalls = m.calls.filter(call => call.sql.includes('AS piece_id'));
  assert.deepEqual(evidenceCalls.map(call => call.params), [['historia', [1]], ['publicacion', [1]]]);
  assert.equal(m.calls[0].sql, begin); assert.equal(m.calls.at(-1).sql, 'COMMIT');
});

test('forged metadata evidence is ignored; only the three existing classifications survive the closed DTO', async () => {
  const forged = { classification: 'confirmada_manualmente', revision: 99, confirmation: { id: eventId } };
  const items = [row('historia', { estado: 'publicada', metadata: { publicacion_evidencia: forged, finance: 999 },
    publicacion_evidencia: forged, salary: 999 }), row('publicacion', { id: 2, titulo: '<img src=x>\n' + 'a'.repeat(200) })];
  const frozen = JSON.stringify(items);
  const m = fake({ control: payload(items) }); const result = await readEditorialControl(m.pool, auth);
  assert.equal(result.items[0].publication_classification, 'historica_sin_confirmacion');
  assert.equal(result.items[1].publication_classification, 'no_publicada');
  assert.equal(result.items[1].titulo.length, 160); assert.equal(result.items[1].titulo.startsWith('<img src=x> '), true);
  assert.deepEqual(Object.keys(result.items[0]), ['domain', 'id', 'titulo', 'estado', 'tipo', 'cliente', 'fecha_programada', 'publication_classification']);
  assert.deepEqual(Object.keys(result.items[0].cliente), ['id', 'nombre']);
  assert.doesNotMatch(JSON.stringify(result), /finance|salary|confirmation|metadata|href|fecha_publicación_real/);
  assert.equal(JSON.stringify(items), frozen);
});

test('empty beyond-end pages preserve independent global summary; null dates only test DTO compatibility', async () => {
  const control = { ...payload(), total: 3 };
  const m = fake({ control }); const result = await readEditorialControl(m.pool, auth, { offset: '200' });
  assert.equal(result.total, 3); assert.equal(result.has_more, false); assert.deepEqual(result.items, []);
  assert.deepEqual(result.summary, control.summary);
  assert.equal(m.calls.filter(call => call.sql.includes('AS piece_id')).length, 0);
  const nullMapping = fake({ control: payload([row('historia', { estado: 'bloqueada', fecha_programada: null })]) });
  assert.equal((await readEditorialControl(nullMapping.pool, auth, { bucket: 'blocked' })).items[0].fecha_programada, null);
});

test('failures roll back, preserve original error and release once including failed rollback', async () => {
  for (const fail of [begin, userSql, EDITORIAL_CONTROL_SQL, 'evidence', 'COMMIT']) {
    const m = fake({ control: payload([row()]), fail, rollbackFail: true });
    await assert.rejects(readEditorialControl(m.pool, auth), /Injected/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
  for (const control of [null, {}, { ...payload(), items: null }]) {
    const m = fake({ control }); await assert.rejects(readEditorialControl(m.pool, auth)); assert.equal(m.releases, 1);
  }
});

test('router is GET-only no-store, maps expected errors and forwards unexpected failures', async () => {
  const ok = await router(fake().pool)(); assert.equal(ok.res.code, 200); assert.equal(ok.res.headers['Cache-Control'], 'no-store');
  for (const [options, request, status] of [[{}, { query: { bucket: 'bad' } }, 400],
    [{ user: null }, {}, 401], [{ user: { ...currentUser, rol: 'unknown' } }, { auth: { ...auth, rol: 'unknown' } }, 403]]) {
    const { res, forwarded } = await router(fake(options).pool)(request);
    assert.equal(res.code, status); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(res.body), ['error']); assert.equal(forwarded, undefined);
  }
  const failed = await router(fake({ fail: EDITORIAL_CONTROL_SQL }).pool)();
  assert.ok(failed.forwarded instanceof Error); assert.equal(failed.res.body, undefined);
});

const sql = EDITORIAL_CONTROL_SQL.replace(/\s+/g, ' ');
test('SQL UNION ALL preserves domain identity with shared active-client/archive visibility and closed title derivation', () => {
  assert.equal((sql.match(/UNION ALL/g) || []).length, 1);
  assert.match(sql, /'historia'::text AS domain/); assert.match(sql, /'publicacion'::text AS domain/);
  for (const table of ['historias', 'publicaciones']) assert.ok(sql.includes(`FROM ${table} p JOIN clientes c ON c.id=p.cliente_id`));
  assert.equal((sql.match(/c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'/g) || []).length, 2);
  assert.equal((sql.match(/jsonb_typeof\(p.metadata->'idea'\)='string'/g) || []).length, 2);
  assert.equal((sql.match(/jsonb_typeof\(p.metadata->'Idea'\)='string'/g) || []).length, 2);
  assert.match(sql, /left\(p.copy,160\),''\),160\) AS titulo/);
  assert.doesNotMatch(sql, /tareas|finalizada|revision_aprobada|asignado_a|publicacion_evidencia|to_json|row_to_json|\w+\.\*/);
});

test('SQL buckets overlap independently, today has all states, blocked no date condition, future has no cap', () => {
  assert.match(sql, /AT TIME ZONE 'America\/Argentina\/Cordoba'\)::date AS today/);
  assert.match(sql, /v.fecha_programada=day.today AS is_today/);
  assert.match(sql, /\(v.fecha_programada<day.today AND v.estado NOT IN \('publicada','rechazada'\)\) AS is_overdue/);
  assert.match(sql, /v.estado='bloqueada' AS is_blocked/);
  assert.match(sql, /\(v.estado='lista' AND v.fecha_programada>day.today\) AS is_upcoming_ready/);
  for (const bucket of ['today', 'overdue', 'blocked', 'upcoming_ready']) {
    assert.ok(sql.includes(`count(*) FILTER (WHERE is_${bucket})::int FROM bucketed`));
  }
  assert.doesNotMatch(sql, /interval|BETWEEN|sum\(/i);
});

test('SQL paginates only selected rows and aggregates global totals even when page is empty', () => {
  assert.match(sql, /'total',\(SELECT count\(\*\)::int FROM selected\)/);
  assert.match(sql, /FROM selected s ORDER BY s.fecha_programada ASC NULLS LAST,s.domain ASC,s.id ASC OFFSET \$2 LIMIT \$3/);
  assert.match(sql, /ORDER BY p.fecha_programada ASC NULLS LAST,p.domain ASC,p.id ASC\) FROM page p/);
  assert.match(sql, /'\[\]'::jsonb/);
  assert.equal((sql.match(/\bLIMIT\b/g) || []).length, 1);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b|FOR UPDATE/i);
  const source = readFileSync(new URL('../src/editorial-control.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ annotateEditorialEvidence \} from '\.\/editorial-evidence-read\.js'/);
  assert.match(source, /await annotateEditorialEvidence\(db, domain, rows\)/);
  assert.doesNotMatch(source, /event_action|event_source|event_occurred_at|current_event_id|event_recorded_at/,
    'Evidence predicate must remain solely in the shared annotator');
});
