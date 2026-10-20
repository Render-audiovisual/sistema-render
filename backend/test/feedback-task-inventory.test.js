import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedbackTaskInventoryQuery as parse, readFeedbackTaskInventory as read,
  FEEDBACK_TASK_INVENTORY_SQL as sql } from '../src/feedback-task-inventory.js';

const auth = { id: 4, session_version: 2, rol: 'admin' };
const delivery = '10000000-0000-4000-8000-000000000001';
const decision = '20000000-0000-4000-8000-000000000002';
const at = '2026-10-20T12:00:00.000Z';
const item = (patch = {}) => ({ task_id: 42, revision: 9, titulo: 'Reel', estado: 'en_progreso',
  cliente: { id: 3, nombre: 'Cliente' },
  latest_delivery: { id: delivery, task_revision: 7, recorded_at: at },
  latest_decision: { id: decision, delivery_id: delivery, action: 'correcciones', task_revision: 8, recorded_at: at },
  has_corrections: true, ...patch });
function harness({ user = { ...auth, activo: true }, inventory = { total: 1, items: [item()] }, fault } = {}) {
  const calls = []; let releases = 0, connects = 0;
  const db = { release() { releases++; }, async query(statement, params) {
    calls.push({ sql: statement, params });
    const error = fault?.(statement); if (error) throw error;
    if (statement.startsWith('SELECT id,rol')) return { rows: user ? [user] : [] };
    if (statement === sql) return { rows: [{ inventory }] };
    return { rows: [] };
  } };
  return { calls, get releases() { return releases; }, get connects() { return connects; },
    pool: { connect: async () => { connects++; return db; }, query() { assert.fail('must use one checked-out client'); } } };
}

test('strict parser defaults, boundaries and filters', () => {
  assert.deepEqual(parse(), { limit: 20, offset: 0, view: 'all', cliente_id: null, q: '' });
  assert.deepEqual(parse({ limit: '50', offset: '1000000', view: 'with_corrections', cliente_id: '2147483647', q: '  edición  ' }),
    { limit: 50, offset: 1000000, view: 'with_corrections', cliente_id: 2147483647, q: 'edición' });
  assert.equal(parse({ q: 'x'.repeat(200) }).q.length, 200);
  assert.equal(parse({ view: 'awaiting_review', limit: '1' }).view, 'awaiting_review');
});
test('parser rejects unknowns, nonscalars, controls and noncanonical integers', () => {
  for (const query of [null, [], 'q=x', { workspace: 'render_os' }, { view: '' }, { view: ['all'] }, { view: 'pending' },
    ...[1, [], {}, null, 'x'.repeat(201), 'a\nb', 'a\tb', 'a\0b', 'a\u007fb'].map(q => ({ q })),
    ...['limit', 'offset', 'cliente_id'].flatMap(key => ['', '01', '-1', '1.0', '1e2', ' 1', 1, [], {}, null, '999999999999999999'].map(value => ({ [key]: value }))),
    { limit: '0' }, { limit: '51' }, { offset: '1000001' }, { cliente_id: '0' }, { cliente_id: '2147483648' }]) {
    assert.throws(() => parse(query), { status: 400 });
  }
});
test('one RR readonly snapshot rechecks current identity then count/page, commits and releases', async () => {
  const h = harness();
  const result = await read(h.pool, auth, { limit: '1', offset: '0', view: 'with_corrections', cliente_id: '3', q: 'Reel' });
  assert.deepEqual(result, { version: 1, limit: 1, offset: 0, total: 1, has_more: false,
    items: [{ ...item(), href: '/workspace/tareas?task=42' }] });
  assert.deepEqual(h.calls.map(c => c.sql), ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', sql, 'COMMIT']);
  assert.deepEqual(h.calls[1].params, [auth.id]);
  assert.deepEqual(h.calls[2].params, [1, 0, 'with_corrections', 3, 'Reel']);
  assert.equal(h.connects, 1); assert.equal(h.releases, 1);
});
test('all supported roles share reads; stale identity and unknown roles fail before inventory', async () => {
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const h = harness({ user: { ...auth, rol, activo: true } });
    assert.equal((await read(h.pool, { ...auth, rol })).items.length, 1);
  }
  for (const user of [null, { ...auth, activo: false }, { ...auth, activo: true, id: 5 },
    { ...auth, activo: true, session_version: 3 }, { ...auth, activo: true, rol: 'edicion' }]) {
    const h = harness({ user });
    await assert.rejects(read(h.pool, auth), { status: 401 });
    assert.equal(h.calls.some(c => c.sql === sql), false);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.equal(h.releases, 1);
  }
  const h = harness({ user: { ...auth, activo: true, rol: 'unknown' } });
  await assert.rejects(read(h.pool, { ...auth, rol: 'unknown' }), { status: 403 });
});
test('bad auth or query performs no checkout', async () => {
  const h = harness();
  for (const value of [null, {}, { ...auth, id: '4' }, { ...auth, session_version: 0 }]) {
    await assert.rejects(read(h.pool, value), { status: 401 });
  }
  await assert.rejects(read(h.pool, auth, { q: ['a'] }), { status: 400 });
  assert.equal(h.connects, 0);
});
test('empty offset retains true total and has_more follows full filtered inventory', async () => {
  for (const [total, offset, has_more] of [[123, 1000, false], [0, 0, false], [123, 0, true]]) {
    const result = await read(harness({ inventory: { total, items: [] } }).pool, auth, { offset: String(offset) });
    assert.equal(result.total, total); assert.equal(result.has_more, has_more); assert.deepEqual(result.items, []);
  }
});
test('closed all-role DTO strips injected secrets at every level and reconstructs href', async () => {
  const secret = { notes: 'SECRET', comentarios: ['SECRET'], finance: 'SECRET', propiedades_extra: { secret: 'SECRET' } };
  const source = item({ ...secret, href: 'https://evil.invalid', cliente: { id: 3, nombre: 'Cliente', ...secret },
    latest_delivery: { ...item().latest_delivery, ...secret }, latest_decision: { ...item().latest_decision, ...secret } });
  for (const rol of ['admin', 'edicion']) {
    const h = harness({ user: { ...auth, activo: true, rol }, inventory: { total: 1, items: [source], ...secret } });
    const result = await read(h.pool, { ...auth, rol });
    assert.deepEqual(result.items, [{ ...item(), href: '/workspace/tareas?task=42' }]);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|notes|comentarios|finance|propiedades_extra|evil/);
  }
});
test('null artifacts/client supported; later approval or delivery never clears historical corrections', async () => {
  for (const patch of [{ cliente: null, latest_delivery: null, latest_decision: null, has_corrections: false },
    { estado: 'aprobada', latest_decision: { ...item().latest_decision, action: 'aprobada' } },
    { latest_delivery: { id: delivery, task_revision: 9, recorded_at: at } }]) {
    const result = await read(harness({ inventory: { total: 1, items: [item(patch)] } }).pool, auth);
    assert.deepEqual(result.items[0], { ...item(patch), href: '/workspace/tareas?task=42' });
    assert.equal(Object.hasOwn(result.items[0], 'resolved'), false);
  }
});
test('SQL scopes canonical active editing and genuine queue union decisions, never keyword membership', () => {
  for (const pattern of [/t.tipo_tarea='edicion'/, /workspace'='render_os'/, /archivada_render_os/, /papelera_render_os/,
    /t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE/, /t.estado='en_revision' AND d.id IS NOT NULL/,
    /d.task_revision<=t.revision/, /AND NOT COALESCE\(\(t.propiedades_extra->'revision_aprobada'='true'::jsonb/,
    /'all' AND \(awaiting_review OR decision_id IS NOT NULL\)/, /'awaiting_review' AND awaiting_review/,
    /'with_corrections' AND has_corrections/, /correction.action='correcciones'/]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /q=feedback|ILIKE|resolved|resuelto|tarea_asignaciones/);
});
test('awaiting SQL requires exact latest artifact approval, handles NULL proof and needs no retrofit decision', () => {
  const expression = sql.match(/AND NOT COALESCE\(\(([\s\S]*?)\),FALSE\)\) AS awaiting_review/)[1];
  assert.equal(expression.replace(/\s+/g, ' '), "t.propiedades_extra->'revision_aprobada'='true'::jsonb AND t.propiedades_extra->>'revision_aprobada_entrega_id'=d.id::text AND d.task_revision<t.revision");
  // Evaluate the actual closed predicate's three atoms against the contract
  // matrix. This is pure predicate coverage, not a PostgreSQL execution test.
  const predicate = expression
    .replace("t.propiedades_extra->'revision_aprobada'='true'::jsonb", 'approved === true')
    .replace("t.propiedades_extra->>'revision_aprobada_entrega_id'=d.id::text", 'binding === artifact')
    .replace('d.task_revision<t.revision', 'artifactRevision < taskRevision')
    .replace(/\bAND\b/g, '&&');
  const effective = new Function('approved', 'binding', 'artifact', 'artifactRevision', 'taskRevision', `return (${predicate});`);
  for (const [approved, binding, artifactRevision, visible] of [
    [true, undefined, 7, true], [true, null, 7, true], [true, decision, 7, true],
    [true, delivery, 7, false], [true, delivery, 9, true],
    ['true', delivery, 7, true], [false, delivery, 7, true], [undefined, delivery, 7, true],
  ]) {
    assert.equal(!effective(approved, binding, delivery, artifactRevision, 9), visible);
  }
  assert.match(sql, /t.estado='en_revision' AND d.id IS NOT NULL AND d.task_revision<=t.revision/);
  assert.doesNotMatch(expression, /decision|review\.action|task_editing_reviews/);
});
test('future artifact revisions reject in every view; decision may follow delivery but not task', async () => {
  for (const view of ['all', 'awaiting_review', 'with_corrections']) {
    for (const field of ['latest_delivery', 'latest_decision']) {
      const h = harness({ inventory: { total: 1, items: [item({ [field]: { ...item()[field], task_revision: 10 } })] } });
      await assert.rejects(read(h.pool, auth, { view }), /No se pudo leer el inventario/);
      assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
      assert.equal(h.calls.some(call => call.sql === 'COMMIT'), false);
      assert.equal(h.releases, 1);
    }
    const result = await read(harness({ inventory: { total: 1, items: [item({
      latest_decision: { ...item().latest_decision, task_revision: 9 },
    })] } }).pool, auth, { view });
    assert.equal(result.items[0].latest_delivery.task_revision, 7);
    assert.equal(result.items[0].latest_decision.task_revision, 9);
  }
});
test('SQL selects latest lateral rows without duplication and counts before stable bound pagination', () => {
  assert.equal((sql.match(/LEFT JOIN LATERAL/g) || []).length, 2);
  assert.match(sql, /ORDER BY delivery.task_revision DESC,delivery.recorded_at DESC,delivery.id DESC LIMIT 1/);
  assert.match(sql, /ORDER BY review.task_revision DESC,review.id DESC LIMIT 1/);
  assert.match(sql, /filtered AS MATERIALIZED/);
  assert.match(sql, /FROM filtered ORDER BY id DESC LIMIT \$1::integer OFFSET \$2::integer/);
  assert.match(sql, /count\(\*\)::int FROM filtered/);
  assert.match(sql, /jsonb_agg[\s\S]*ORDER BY p.id DESC/);
  assert.match(sql, /strpos\(lower\(concat_ws\(' ',t.titulo,c.nombre\)\),lower\(\$5::text\)\)/);
  assert.doesNotMatch(sql, /SELECT \w+\.\*|row_to_json|to_jsonb|tarea_comentarios|notes|payload_hash|request_id|salario|importe|FOR UPDATE|FOR SHARE|pg_advisory|INSERT|UPDATE|DELETE/i);
});
test('malformed storage DTO/envelope fails closed and releases rather than leaking unknown objects', async () => {
  for (const inventory of [null, { total: '1', items: [] }, { total: -1, items: [] }, { total: 1, items: {} },
    ...[{ task_id: '42' }, { titulo: {} }, { revision: 0 }, { has_corrections: 'true' }, { cliente: {} },
      { latest_delivery: { ...item().latest_delivery, id: 'invalid' } },
      { latest_decision: { ...item().latest_decision, action: 'resolved' } },
      { latest_delivery: { ...item().latest_delivery, recorded_at: 'invalid' } }].map(patch => ({ total: 1, items: [item(patch)] })),
    { total: 2, items: [item(), item()] }]) {
    const h = harness({ inventory });
    await assert.rejects(read(h.pool, auth));
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.equal(h.releases, 1);
    assert.equal(h.calls.some(c => c.sql === 'COMMIT'), false);
  }
});
test('unexpected storage errors propagate unchanged, rollback failure cannot mask original, release always', async () => {
  const error = new Error('private SQL fault');
  for (const point of ['BEGIN', 'SELECT id,rol', 'WITH candidates', 'COMMIT']) {
    const h = harness({ fault: statement => statement.startsWith(point) ? error : statement === 'ROLLBACK' ? new Error('rollback fault') : null });
    await assert.rejects(read(h.pool, auth), value => value === error);
    assert.equal(h.releases, 1); assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  }
});
