import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientCatalogSnapshot, CLIENT_CATALOG_SQL } from '../src/client-catalog.js';
import { clientOperationalDto } from '../src/operational-dto.js';

const auth = () => ({ id: 7, rol: 'admin', session_version: 3, nombre: 'Untrusted HTTP name' });
const row = () => ({ id: 19, nombre: 'Synthetic client', activo: true, cuota_reels: 2, cuota_carruseles: 1,
  configuracion_completa: true, dias_historias: [1, 3], abono_mensual: '123.45', agreement_revision: 'private-canary',
  unknown_private: 'never staff' });
function fixture({ actor = { id: 7, rol: 'admin', activo: true, session_version: 3 }, rows = [row()], fault, rollbackFault, onConnect } = {}) {
  const calls = [], releases = []; let connects = 0;
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql === 'ROLLBACK' && rollbackFault) throw rollbackFault;
    if (fault && fault(sql)) throw fault.error;
    if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return { rows: actor ? [actor] : [] };
    if (sql === CLIENT_CATALOG_SQL) return { rows };
    assert.ok(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(sql), 'Unexpected SQL');
    return { rows: [] };
  }, release(error) { releases.push(error); } };
  const pool = { async connect() { connects++; await onConnect?.(); return db; }, query() { assert.fail('No pool query outside the snapshot'); } };
  return { pool, calls, releases, get connects() { return connects; } };
}

test('catalog reads actor then commercial rows in one RR readonly transaction and commits before release', async () => {
  const rows = [row()], f = fixture({ rows });
  const result = await loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01');
  assert.deepEqual(f.calls.map(c => c.sql), ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', CLIENT_CATALOG_SQL, 'COMMIT']);
  assert.deepEqual(f.calls[1].values, [7]); assert.deepEqual(f.calls[2].values, ['2026-10-01']);
  assert.deepEqual(result, rows); assert.equal(f.connects, 1); assert.deepEqual(f.releases, [undefined]);
  for (const call of f.calls) assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/i);
});

test('auth ID, exact role and epoch are captured before awaited connect; caller mutation cannot change projection', async () => {
  const observed = { id: 7, rol: 'edicion', session_version: 3, nombre: 'caller' }, actor = { ...observed, activo: true };
  const raw = row(), f = fixture({ actor, rows: [raw], onConnect: () => {
    observed.id = 99; observed.rol = 'admin'; observed.session_version = 99; observed.nombre = 'replacement';
  } });
  const result = await loadClientCatalogSnapshot(f.pool, observed, '2026-10-01');
  assert.deepEqual(f.calls[1].values, [7]); assert.deepEqual(result, [clientOperationalDto(raw, actor)]);
  assert.equal(Object.hasOwn(result[0], 'abono_mensual'), false); assert.equal(Object.hasOwn(result[0], 'agreement_revision'), false);
  assert.equal(Object.hasOwn(result[0], 'unknown_private'), false); assert.equal(result[0].nombre, raw.nombre);
});

test('invalid identity/epoch or empty role fails before acquiring connection, without a role whitelist', async () => {
  const invalid = [0, -1, 1.5, '7', 2147483648, NaN, Infinity, null, undefined];
  for (const field of ['id', 'session_version']) for (const value of invalid) {
    const f = fixture(); await assert.rejects(loadClientCatalogSnapshot(f.pool, { ...auth(), [field]: value }, '2026-10-01'), { status: 401 });
    assert.equal(f.connects, 0); assert.deepEqual(f.calls, []);
  }
  for (const rol of ['', '  ', null, 7]) {
    const f = fixture(); await assert.rejects(loadClientCatalogSnapshot(f.pool, { ...auth(), rol }, '2026-10-01'), { status: 401 }); assert.equal(f.connects, 0);
  }
  for (const rol of ['custom-observed-role', ' admin ']) {
    const actor = { id: 2147483647, rol, activo: true, session_version: 2147483647 }, f = fixture({ actor });
    const result = await loadClientCatalogSnapshot(f.pool, actor, '2026-10-01');
    assert.deepEqual(result, [clientOperationalDto(row(), actor)]); assert.equal(Object.hasOwn(result[0], 'abono_mensual'), false);
  }
});

test('missing, inactive, changed-role/epoch/ID actor rejects before catalog SQL and rolls back', async () => {
  const current = { id: 7, rol: 'admin', activo: true, session_version: 3 };
  for (const actor of [null, { ...current, activo: false }, { ...current, activo: null }, { ...current, id: 8 },
    { ...current, rol: 'edicion' }, { ...current, rol: ' admin ' }, { ...current, session_version: 4 }]) {
    const f = fixture({ actor }); await assert.rejects(loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01'), { status: 401 });
    assert.equal(f.calls.some(c => c.sql === CLIENT_CATALOG_SQL), false);
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.releases, [undefined]);
  }
});

test('query/commit faults roll back and release once; failed rollback discards connection without replacing original error', async () => {
  for (const point of ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', CLIENT_CATALOG_SQL, 'COMMIT']) {
    for (const brokenRollback of [false, true]) {
      const original = new Error('synthetic query failure'), rollback = new Error('synthetic rollback failure');
      const fault = sql => sql === point; fault.error = original;
      const f = fixture({ fault, rollbackFault: brokenRollback ? rollback : undefined });
      await assert.rejects(loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01'), error => error === original);
      assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.releases, [brokenRollback ? rollback : undefined]);
    }
  }
});

function feedSnapshot(extra={}) {
  return {version:1,source:'meta_graph_feed',clientId:19,igUserId:'119',username:'synthetic',period:'2026-10',
    windowStart:'2026-09-01T03:00:00.000Z',checkedAt:'2026-10-29T15:00:00.000Z',
    posts:[{id:'900',kind:'reel',publishedAt:'2026-10-05T15:00:00.000Z',financial_canary:'never return'}],
    financial_canary:'never return',...extra};
}
test('feed evidence is part of the same catalog query and ties system actor, client, account and month',()=>{
  assert.match(CLIENT_CATALOG_SQL,/LEFT JOIN instagram_cuentas instagram_account ON instagram_account.cliente_id=c.id/);
  for(const condition of ["ia.integracion='instagram_graph'","ia.canal='system'","ia.actor_id='render-worker'","ia.accion='feed_snapshot_v1'","ia.resultado='ok'","ia.detalles->>'clientId'=c.id::text","ia.detalles->>'igUserId'=instagram_account.ig_user_id","ia.detalles->>'period'=to_char($1::date,'YYYY-MM')"])
    assert.ok(CLIENT_CATALOG_SQL.includes(condition));
  assert.match(CLIENT_CATALOG_SQL,/ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1\s*\) instagram_feed ON TRUE/);
});
test('new feed fields are closed after DTO without changing existing financial role projection',async()=>{
  for(const rol of ['admin','edicion']){
    const actor={id:7,rol,activo:true,session_version:3};
    const raw={...row(),instagram_account_id:'119',instagram_account_active:true,instagram_feed_snapshot:feedSnapshot()};
    const f=fixture({actor,rows:[raw]});
    const [result]=await loadClientCatalogSnapshot(f.pool,actor,'2026-10-01');
    const clean=result.instagram_feed_snapshot;
    assert.equal(clean.posts.length,1);assert.equal(clean.financial_canary,undefined);assert.equal(clean.posts[0].financial_canary,undefined);
    assert.equal(result.instagram_account_id,'119');assert.equal(result.instagram_account_active,true);
    const baseline=clientOperationalDto(raw,actor);
    for(const field of ['instagram_account_id','instagram_account_active','instagram_feed_snapshot']){delete result[field];delete baseline[field];}
    assert.deepEqual(result,baseline);
    assert.equal(Object.hasOwn(result,'abono_mensual'),rol==='admin');
    assert.equal(Object.hasOwn(result,'agreement_revision'),rol==='admin');
    assert.equal(f.calls.length,4);assert.equal(f.calls.filter(c=>c.sql===CLIENT_CATALOG_SQL).length,1);
  }
});
test('wrong account, client, month or malformed feed never leaves raw audit data in admin DTO',async()=>{
  for(const change of [{igUserId:'120'},{clientId:20},{period:'2026-09'},{version:2},{source:'manual'},{posts:[{id:'bad'}]}]){
    const raw={...row(),instagram_account_id:'119',instagram_account_active:true,instagram_feed_snapshot:feedSnapshot(change)};
    const [result]=await loadClientCatalogSnapshot(fixture({rows:[raw]}).pool,auth(),'2026-10-01');
    assert.equal(Object.hasOwn(result,'instagram_feed_snapshot'),false);
  }
  const raw={...row(),instagram_account_id:null,instagram_account_active:null,instagram_feed_snapshot:feedSnapshot()};
  const [result]=await loadClientCatalogSnapshot(fixture({rows:[raw]}).pool,auth(),'2026-10-01');
  assert.equal(Object.hasOwn(result,'instagram_feed_snapshot'),false);assert.equal(Object.hasOwn(result,'instagram_account_id'),false);
});
