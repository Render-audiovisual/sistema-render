import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialSlots, normalizeEditorialPeriod, reconcileEditorialCalendar } from "../src/editorial-calendar.js";

test("distribuye cuotas sin superar cinco publicaciones por día", () => {
  const slots = buildEditorialSlots({ period: "2026-09", clients: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, nombre: `Cliente ${index}`, activo: true, cuota_reels: 4, cuota_carruseles: 4 })) });
  assert.equal(slots.length, 40);
  const totals = new Map();
  slots.forEach((slot) => totals.set(slot.fecha_programada, (totals.get(slot.fecha_programada) || 0) + 1));
  assert.ok([...totals.values()].every((total) => total <= 5));
});

test("respeta varios días preferidos y la ocupación fija", () => {
  const slots = buildEditorialSlots({ period: "2026-08", clients: [{ id: 7, nombre: "Bunker", activo: true, cuota_reels: 4, cuota_carruseles: 0, dias_reels: [2, 5] }], occupied: Array.from({ length: 5 }, (_, id) => ({ id, fecha_programada: "2026-08-04" })) });
  assert.ok(slots.every((slot) => [2, 5].includes(new Date(`${slot.fecha_programada}T00:00:00Z`).getUTCDay())));
  assert.ok(slots.every((slot) => slot.fecha_programada !== "2026-08-04"));
});

test("gastronomía prefiere domingos sin configuración", () => {
  const slots = buildEditorialSlots({ period: "2026-08", clients: [{ id: 1, nombre: "Pope", rubro: "Gastronomía", activo: true, cuota_reels: 2, cuota_carruseles: 0 }] });
  assert.ok(slots.every((slot) => new Date(`${slot.fecha_programada}T00:00:00Z`).getUTCDay() === 0));
});

test("rechaza períodos inválidos", () => assert.throws(() => normalizeEditorialPeriod("agosto"), /AAAA-MM/));

function fixture({existing=[],quota=1,user={id:7,rol:'admin',activo:true,session_version:2},fault=null}={}) {
  const trace=[],client={id:1,nombre:'QA calendar',activo:true,cuota_reels:quota,cuota_carruseles:0};
  const db={async query(sql,values){
    trace.push({sql,values});
    if(fault?.test(sql))throw Error('synthetic calendar failure');
    if(sql.includes('FROM usuarios WHERE'))return{rows:user?[user]:[]};
    if(sql.includes('SELECT c.id, c.nombre'))return{rows:[client]};
    if(sql.includes('AS protected_work'))return{rows:existing};
    if(sql.includes('INSERT INTO publicaciones'))return{rows:[{inserted:true}]};
    return{rows:[]};
  },release(error){trace.push({sql:'RELEASE',error});}};
  return{trace,db,pool:{connect:async()=>db}};
}

test('reconciler preserves archived and linked automatic pieces as occupied quota, never rescheduling or replacing them',async()=>{
  for(const extra of [{archived:true},{protected_work:true},{estado:'en_revision'}]) {
    const f=fixture({existing:[{id:4,cliente_id:1,tipo:'video',estado:'pendiente',origen_calendario:'automatico',
      calendario_clave:'2026-10:1:video:1',fecha_programada:'2026-10-20',...extra}]});
    const result=await reconcileEditorialCalendar(f.pool,'2026-10');
    assert.equal(result.preservadas,1);assert.equal(result.creadas,0);assert.equal(result.eliminadas,0);
    assert.equal(f.trace.some(row=>/INSERT INTO publicaciones|DELETE FROM publicaciones/.test(row.sql)),false);
    const lock=f.trace.findIndex(row=>row.sql.includes('ORDER BY id FOR UPDATE'));
    const projection=f.trace.findIndex(row=>row.sql.includes('AS protected_work'));
    assert.ok(lock>=0&&lock<projection,'preservation predicates are read after the piece lock wait');
    assert.equal(f.trace.at(-2).sql,'COMMIT');assert.equal(f.trace.at(-1).sql,'RELEASE');
  }
});

test('only empty unlinked generated stubs may be removed, and a late fault rolls back all scheduling work',async()=>{
  const existing=[{id:4,cliente_id:1,tipo:'video',estado:'pendiente',origen_calendario:'automatico',
    calendario_clave:'2026-10:1:video:9',fecha_programada:'2026-10-20',archived:false,protected_work:false}];
  const f=fixture({existing,quota:0});
  const result=await reconcileEditorialCalendar(f.pool,'2026-10');assert.equal(result.eliminadas,1);
  assert.deepEqual(f.trace.find(row=>row.sql.startsWith('DELETE FROM publicaciones')).values,[[4]]);
  const failing=fixture({fault:/INSERT INTO publicaciones/});
  await assert.rejects(reconcileEditorialCalendar(failing.pool,'2026-10'),/synthetic calendar failure/);
  assert.equal(failing.trace.some(row=>row.sql==='COMMIT'),false);assert.equal(failing.trace.at(-2).sql,'ROLLBACK');
});

test('HTTP actor is immutable before lease and denied current identity never reaches calendar rows',async()=>{
  for(const user of [null,{id:7,rol:'community',activo:true,session_version:2},{id:7,rol:'admin',activo:false,session_version:2}]) {
    const f=fixture({user});
    await assert.rejects(reconcileEditorialCalendar(f.pool,'2026-10',{actor:{id:7,rol:'admin',session_version:2}}),error=>[401,403].includes(error.status));
    assert.equal(f.trace.some(row=>row.sql.includes('FROM clientes c')),false);
  }
  const f=fixture({quota:0}),actor={id:7,rol:'admin',session_version:2};
  f.pool.connect=async()=>{actor.id=9;return f.db;};
  await reconcileEditorialCalendar(f.pool,'2026-10',{actor});
  assert.deepEqual(f.trace.find(row=>row.sql.includes('FROM usuarios WHERE')).values,[7]);
  assert.ok(f.trace[1].sql.includes('pg_advisory_xact_lock(20261019, 1)'));
});
