import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHomeProductionPage, readHomeProductionPage, HOME_PRODUCTION_PAGE_SQL,
  PERSONAL_HOME_SQL, createPersonalHomeRouter } from '../src/personal-home.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

// Injected DB protocol and SQL source contracts, not database/HTTP execution.
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const userSql = 'SELECT id,nombre,rol,activo,session_version FROM usuarios WHERE id=$1';
const auth = { id: 7, session_version: 3, rol: 'untrusted', nombre: 'Never identity' };
const account = { id: 7, session_version: 3, rol: 'produccion', activo: true, nombre: 'Actual' };
const payload = () => ({ version: 1, user: { id: 7 }, period: '2026-10', today: '2026-10-23', offset: 0, limit: 20,
  total: 0, completed: 0, client_count: 0, has_more: false, clients: [] });
function fake({ user = account, result = { rows: [{ production_page: payload() }] }, fail, rollbackFail = false } = {}) {
  const calls = []; let connects = 0, releases = 0;
  const db = { release() { releases++; }, async query(sql, values) {
    calls.push({ sql, values });
    if (sql === fail || (sql === 'ROLLBACK' && rollbackFail)) throw new Error('Injected query failure');
    if (sql === userSql) return { rows: user ? [user] : [] };
    if (sql === HOME_PRODUCTION_PAGE_SQL) return result;
    assert.ok([begin, 'COMMIT', 'ROLLBACK'].includes(sql)); return { rows: [] };
  } };
  return { calls, get connects() { return connects; }, get releases() { return releases; },
    pool: { async connect() { connects++; return db; } } };
}
function route(pool) {
  const routes = new Map();
  const router = { get(path, handler) { assert.equal(routes.has(path), false); routes.set(path, handler); } };
  createPersonalHomeRouter({ express: { Router: () => router }, pool });
  for (const path of ['/', '/equipo', '/escalaciones', '/produccion-mensual']) assert.ok(routes.has(path));
  return async (request = {}) => {
    const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    let forwarded;
    await routes.get('/produccion-mensual')({ auth, query: { period: '2026-10' }, ...request }, res, error => { forwarded = error; });
    return { res, forwarded };
  };
}

test('query requires a real canonical month in years 0001..9999 and bounded canonical paging', () => {
  assert.deepEqual(parseHomeProductionPage({ period: '2026-10' }), { period: '2026-10', offset: 0, limit: 20 });
  for (const period of ['0001-01', '0099-12', '2028-02', '9999-12']) {
    assert.deepEqual(parseHomeProductionPage({ period, offset: '1000000', limit: '50' }), { period, offset: 1000000, limit: 50 });
  }
  for (const query of [null, [], '', {}, { period: undefined }, { period: 202610 }, { period: ['2026-10'] },
    ...['0000-01', '10000-01', '2026-00', '2026-13', '2026-1', '2026-10-01', '2026-10\n', ' 2026-10'].map(period => ({ period })),
    ...[{ offset: '01' }, { offset: '-1' }, { offset: '1.0' }, { offset: '1e2' }, { offset: '1000001' }, { offset: '0\n' },
      { offset: ['0'] }, { offset: 0 }, { limit: '0' }, { limit: '51' }, { limit: 20 }, { user_id: '8' }, { role: 'admin' },
      { cliente_id: '3' }, { nombre: 'Franco' }].map(patch => ({ period: '2026-10', ...patch }))]) {
    assert.throws(() => parseHomeProductionPage(query), { status: 400 });
  }
});

test('all six verified DB roles read only their current ID in one RR readonly transaction', async () => {
  for (const rol of SYSTEM_USER_ROLES) {
    const m = fake({ user: { ...account, rol } });
    assert.deepEqual(await readHomeProductionPage(m.pool, auth, { period: '2026-10' }), payload());
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, HOME_PRODUCTION_PAGE_SQL, 'COMMIT']);
    assert.deepEqual(m.calls[1].values, [7]);
    assert.deepEqual(m.calls[2].values, [7, '2026-10-01', 0, 20]); assert.equal(m.releases, 1);
  }
  const m = fake(); await readHomeProductionPage(m.pool, auth, { period: '0001-01', offset: '3', limit: '1' });
  assert.deepEqual(m.calls[2].values, [7, '0001-01-01', 3, 1]);
});

test('malformed query and invalid auth fail before connect; revoked sessions roll back before production SQL', async () => {
  const query = { period: '2026-10' };
  for (const value of [null, {}, { id: '7', session_version: 3 }, { id: 0, session_version: 3 },
    { id: 2147483648, session_version: 3 }, { id: 7 }, { id: 7, session_version: '3' }]) {
    const m = fake(); await assert.rejects(readHomeProductionPage(m.pool, value, query), { status: 401 }); assert.equal(m.connects, 0);
  }
  const malformed = fake(); await assert.rejects(readHomeProductionPage(malformed.pool, auth, {}), { status: 400 }); assert.equal(malformed.connects, 0);
  for (const user of [null, { ...account, activo: false }, { ...account, session_version: 4 }]) {
    const m = fake({ user }); await assert.rejects(readHomeProductionPage(m.pool, auth, query), { status: 401 });
    assert.deepEqual(m.calls.map(call => call.sql), [begin, userSql, 'ROLLBACK']); assert.equal(m.releases, 1);
  }
  const unknown = fake({ user: { ...account, rol: 'custom' } });
  await assert.rejects(readHomeProductionPage(unknown.pool, auth, query), { status: 403 });
  assert.equal(unknown.calls.some(call => call.sql === HOME_PRODUCTION_PAGE_SQL), false);
});

test('missing result and query/commit failures never fabricate partial success and always release', async () => {
  for (const result of [{ rows: [] }, { rows: [{}] }, { rows: [{ production_page: null }] }]) {
    const m = fake({ result }); await assert.rejects(readHomeProductionPage(m.pool, auth, { period: '2026-10' }), /No se pudo leer/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
  for (const fail of [begin, userSql, HOME_PRODUCTION_PAGE_SQL, 'COMMIT']) {
    const m = fake({ fail, rollbackFail: true });
    await assert.rejects(readHomeProductionPage(m.pool, auth, { period: '2026-10' }), /Injected/);
    assert.equal(m.calls.at(-1).sql, 'ROLLBACK'); assert.equal(m.releases, 1);
  }
});

test('router retains existing routes and returns no-store for success and expected errors', async () => {
  for (const [options, request, code] of [[{}, {}, 200], [{}, { query: { period: 'bad' } }, 400],
    [{ user: null }, {}, 401], [{ user: { ...account, rol: 'unknown' } }, {}, 403]]) {
    const { res, forwarded } = await route(fake(options).pool)(request);
    assert.equal(res.code, code); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(forwarded, undefined);
    if (code !== 200) assert.deepEqual(Object.keys(res.body), ['error']);
  }
  const failed = await route(fake({ fail: HOME_PRODUCTION_PAGE_SQL }).pool)();
  assert.ok(failed.forwarded instanceof Error); assert.equal(failed.res.body, undefined);
});

test('SQL personal membership, visibility and production grouping are literally shared with initial home', () => {
  const between = (sql, start, end) => sql.slice(sql.indexOf(start), sql.indexOf(end)).replace(/\s+/g, ' ').trim().replace(/,$/, '');
  assert.equal(between(HOME_PRODUCTION_PAGE_SQL, 'visible AS MATERIALIZED', 'monthly_work AS'),
    between(PERSONAL_HOME_SQL, 'visible AS MATERIALIZED', 'open AS MATERIALIZED'));
  assert.equal(between(HOME_PRODUCTION_PAGE_SQL, 'monthly_production AS', 'page AS'),
    between(PERSONAL_HOME_SQL, 'monthly_production AS', 'monthly_production_client_page AS'));
  const sql = HOME_PRODUCTION_PAGE_SQL.replace(/\s+/g, ' ');
  assert.match(sql, /WHERE EXISTS \( SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=v.id AND a.usuario_id=\$1\)/);
  for (const marker of ['workspace', 'render_os', 'archivada_render_os', 'papelera_render_os']) assert.ok(sql.includes(marker));
  assert.match(sql, /t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE/);
  assert.match(sql, /FROM monthly_work m WHERE m.tipo_tarea='produccion'/);
  assert.doesNotMatch(sql, /asignado_a|colaboradores|autor|ILIKE|produccion_visitas|produccion_videos|publicaciones|historias/);
});

test('SQL uses requested month, Cordoba undated fallback and same task completion states; home remains current-month', () => {
  const sql = HOME_PRODUCTION_PAGE_SQL.replace(/\s+/g, ' ');
  assert.match(sql, /COALESCE\(m.fecha_vencimiento,\(m.updated_at AT TIME ZONE 'America\/Argentina\/Cordoba'\)::date\) >= \$2::date/);
  assert.match(sql, /< \(\$2::date\+interval '1 month'\)::date/);
  assert.match(sql, /'completed',\(SELECT count\(\*\)::int FROM monthly_production WHERE estado IN \('finalizada','publicada'\)\)/);
  assert.match(PERSONAL_HOME_SQL, />= date_trunc\('month',day.today\)::date/);
  assert.match(PERSONAL_HOME_SQL, /monthly_production_client_page AS[\s\S]*?ORDER BY total DESC,cliente_id ASC NULLS LAST LIMIT 20/);
});

test('SQL total/client_count independent of page and stable null-last grouping order with explicit closed DTO', () => {
  const sql = HOME_PRODUCTION_PAGE_SQL.replace(/\s+/g, ' ');
  assert.match(sql, /'total',\(SELECT count\(\*\)::int FROM monthly_production\)/);
  assert.match(sql, /'client_count',\(SELECT count\(\*\)::int FROM monthly_production_clients\)/);
  assert.match(sql, /'has_more',\(SELECT count\(\*\) FROM monthly_production_clients\)>\$3::integer\+\$4::integer/);
  assert.match(sql, /ORDER BY total DESC,cliente_id ASC NULLS LAST OFFSET \$3 LIMIT \$4/);
  assert.match(sql, /ORDER BY p.total DESC,p.cliente_id ASC NULLS LAST\) FROM page p/);
  assert.match(sql, /'client',CASE WHEN p.cliente_id IS NULL THEN NULL ELSE jsonb_build_object\('id',p.cliente_id,'nombre',p.cliente_nombre\) END/);
  const projection = sql.slice(sql.indexOf("SELECT jsonb_build_object('version'"))
    .replace(/estado IN \('finalizada','publicada'\)/g, 'completion_predicate');
  assert.deepEqual([...new Set([...projection.matchAll(/'([a-z_]+)'\s*,/g)].map(match => match[1]))].sort(),
    ['version', 'user', 'id', 'period', 'today', 'offset', 'limit', 'total', 'completed', 'client_count', 'has_more', 'clients', 'client', 'nombre'].sort());
  assert.doesNotMatch(projection, /metadata|propiedades_extra|to_json|importe|salario|abono|href/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER)\b/i);
  assert.equal((sql.match(/\bLIMIT\b/g) || []).length, 1);
});
