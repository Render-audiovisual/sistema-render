import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_HOME_SQL, readPersonalHome, createPersonalHomeRouter } from '../src/personal-home.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

// Injected queries only: SQL assertions establish source contracts, not real
// PostgreSQL isolation, timezone evaluation, counts, ACL execution or plans.
const userSql = 'SELECT id,nombre,rol,activo,session_version FROM usuarios WHERE id=$1';
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const auth = { id: 22, session_version: 3, nombre: 'Untrusted label', rol: 'admin' };
const user = { id: 22, nombre: 'Current verified name', rol: 'diseno', activo: true, session_version: 3 };
const payload = () => ({ version: 1, generated_at: '2026-10-22T02:00:00.000Z', today: '2026-10-21',
  summary: { open: 0, overdue: 0, today: 0, upcoming: 0, undated: 0, awaiting_review: 0 }, tasks: [],
  review: { scope: 'personal', total: 0, items: [] }, clients: [], visits: [], activity: [],
  list_totals: { clients: 0, visits: 0, activity: 0 }, capabilities: { projects: false } });
function fake({ account = user, result = { rows: [{ home: payload() }] }, fail, rollbackFail = false } = {}) {
  const calls = []; let connects = 0, releases = 0;
  const db = { release() { releases++; }, async query(sql, params) {
    calls.push({ sql, params });
    if (fail === sql || (rollbackFail && sql === 'ROLLBACK')) throw new Error(`Injected ${sql === PERSONAL_HOME_SQL ? 'home' : sql} failure`);
    if ([begin, 'COMMIT', 'ROLLBACK'].includes(sql)) { assert.equal(params, undefined); return { rows: [] }; }
    if (sql === userSql) { assert.deepEqual(params, [22]); return { rows: account ? [account] : [] }; }
    if (sql === PERSONAL_HOME_SQL) { assert.deepEqual(params, [22, account.rol === 'admin']); return result; }
    throw new Error('Unexpected unit query');
  } };
  return { calls, get connects() { return connects; }, get releases() { return releases; },
    pool: { async connect() { connects++; return db; } } };
}
function routerHarness(pool) {
  let handler;
  const routes = new Set();
  const router = { get(path, callback) {
    assert.ok(['/', '/escalaciones'].includes(path));
    assert.ok(!routes.has(path)); routes.add(path);
    if (path === '/') { assert.equal(handler, undefined); handler = callback; }
  } };
  assert.equal(createPersonalHomeRouter({ express: { Router: () => router }, pool }), router);
  return { async invoke(request = {}) {
    const response = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    let forwarded;
    await handler({ auth, query: {}, ...request }, response, error => { forwarded = error; });
    return { response, forwarded };
  } };
}

test('read uses one read-only repeatable-read transaction and current DB identity, never claimed role/name', async () => {
  const m = fake();
  const home = await readPersonalHome(m.pool, auth);
  assert.deepEqual(home, { ...payload(), user: { id: 22, nombre: user.nombre } });
  assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, PERSONAL_HOME_SQL, 'COMMIT']);
  assert.deepEqual(m.calls[2].params, [22, false]);
  assert.equal(m.connects, 1); assert.equal(m.releases, 1);
});

test('all supported current roles are accepted; only current admin selects team review', async () => {
  for (const rol of SYSTEM_USER_ROLES) {
    const m = fake({ account: { ...user, rol } });
    await readPersonalHome(m.pool, { ...auth, rol: rol === 'admin' ? 'diseno' : 'admin' });
    assert.deepEqual(m.calls[2].params, [22, rol === 'admin']);
    assert.equal(m.releases, 1);
  }
});

test('missing/nonpositive/unsafe/string IDs reject before a connection or query', async () => {
  for (const value of [undefined, null, {}, { id: 0 }, { id: -1 }, { id: '22' }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const m = fake();
    await assert.rejects(readPersonalHome(m.pool, value), error => error.status === 403);
    assert.equal(m.connects, 0); assert.deepEqual(m.calls, []); assert.equal(m.releases, 0);
  }
});

test('missing/inactive user, revoked session and unknown current role roll back before home query', async () => {
  for (const [account, expected] of [[null, 401], [{ ...user, activo: false }, 401],
    [{ ...user, session_version: 4 }, 401], [{ ...user, rol: 'custom-role' }, 403]]) {
    const m = fake({ account });
    await assert.rejects(readPersonalHome(m.pool, auth), error => error.status === expected);
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, 'ROLLBACK']);
    assert.equal(m.releases, 1);
  }
  const m = fake();
  await assert.rejects(readPersonalHome(m.pool, { id: 22 }), error => error.status === 401);
});

test('missing aggregate result rejects instead of fabricating success and releases client', async () => {
  for (const result of [{ rows: [] }, { rows: [{}] }, { rows: [{ home: null }] }]) {
    const m = fake({ result });
    await assert.rejects(readPersonalHome(m.pool, auth), /No se pudo leer el inicio operativo/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
    assert.ok(!m.calls.some(call => call.sql === 'COMMIT'));
  }
});

test('query/begin/commit failure rolls back and releases, including failed rollback', async () => {
  for (const fail of [begin, userSql, PERSONAL_HOME_SQL, 'COMMIT']) {
    const m = fake({ fail, rollbackFail: true });
    await assert.rejects(readPersonalHome(m.pool, auth), /Injected/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
  await assert.rejects(readPersonalHome({ async connect() { throw new Error('Connection unavailable'); } }, auth), /Connection unavailable/);
});

test('route rejects every query selector before DB and always marks responses no-store', async () => {
  const m = fake(), route = routerHarness(m.pool);
  for (const query of [{ user_id: 23 }, { id: 22 }, { scope: 'team' }, { anything: '' }]) {
    const { response, forwarded } = await route.invoke({ query });
    assert.equal(response.code, 400); assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(typeof response.body.error, 'string'); assert.equal(forwarded, undefined);
  }
  assert.equal(m.connects, 0);
  const { response } = await route.invoke();
  assert.equal(response.code, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body.user, { id: 22, nombre: user.nombre });
});

test('route returns auth errors and forwards unexpected failures without success DTO', async () => {
  for (const [options, code] of [[{ account: null }, 401], [{ account: { ...user, rol: 'unknown' } }, 403]]) {
    const { response, forwarded } = await routerHarness(fake(options).pool).invoke();
    assert.equal(response.code, code); assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(response.body), ['error']); assert.equal(forwarded, undefined);
  }
  const { response, forwarded } = await routerHarness(fake({ fail: PERSONAL_HOME_SQL }).pool).invoke();
  assert.ok(forwarded instanceof Error); assert.equal(response.body, undefined);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

const sql = PERSONAL_HOME_SQL.replace(/\s+/g, ' ');
test('SQL visibility is workspace/archive/client filtered and personal membership is ID-only EXISTS', () => {
  assert.match(sql, /workspace'='render_os'/);
  for (const marker of ['archivada_render_os', 'papelera_render_os'])
    assert.ok(sql.includes(`COALESCE(t.propiedades_extra->>'${marker}','false')<>'true'`));
  assert.match(sql, /t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE/);
  assert.match(sql, /mine AS MATERIALIZED \(SELECT v\.\* FROM visible v WHERE EXISTS \( SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=v.id AND a.usuario_id=\$1\)\)/);
  assert.match(sql, /open AS MATERIALIZED \(SELECT \* FROM mine WHERE estado NOT IN \('finalizada','publicada'\)\)/);
  assert.doesNotMatch(sql, /asignado_a|colaboradores|ILIKE|integracion_auditoria|tarea_comentarios/);
});

test('SQL projections explicitly allowlist task and operational fields without open property bags', () => {
  assert.match(sql, /SELECT t.id,t.titulo,CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb THEN 'aprobada' ELSE t.estado END AS estado,t.prioridad,t.revision,t.fecha_vencimiento,t.updated_at, t.cliente_id,c.nombre AS cliente_nombre/);
  const taskKeys = [...PERSONAL_HOME_SQL.matchAll(/jsonb_build_object\('id',q.id,'titulo',q.titulo,\s*'estado',q.estado,[\s\S]*?'href','\/workspace\/tareas\?task='\|\|q.id\)/g)];
  assert.equal(taskKeys.length, 2, 'task and review DTO use the same explicit projection');
  for (const match of taskKeys) for (const key of ['id', 'titulo', 'estado', 'prioridad', 'revision', 'fecha_vencimiento', 'cliente', 'href'])
    assert.ok(match[0].includes(`'${key}',`));
  assert.doesNotMatch(sql, /(?:row_to_json|to_jsonb|to_json)\(t\)|t\.\*|jsonb?_agg\(t\)|aclaraciones|descripcion|contenido|password|session_version|importe|abono|salario|payload|feedback/);
  assert.match(sql, /client_work AS \(SELECT cliente_id AS id,cliente_nombre AS nombre,count\(\*\)::int AS open FROM open/);
  assert.match(sql, /'capabilities',jsonb_build_object\('projects',true\)/);
});

test('legacy boolean approval is a read-only state projection before personal/review counts', () => {
  const projection = sql.indexOf("CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb THEN 'aprobada' ELSE t.estado END AS estado");
  assert.ok(projection > 0 && projection < sql.indexOf('mine AS MATERIALIZED'));
  assert.match(sql, /reviews AS MATERIALIZED \(SELECT \* FROM visible v WHERE estado='en_revision'/);
  assert.match(sql, /'awaiting_review',\(SELECT count\(\*\)::int FROM open WHERE estado='en_revision'\)/);
  assert.match(sql, /open AS MATERIALIZED \(SELECT \* FROM mine WHERE estado NOT IN \('finalizada','publicada'\)\)/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE)\b|->>'revision_aprobada'/i);
});

test('SQL counts are unbounded while lists have explicit deterministic limits and truncation totals', () => {
  assert.equal((sql.match(/LIMIT 12/g) || []).length, 1);
  assert.equal((sql.match(/LIMIT 8/g) || []).length, 5);
  assert.match(sql, /'open',\(SELECT count\(\*\)::int FROM open\)/);
  assert.match(sql, /'total',\(SELECT count\(\*\)::int FROM reviews\)/);
  assert.match(sql, /'list_totals',jsonb_build_object\('clients',\(SELECT count\(\*\)::int FROM client_work\), 'visits',\(SELECT count\(\*\)::int FROM my_visits\),'activity',\(SELECT count\(\*\)::int FROM mine\),'projects',\(SELECT count\(\*\)::int FROM my_projects\)\)/);
  assert.match(sql, /ORDER BY fecha_vencimiento ASC NULLS LAST, CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,id/);
  assert.match(sql, /FROM mine ORDER BY updated_at DESC,id DESC LIMIT 8/);
  assert.match(sql, /'awaiting_review',\(SELECT count\(\*\)::int FROM open WHERE estado='en_revision'\)/);
  assert.match(sql, /reviews AS MATERIALIZED \(SELECT \* FROM visible v WHERE estado='en_revision' AND \(\$2::boolean OR EXISTS/);
});

test('SQL calendar uses Cordoba day and seven-day bounds without browser date inference or admin visit bypass', () => {
  assert.match(sql, /statement_timestamp\(\) AT TIME ZONE 'America\/Argentina\/Cordoba'\)::date AS today/);
  assert.match(sql, /fecha_vencimiento>day.today AND fecha_vencimiento<=day.today\+7/);
  assert.match(sql, /v.fecha BETWEEN day.today AND day.today\+7/);
  const visits = sql.slice(sql.indexOf('my_visits AS MATERIALIZED'), sql.indexOf("SELECT jsonb_build_object( 'version'"));
  assert.ok(visits.length > 0);
  assert.match(visits, /WHERE c.activo IS DISTINCT FROM FALSE AND v.fecha BETWEEN day.today AND day.today\+7 AND \(v.tarea_origen_id IS NULL OR EXISTS\(SELECT 1 FROM visible source WHERE source.id=v.tarea_origen_id\)\) AND \(EXISTS\(SELECT 1 FROM produccion_visita_participantes/,
    'source must be visible or absent independently of every participant/assigned-task OR branch');
  assert.match(visits, /produccion_visita_participantes p WHERE p.visita_id=v.id AND p.usuario_id=\$1/);
  assert.match(visits, /mine m WHERE m.id=v.tarea_origen_id/);
  assert.match(visits, /JOIN mine m ON m.id=COALESCE\(pv.tarea_entrega_id,pv.tarea_edicion_id\)/);
  assert.doesNotMatch(visits, /\$2/);
  assert.match(sql, /'href','\/producciones\?visita='\|\|q.id\|\|'&mes='\|\|to_char\(q.fecha,'YYYY-MM'\)/);
  assert.match(sql, /'href','\/workspace\/tareas\?task='\|\|q.id/);
});
