import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_TEAM_WORKLOAD_SQL, readHomeTeamWorkload, createPersonalHomeRouter } from '../src/personal-home.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

// Injected DB protocol + SQL source contracts only. Actual counts, joins and
// isolation require Main/Hypatia's independent PostgreSQL HTTP verification.
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const userSql = 'SELECT id,nombre,rol,activo,session_version FROM usuarios WHERE id=$1';
const auth = { id: 7, session_version: 3, rol: 'diseno', nombre: 'Untrusted' };
const user = { id: 7, session_version: 3, rol: 'admin', nombre: 'Current DB', activo: true };
const payload = () => ({ version: 1, today: '2026-10-22', offset: 0, limit: 20,
  total_tasks: 0, total_overdue: 0, total_people: 0, has_more: false,
  unassigned: { open: 0, overdue: 0 }, items: [] });
function fake({ account = user, result = { rows: [{ workload: payload() }] }, fail, rollbackFail = false } = {}) {
  const calls = []; let connects = 0, releases = 0;
  const db = { release() { releases++; }, async query(sql, params) {
    calls.push({ sql, params });
    if (sql === fail || (sql === 'ROLLBACK' && rollbackFail)) throw new Error('Injected query failure');
    if (sql === userSql) return { rows: account ? [account] : [] };
    if (sql === HOME_TEAM_WORKLOAD_SQL) return result;
    assert.ok([begin, 'COMMIT', 'ROLLBACK'].includes(sql), 'No unexpected query or writes');
    return { rows: [] };
  } };
  return { calls, get connects() { return connects; }, get releases() { return releases; },
    pool: { async connect() { connects++; return db; } } };
}
function routerHarness(pool) {
  const routes = new Map();
  const router = { get(path, handler) { assert.equal(routes.has(path), false); routes.set(path, handler); } };
  createPersonalHomeRouter({ express: { Router: () => router }, pool });
  assert.ok(routes.has('/equipo') && routes.has('/') && routes.has('/escalaciones'));
  return async (request = {}) => {
    const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let forwarded;
    await routes.get('/equipo')({ auth, query: {}, ...request }, res, error => { forwarded = error; });
    return { res, forwarded };
  };
}

test('verified current admin reads workload in one RR readonly transaction, not token role/name', async () => {
  const m = fake();
  assert.deepEqual(await readHomeTeamWorkload(m.pool, auth), payload());
  assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, HOME_TEAM_WORKLOAD_SQL, 'COMMIT']);
  assert.deepEqual(m.calls[1].params, [7]); assert.deepEqual(m.calls[2].params, [0, 20]);
  assert.equal(m.connects, 1); assert.equal(m.releases, 1);
});

test('every nonadmin DB role is denied even when token claims admin; rollback and release', async () => {
  for (const rol of SYSTEM_USER_ROLES.filter(role => role !== 'admin')) {
    const m = fake({ account: { ...user, rol } });
    await assert.rejects(readHomeTeamWorkload(m.pool, { ...auth, rol: 'admin', nombre: 'Agustín' }), { status: 403 });
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, 'ROLLBACK']);
    assert.equal(m.releases, 1);
  }
});

test('missing, inactive or revoked DB sessions reject before workload SQL', async () => {
  for (const account of [null, { ...user, activo: false }, { ...user, session_version: 4 }]) {
    const m = fake({ account });
    await assert.rejects(readHomeTeamWorkload(m.pool, auth), { status: 401 });
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, 'ROLLBACK']); assert.equal(m.releases, 1);
  }
  const missingVersion = fake();
  await assert.rejects(readHomeTeamWorkload(missingVersion.pool, { id: 7 }), { status: 401 });
});

test('invalid identity and closed paging query fail before connecting; paging bounds match escalation parser', async () => {
  for (const invalidAuth of [null, undefined, {}, { id: 0 }, { id: '7' }, { id: -1 }, { id: 1.5 }, { id: Infinity }]) {
    const m = fake(); await assert.rejects(readHomeTeamWorkload(m.pool, invalidAuth), { status: 403 }); assert.equal(m.connects, 0);
  }
  for (const query of [{ user_id: '8' }, { role: 'admin' }, { scope: 'all' }, { nombre: 'Franco' },
    { limit: '0' }, { limit: '51' }, { limit: ['20', '30'] }, { offset: ['0'] }, { limit: 20 },
    { offset: '01' }, { offset: '-1' }, { offset: '1.0' }, { offset: '1000001' }]) {
    const m = fake(); await assert.rejects(readHomeTeamWorkload(m.pool, auth, query), { status: 400 }); assert.equal(m.connects, 0);
  }
  const m = fake(); await readHomeTeamWorkload(m.pool, auth, { offset: '1000000', limit: '50' });
  assert.deepEqual(m.calls[2].params, [1000000, 50]);
});

test('missing aggregate and query/begin/commit failures never return fabricated success and release once', async () => {
  for (const result of [{ rows: [] }, { rows: [{}] }, { rows: [{ workload: null }] }]) {
    const m = fake({ result }); await assert.rejects(readHomeTeamWorkload(m.pool, auth), /No se pudo leer/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
  for (const fail of [begin, userSql, HOME_TEAM_WORKLOAD_SQL, 'COMMIT']) {
    const m = fake({ fail, rollbackFail: true });
    await assert.rejects(readHomeTeamWorkload(m.pool, auth), /Injected/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
});

test('team route uses no-store and expected 400/401/403 responses; unexpected failures forward', async () => {
  for (const [options, request, code] of [
    [{}, { query: { user_id: '8' } }, 400], [{ account: null }, {}, 401],
    [{ account: { ...user, rol: 'produccion' } }, {}, 403],
  ]) {
    const { res, forwarded } = await routerHarness(fake(options).pool)(request);
    assert.equal(res.code, code); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(res.body), ['error']); assert.equal(forwarded, undefined);
  }
  const success = await routerHarness(fake().pool)();
  assert.deepEqual(success.res.body, payload()); assert.equal(success.res.headers['Cache-Control'], 'no-store');
  const failed = await routerHarness(fake({ fail: HOME_TEAM_WORKLOAD_SQL }).pool)();
  assert.ok(failed.forwarded instanceof Error); assert.equal(failed.res.body, undefined);
  assert.equal(failed.res.headers['Cache-Control'], 'no-store');
});

const sql = HOME_TEAM_WORKLOAD_SQL.replace(/\s+/g, ' ');
test('SQL includes all visible open work, boolean approval normalization and Cordoba day only', () => {
  assert.match(sql, /statement_timestamp\(\) AT TIME ZONE 'America\/Argentina\/Cordoba'\)::date AS today/);
  assert.match(sql, /workspace'='render_os'/);
  assert.match(sql, /t.estado NOT IN \('finalizada','publicada'\)/);
  for (const key of ['archivada_render_os', 'papelera_render_os']) assert.ok(sql.includes(`COALESCE(t.propiedades_extra->>'${key}','false')<>'true'`));
  assert.match(sql, /t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE/);
  assert.match(sql, /t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb THEN 'aprobada' ELSE t.estado END AS estado/);
  assert.doesNotMatch(sql, /->>'revision_aprobada'/);
});

test('SQL membership is distinct task/user IDs of any assignment type, retaining inactive users and no zero-work groups', () => {
  assert.match(sql, /SELECT DISTINCT a.tarea_id,a.usuario_id FROM tarea_asignaciones a JOIN open_tasks t ON t.id=a.tarea_id/);
  assert.match(sql, /FROM membership a JOIN open_tasks t ON t.id=a.tarea_id JOIN usuarios u ON u.id=a.usuario_id/);
  assert.match(sql, /GROUP BY u.id,u.nombre,u.activo/);
  assert.doesNotMatch(sql, /u.activo\s*(?:=|IS)|a\.tipo|asignado_a|colaboradores|ILIKE|LOWER\(/i);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id\)/);
  assert.match(sql, /count\(DISTINCT t.id\)::int AS open/);
  assert.match(sql, /count\(DISTINCT t.id\) FILTER \(WHERE t.estado='en_revision'\)::int AS review/);
  assert.match(sql, /count\(DISTINCT t.id\) FILTER \(WHERE t.estado='aprobada'\)::int AS approved/);
});

test('global and unassigned totals are unpaginated distinct tasks; people alone are paginated deterministically', () => {
  assert.match(sql, /'total_tasks',\(SELECT count\(DISTINCT id\)::int FROM open_tasks\)/);
  assert.match(sql, /'total_overdue',\(SELECT count\(DISTINCT id\) FILTER \(WHERE fecha_vencimiento<day.today\)::int FROM open_tasks\)/);
  assert.match(sql, /'total_people',\(SELECT count\(\*\)::int FROM people\)/);
  assert.match(sql, /'has_more',\(SELECT count\(\*\) FROM people\)>\$1::integer\+\$2::integer/);
  assert.match(sql, /FROM people p ORDER BY p.overdue DESC,p.open DESC,p.id ASC OFFSET \$1 LIMIT \$2/);
  assert.match(sql, /ORDER BY p.overdue DESC,p.open DESC,p.id ASC\) FROM page p/);
  assert.match(sql, /'unassigned',jsonb_build_object\('open',\(SELECT count\(DISTINCT id\)::int FROM unassigned_tasks\)/);
  assert.match(sql, /'overdue',\(SELECT count\(DISTINCT id\) FILTER \(WHERE fecha_vencimiento<day.today\)::int FROM unassigned_tasks\)/);
  assert.equal((sql.match(/\bLIMIT\b/g) || []).length, 1);
});

test('SQL DTO projects only closed workload/user fields, no task dates, financial or metadata payloads', () => {
  const projection = sql.slice(sql.indexOf("SELECT jsonb_build_object('version'"));
  const keys = [...projection.matchAll(/'([a-z_]+)'\s*,/g)].map(match => match[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['version', 'today', 'offset', 'limit', 'total_tasks', 'total_overdue',
    'total_people', 'has_more', 'unassigned', 'open', 'overdue', 'items', 'user', 'id', 'nombre', 'activo', 'review', 'approved'].sort());
  assert.match(sql, /'user',jsonb_build_object\('id',p.id,'nombre',p.nombre,'activo',p.activo\)/);
  assert.match(sql, /'\[\]'::jsonb/);
  assert.doesNotMatch(sql, /to_json|row_to_json|\w+\.\*|\b(?:UPDATE|INSERT|DELETE)\b|salario|importe|abono|feedback|motivo|password|session_version|generated_at/i);
});
