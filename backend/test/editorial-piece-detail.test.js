import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readEditorialPieceDetail, createEditorialControlRouter, EDITORIAL_CONTROL_SQL } from '../src/editorial-control.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

// Injected database protocol and real annotation helper; not PostgreSQL/HTTP QA.
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const userSql = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
const auth = { id: 7, rol: 'community', session_version: 2 };
const account = { ...auth, activo: true };
const eventId = '12345678-1234-4234-8234-123456789abc';
const actual = '2026-10-22T12:00:00.000Z';
const observed = (domain = 'historia', patch = {}) => ({ domain, id: 2, estado: 'pendiente', tipo: domain === 'historia' ? 'historia' : 'reel',
  titulo: 'Título de lista', cliente_id: 3, cliente_nombre: 'Cliente', cliente_activo: true,
  fecha_programada: '2026-10-22', 'fecha_publicación_real': null, metadata: { archivado_tablero: null },
  content_idea: '  Idea\nexacta  ', content_copy: '<script>alert(1)</script>\n',
  content_material_referencia: 'javascript:literal-no-anchor', content_aclaraciones: null, ...patch });
function proof(domain = 'historia') {
  return { piece_id: 2, piece_cliente_id: 3, piece_estado: 'publicada', piece_actual_at: actual,
    piece_fecha_programada: '2026-10-22', piece_archived: false, cliente_activo: true,
    revision: 1, current_event_id: eventId, event_id: eventId, event_dominio: domain, event_pieza_id: 2,
    event_cliente_id: 3, event_actor_id: 7, event_action: 'confirmar', event_source: 'manual',
    event_occurred_at: actual, event_recorded_at: actual };
}
function fake({ user = account, rows = [observed()], evidence = [], fail, rollbackFail = false } = {}) {
  const calls = []; let connects = 0, releases = 0;
  const db = { release() { releases++; }, async query(sql, params) {
    calls.push({ sql, params });
    const kind = sql === userSql ? 'user' : sql.includes('AS piece_id') ? 'evidence' : sql.includes('content_idea') ? 'detail' : sql;
    if (kind === fail || (sql === 'ROLLBACK' && rollbackFail)) throw new Error('Injected failure');
    if (kind === 'user') return { rows: user ? [user] : [] };
    if (kind === 'evidence') return { rows: evidence };
    if (kind === 'detail') return { rows };
    assert.ok([begin, 'COMMIT', 'ROLLBACK'].includes(sql)); return { rows: [] };
  } };
  return { calls, get connects() { return connects; }, get releases() { return releases; },
    pool: { async connect() { connects++; return db; } } };
}
function route(pool) {
  const routes = new Map();
  const router = { get(path, handler) { assert.equal(routes.has(path), false); routes.set(path, handler); } };
  assert.equal(createEditorialControlRouter({ express: { Router: () => router }, pool }), router);
  assert.ok(routes.has('/') && routes.has('/:domain/:id'));
  return async (request = {}) => {
    const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    let forwarded;
    await routes.get('/:domain/:id')({ auth, params: { domain: 'historia', id: '2' }, query: {}, ...request }, res, error => { forwarded = error; });
    return { res, forwarded };
  };
}

test('both domains use canonical identity, current shared role and one readonly RR snapshot', async () => {
  for (const domain of ['historia', 'publicacion']) for (const rol of SYSTEM_USER_ROLES) {
    const m = fake({ user: { ...account, rol }, rows: [observed(domain)] });
    const result = await readEditorialPieceDetail(m.pool, { ...auth, rol }, domain, '2');
    assert.equal(result.piece.domain, domain); assert.equal(result.piece.id, 2);
    assert.equal(m.calls[0].sql, begin); assert.equal(m.calls[1].sql, userSql); assert.deepEqual(m.calls[1].params, [7]);
    const detail = m.calls.find(call => call.sql.includes('content_idea'));
    assert.deepEqual(detail.params, [2]); assert.ok(detail.sql.includes(`FROM ${domain === 'historia' ? 'historias' : 'publicaciones'} p`));
    const evidence = m.calls.find(call => call.sql.includes('AS piece_id'));
    assert.deepEqual(evidence.params, [domain, [2]]);
    assert.equal(m.calls.at(-1).sql, 'COMMIT'); assert.equal(m.releases, 1);
  }
});

test('unknown/noncanonical identity and any query fail 400 before connect', async () => {
  for (const [domain, rawId] of [['unknown', '2'], ['historias', '2'], ['__proto__', '2'], ['historia', '0'], ['historia', '-1'],
    ['historia', '02'], ['historia', '2.0'], ['historia', '2\n'], ['historia', '2147483648'], ['historia', 2]]) {
    const m = fake(); await assert.rejects(readEditorialPieceDetail(m.pool, auth, domain, rawId), { status: 400 }); assert.equal(m.connects, 0);
  }
  for (const query of [null, [], '', { cliente_id: '3' }, { bucket: 'today' }, { extra: '' }]) {
    const m = fake(); await assert.rejects(readEditorialPieceDetail(m.pool, auth, 'historia', '2', query), { status: 400 }); assert.equal(m.connects, 0);
  }
});

test('revoked/inactive/mismatched identity is 401; unknown current matching role 403', async () => {
  for (const user of [null, { ...account, id: 8 }, { ...account, rol: 'admin' },
    { ...account, activo: false }, { ...account, session_version: 3 }]) {
    const m = fake({ user }); await assert.rejects(readEditorialPieceDetail(m.pool, auth, 'historia', '2'), { status: 401 });
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.calls.some(call => call.sql.includes('content_idea')), false);
  }
  const unknown = fake({ user: { ...account, rol: 'unknown' } });
  await assert.rejects(readEditorialPieceDetail(unknown.pool, { ...auth, rol: 'unknown' }, 'historia', '2'), { status: 403 });
  for (const invalid of [null, {}, { ...auth, id: '7' }, { ...auth, id: 0 }, { ...auth, session_version: undefined }]) {
    const m = fake(); await assert.rejects(readEditorialPieceDetail(m.pool, invalid, 'historia', '2'), { status: 401 }); assert.equal(m.releases, 1);
  }
});

test('missing or SQL-hidden piece is 404; identity inconsistencies cannot select another row', async () => {
  const missing = fake({ rows: [] });
  await assert.rejects(readEditorialPieceDetail(missing.pool, auth, 'historia', '2'), { status: 404 });
  assert.equal(missing.calls.some(call => call.sql.includes('AS piece_id')), false);
  for (const rows of [[observed('publicacion')], [observed('historia', { id: 3 })], [observed(), observed()]]) {
    const m = fake({ rows }); await assert.rejects(readEditorialPieceDetail(m.pool, auth, 'historia', '2'), /identificar/);
  }
});

test('closed detail keeps exact raw root strings/null without truncation or metadata fallback', async () => {
  const raw = observed('historia', { content_idea: null, metadata: { idea: 'No root fallback', finance: 999 },
    content_copy: ' \r\n<svg onload=alert(1)>\u0000 ', secret: 'not returned' });
  const before = JSON.stringify(raw), m = fake({ rows: [raw] });
  const result = await readEditorialPieceDetail(m.pool, auth, 'historia', '2');
  assert.deepEqual(Object.keys(result), ['version', 'piece', 'content']);
  assert.deepEqual(Object.keys(result.piece), ['domain', 'id', 'titulo', 'estado', 'tipo', 'cliente', 'fecha_programada', 'publication_classification']);
  assert.deepEqual(result.content, { idea: null, copy: raw.content_copy,
    material_referencia: raw.content_material_referencia, aclaraciones: null });
  assert.equal(result.piece.titulo, 'Título de lista'); assert.equal(JSON.stringify(raw), before);
  assert.doesNotMatch(JSON.stringify(result), /finance|metadata|secret|No root fallback|fecha_publicación_real|content_copy/);
  const malformed = fake({ rows: [observed('historia', { content_copy: { hidden: 'object' } })] });
  await assert.rejects(readEditorialPieceDetail(malformed.pool, auth, 'historia', '2'), /Contenido/);
});

test('1 MiB aggregate UTF8 boundary succeeds exactly; multibyte and cross-field overflow return 413, never truncate', async () => {
  const limit = 1024 * 1024;
  for (const idea of ['a'.repeat(limit), '😀'.repeat(limit / 4)]) {
    const raw = observed('historia', { content_idea: idea, content_copy: null, content_material_referencia: null, content_aclaraciones: null });
    const m = fake({ rows: [raw] });
    assert.equal((await readEditorialPieceDetail(m.pool, auth, 'historia', '2')).content.idea, idea);
  }
  for (const patch of [{ content_idea: '😀'.repeat(limit / 4), content_copy: 'a' },
    { content_idea: 'a'.repeat(limit / 2), content_copy: 'b'.repeat(limit / 2), content_aclaraciones: 'c' }]) {
    const m = fake({ rows: [observed('historia', { content_material_referencia: null, content_aclaraciones: null, ...patch })] });
    await assert.rejects(readEditorialPieceDetail(m.pool, auth, 'historia', '2'), { status: 413 });
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
    assert.equal(m.calls.some(call => call.sql.includes('AS piece_id')), false);
  }
});

test('actual evidence helper annotates same snapshot, ignoring forged metadata/current confirmation claims', async () => {
  const raw = observed('publicacion', { estado: 'publicada', 'fecha_publicación_real': actual,
    metadata: { publicacion_evidencia: { classification: 'confirmada_manualmente' } },
    publicacion_evidencia: { classification: 'confirmada_manualmente' } });
  const historical = fake({ rows: [raw] });
  assert.equal((await readEditorialPieceDetail(historical.pool, auth, 'publicacion', '2')).piece.publication_classification, 'historica_sin_confirmacion');
  const confirmed = fake({ rows: [raw], evidence: [proof('publicacion')] });
  assert.equal((await readEditorialPieceDetail(confirmed.pool, auth, 'publicacion', '2')).piece.publication_classification, 'confirmada_manualmente');
  const notPublished = fake();
  assert.equal((await readEditorialPieceDetail(notPublished.pool, auth, 'historia', '2')).piece.publication_classification, 'no_publicada');
});

test('read/evidence/commit failures roll back and release even if rollback also fails', async () => {
  for (const fail of [begin, 'user', 'detail', 'evidence', 'COMMIT']) {
    const m = fake({ fail, rollbackFail: true });
    await assert.rejects(readEditorialPieceDetail(m.pool, auth, 'historia', '2'), /Injected/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
});

test('router retains list and maps detail 400/401/403/404/413 with no-store; errors forward', async () => {
  for (const [options, request, status] of [[{}, {}, 200], [{}, { query: { x: '' } }, 400],
    [{ user: null }, {}, 401], [{ user: { ...account, rol: 'unknown' } }, { auth: { ...auth, rol: 'unknown' } }, 403],
    [{ rows: [] }, {}, 404], [{ rows: [observed('historia', { content_copy: 'a'.repeat(1024 * 1024 + 1) })] }, {}, 413]]) {
    const { res, forwarded } = await route(fake(options).pool)(request);
    assert.equal(res.code, status); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(forwarded, undefined);
    if (status !== 200) assert.deepEqual(Object.keys(res.body), ['error']);
  }
  const failed = await route(fake({ fail: 'detail' }).pool)();
  assert.ok(failed.forwarded instanceof Error); assert.equal(failed.res.body, undefined);
});

test('detail SQL reuses list title and visibility, selects root content only and binds piece ID', async () => {
  const m = fake(); await readEditorialPieceDetail(m.pool, auth, 'historia', '2');
  const sql = m.calls.find(call => call.sql.includes('content_idea')).sql;
  assert.match(sql, /JOIN clientes c ON c.id=p.cliente_id/);
  assert.match(sql, /c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true' AND p.id=\$1/);
  assert.match(sql, /to_char\(p.fecha_programada,'YYYY-MM-DD'\) AS fecha_programada/);
  for (const field of ['idea', 'copy', 'material_referencia', 'aclaraciones']) assert.ok(sql.includes(`p.${field} AS content_${field}`));
  assert.match(sql, /jsonb_build_object\('archivado_tablero',p.metadata->'archivado_tablero'\)/);
  assert.doesNotMatch(sql, /to_json|row_to_json|\w+\.\*|importe|abono|salario|\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE)\b/i);
  assert.doesNotMatch(EDITORIAL_CONTROL_SQL, /content_idea|content_copy|content_material_referencia|content_aclaraciones/,
    'List never starts downloading full content');
  const source = readFileSync(new URL('../src/editorial-control.js', import.meta.url), 'utf8');
  assert.match(source, /editorialPieceIdentity\(domain, rawId\)/);
  assert.match(source, /piece: closeItem\(annotated\)/);
  assert.match(source, /annotateEditorialEvidence\(db, identity.domain, \[observed\]\)/);
});
