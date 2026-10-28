import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalPeriod, goalClients, prepareGoal, readGoals, reconcileMonthlyGoals, goalLinkOptions, linkGoalTask, createClientGoalsRouter } from '../src/client-goals.js';
import { assertQuotaRevision, goalQuotaObservation, goalPieceInQuota } from '../src/goal-quota-review.js';

const clone = value => structuredClone(value);
const auth = { id: 7, session_version: 2, rol: 'admin' };

test('period and reconciliation key reject malformed input before database access', async () => {
  const pool = { connect() { assert.fail('invalid input must not connect'); } };
  for (const period of ['2026-10\n','0000-10','2026-00','2026-13',' 2026-10','2026-1',202610,null,{},['2026-10']]) {
    assert.throws(() => goalPeriod(period), {status:400});
    await assert.rejects(prepareGoal(pool,{period,key:'cliente-1',responsibleIds:[7],quotaReview:{expected:'a'.repeat(64),auth}}),{status:400});
  }
  for (const key of ['cliente-1\n','grupo-01','cliente-0','cliente-2147483648','grupo-1x','otro-1',{},['cliente-1'],null]) {
    await assert.rejects(prepareGoal(pool,{period:'2026-10',key,responsibleIds:[7],quotaReview:{expected:'a'.repeat(64),auth}}),{status:400});
  }
  assert.equal(goalPeriod('0001-01'),'0001-01');
  assert.equal(goalPeriod('9999-12'),'9999-12');
});
function fixture({ quota = 2, stored = 1, slots = 1, role = 'admin', epoch = 2, active = true, failure } = {}) {
  const calls = [];
  const state = {
    source: [{ id: 1, nombre: 'Cuenta', cuota_reels: quota, cuota_carruseles: 0, agreement_version: 3 }],
    objective: { id: 9, clave: 'cliente-1', nombre: 'Mes', cuentas: [{ id: 1, nombre: 'Cuenta' }], reels: stored, carruseles: 0, periodo: '2026-10' },
    pieces: Array.from({ length: slots }, (_, i) => ({ id: i+10, objetivo_id: 9, tipo: 'video', numero: i+1,
      tarea_id: i+20, publicacion_id: null, titulo: 'Conservar', estado: 'pendiente', completada_at: null,
      updated_at: '2026-10-01T00:00:00.000Z', tarea_revision: 1 })),
    tasks: [], audits: [], actor: { id: 7, rol: role, session_version: epoch, activo: active },
  };
  let snapshot;
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('BEGIN')) { snapshot = clone(state); return { rows: [] }; }
      if (sql === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      if (failure && sql.includes(failure)) throw Error('injected failure');
      if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
      if (sql.startsWith('SELECT id,rol,activo,session_version')) return { rows: [clone(state.actor)] };
      if (sql.includes('FROM clientes c')) return { rows: clone(state.source) };
      if (sql.includes('FROM cliente_objetivo_responsables') || sql.startsWith('SELECT t.cliente_id')) return { rows: [] };
      if (sql.startsWith('SELECT id,nombre,usuario FROM usuarios')) return { rows: [{ id: 7, nombre: 'Responsable', usuario: 'qa' }] };
      if (sql.startsWith('SELECT * FROM cliente_objetivos_mensuales') || sql.startsWith('SELECT id,clave,nombre,cuentas')) return { rows: [clone(state.objective)] };
      if (sql.startsWith('SELECT reels,carruseles,cuentas')) return { rows: [clone(state.objective)] };
      if (sql.startsWith('SELECT p.id,p.')) return { rows: clone(state.pieces) };
      if (sql.startsWith('SELECT tipo,numero')) return { rows: clone(state.pieces) };
      if (sql.startsWith('SELECT id,tarea_id FROM cliente_objetivo_piezas')) return { rows: clone(state.pieces) };
      if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY') || sql.startsWith('SELECT id FROM cliente_objetivo_piezas WHERE id=ANY')) return { rows: [] };
      if (sql.startsWith('UPDATE cliente_objetivos_mensuales')) { state.objective.reels = params[1]; state.objective.carruseles = params[2]; return { rows: [] }; }
      if (sql.startsWith('INSERT INTO cliente_objetivo_cuota_revisiones')) { state.audits.push(clone(params)); return { rows: [] }; }
      if (sql.includes('SELECT t.*,p.tipo pieza_tipo') || sql.includes('FROM publicaciones p WHERE')) return { rows: [] };
      if (sql.startsWith('INSERT INTO tareas(')) {
        const task = { id: 100+state.tasks.length, titulo: params[0], estado: params[1], asignado_a: params[2], propiedades_extra: JSON.parse(params[7]) };
        state.tasks.push(task); return { rows: [task] };
      }
      if (sql.startsWith('INSERT INTO cliente_objetivo_piezas(')) {
        state.pieces.push({ id: 100+state.pieces.length, objetivo_id: params[0], tipo: params[1], numero: params[2], tarea_id: params[3], publicacion_id: params[4], estado: params[8] });
        return { rows: [] };
      }
      if (/^(INSERT INTO tarea_asignaciones|DELETE FROM tarea_asignaciones|INSERT INTO cliente_objetivo_responsables|DELETE FROM cliente_objetivo_responsables)/.test(sql)) return { rows: [] };
      throw Error(`Unexpected query: ${sql}`);
    },
    release(error) { calls.push({ sql: 'RELEASE', error }); },
  };
  const pool = { connect: async () => db, query: (...args) => db.query(...args) };
  const revision = () => goalQuotaObservation(goalClients(state.source)[0], state.objective, state.pieces, '2026-10').revision;
  const options = () => ({ period: '2026-10', key: 'cliente-1', responsibleIds: [7], actor: 'QA', persistResponsibles: true });
  const reconcile = (expected = revision(), observed = auth) => prepareGoal(pool, { ...options(), quotaReview: { expected, auth: observed } });
  return { state, calls, pool, revision, options, reconcile };
}

test('quota tokens reject nonstrings, uppercase, whitespace and final newline', () => {
  assertQuotaRevision('a'.repeat(64));
  for (const value of [null, undefined, 1, 'A'.repeat(64), 'a'.repeat(64)+'\n', 'a'.repeat(63), ' '+ 'a'.repeat(64)]) {
    assert.throws(() => assertQuotaRevision(value), { status: 400 });
  }
});

test('fingerprint observes monotonic source versions, membership, slot state/version/link without money', () => {
  const f = fixture(); const original = f.revision();
  f.state.source[0].abono_mensual = 999; assert.equal(f.revision(), original);
  f.state.source[0].agreement_version++; assert.notEqual(f.revision(), original);
  f.state.source[0].agreement_version--;
  for (const [key, value] of Object.entries({ estado: 'finalizada', updated_at: '2026-10-02', publicacion_id: 30, tarea_revision: 2 })) {
    const previous = f.state.pieces[0][key]; f.state.pieces[0][key] = value;
    assert.notEqual(f.revision(), original); f.state.pieces[0][key] = previous;
  }
  f.state.objective.cuentas.push({ id: 2 }); assert.notEqual(f.revision(), original);
});

test('piece quota is ordinal, format-specific, zero-safe and rejects malformed numbering', () => {
  for (const numero of [0, -1, 1.5, '1', null]) assert.throws(() => goalPieceInQuota({ tipo: 'video', numero }, { reels: 1 }), { status: 409 });
  assert.equal(goalPieceInQuota({ tipo: 'video', numero: 2 }, { reels: 1 }), false);
  assert.equal(goalPieceInQuota({ tipo: 'carrusel', numero: 1 }, { carruseles: 0 }), false);
  assert.equal(goalPieceInQuota({ tipo: 'video', numero: 1 }, { reels: 1 }), true);
});

test('fingerprint retains submillisecond slot version and shared feed agreement changes', () => {
  const f = fixture(); f.state.pieces[0].quota_piece_version = '2026-10-01 00:00:00.000001+00';
  const first = f.revision(); f.state.pieces[0].quota_piece_version = '2026-10-01 00:00:00.000002+00';
  assert.notEqual(f.revision(),first);
  f.state.source[0].grupo_feed_id = 8; f.state.source[0].cuota_feed_reels = 2;
  f.state.source[0].feed_agreement_version = 1;
  const shared = f.revision(); f.state.source[0].feed_agreement_version++;
  assert.notEqual(f.revision(),shared);
});

test('readGoals emits coherent snapshot, sanitized current/stored quota and en_cuota', async () => {
  const f = fixture({ quota: 1, stored: 2, slots: 3 });
  const [row] = (await readGoals(f.pool, '2026-10')).clientes;
  assert.equal(row.reels, 2); assert.deepEqual(row.cuota_actual, { reels: 1, carruseles: 0 });
  assert.equal(row.cuota_desactualizada, true); assert.equal(row.cuota_revision, f.revision());
  assert.deepEqual(row.piezas.map(piece => piece.en_cuota), [true,true,false]);
  assert.match(f.calls[0].sql, /REPEATABLE READ READ ONLY/);
  assert.equal(JSON.stringify(row).includes('agreement_version'), false);
  assert.equal(JSON.stringify(row).includes('abono'), false);
  f.state.source = [];
  const missing = (await readGoals(f.pool, '2026-10')).clientes[0];
  assert.equal(missing.cuota_actual, null); assert.equal(missing.cuota_revision, null);
});

test('normal prepare refuses drift and rolls back responsibility writes', async () => {
  const f = fixture(); const before = clone(f.state);
  await assert.rejects(prepareGoal(f.pool, f.options()), { status: 409 });
  assert.deepEqual(f.state, before); assert.equal(f.calls.at(-2).sql, 'ROLLBACK');
});

test('scheduler reports a decrease to zero as pending rather than silently skipping drift', async () => {
  const f = fixture({quota:0,stored:2}); const before = clone(f.state);
  const result = await reconcileMonthlyGoals(f.pool,'2026-10');
  assert.equal(result.pendientes.length,1); assert.match(result.pendientes[0].motivo,/reconciliar/);
  assert.deepEqual(f.state,before); assert.equal(f.calls.some(call=>call.sql.startsWith('UPDATE')),false);
});

test('review fills increased slots in same transaction, preserves original IDs and audits only quotas', async () => {
  const f = fixture(); const original = clone(f.state.pieces[0]);
  const result = await f.reconcile(); assert.equal(result.creadas, 1);
  assert.deepEqual(f.state.pieces[0], original); assert.equal(f.state.objective.reels, 2);
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.audits[0][1], auth.id);
  assert.equal(f.state.audits[0].at(-1).length, 64);
  const sql = f.calls.map(call => call.sql);
  const order = ['pg_advisory_xact_lock(8142, 1)', 'SELECT id,rol,activo', "hashtext('vinculo-objetivo-mensual')", 'hashtext($1)', 'SELECT * FROM cliente_objetivos_mensuales', 'SELECT id FROM tareas WHERE id=ANY', 'SELECT id FROM cliente_objetivo_piezas WHERE id=ANY', 'SELECT p.id,p.tipo,p.numero', 'UPDATE cliente_objetivos_mensuales', 'INSERT INTO tareas(', 'COMMIT'];
  let previous = -1;
  for (const fragment of order) { const index = sql.findIndex((value, i) => i > previous && value.includes(fragment)); assert.ok(index > previous, fragment); previous = index; }
});

test('decrease keeps all original slots/tasks and a later increase reuses their exact IDs', async () => {
  const f = fixture({ quota: 1, stored: 3, slots: 3 }); const originals = clone(f.state.pieces);
  await f.reconcile(); assert.deepEqual(f.state.pieces, originals); assert.equal(f.state.tasks.length, 0);
  f.state.source[0].cuota_reels = 3; f.state.source[0].agreement_version++;
  await f.reconcile(); assert.deepEqual(f.state.pieces, originals); assert.equal(f.state.tasks.length, 0);
});

test('stale confirmation, duplicate success and membership drift reject without committed mutation', async () => {
  const f = fixture(); const expected = f.revision(); await f.reconcile(expected);
  const after = clone(f.state); await assert.rejects(f.reconcile(expected), { status: 409 }); assert.deepEqual(f.state, after);
  const g = fixture(); g.state.objective.cuentas.push({ id: 2 }); const before = clone(g.state);
  await assert.rejects(g.reconcile(), { status: 409 }); assert.deepEqual(g.state, before);
});

test('review current actor rejects role/epoch/inactivity after the shared client mutex but before goal locks or DML', async () => {
  for (const settings of [{ role: 'community' }, { epoch: 3 }, { active: false }]) {
    const f = fixture(settings); await assert.rejects(f.reconcile(), { status: settings.role ? 403 : 401 });
    const sql=f.calls.map(call=>call.sql);
    assert.ok(sql.findIndex(value=>value.includes('pg_advisory_xact_lock(8142, 1)'))<sql.findIndex(value=>value.includes('SELECT id,rol,activo')));
    assert.equal(sql.some(value=>value.includes('hashtext(')),false);
    assert.equal(sql.some(value=>/^(?:INSERT|UPDATE|DELETE)\b/.test(value)),false);
  }
  for (const observed of [{ ...auth, id: null }, { ...auth, session_version: 0 }]) {
    const f = fixture(); await assert.rejects(f.reconcile(f.revision(), observed), { status: 401 });
  }
});

test('audit or generator failure rolls back quotas, slots and audit atomically', async () => {
  for (const failure of ['INSERT INTO cliente_objetivo_cuota_revisiones', 'INSERT INTO tareas(', 'INSERT INTO cliente_objetivo_piezas(']) {
    const f = fixture({ failure }); const before = clone(f.state);
    await assert.rejects(f.reconcile(), /injected failure/); assert.deepEqual(f.state, before);
    assert.equal(f.calls.at(-2).sql, 'ROLLBACK'); assert.equal(f.calls.at(-1).sql, 'RELEASE');
  }
});

test('fingerprint is recomputed after task and slot locks, not from unlocked discovery', async () => {
  const f = fixture(); const expected = f.revision(); const connect = f.pool.connect;
  f.pool.connect = async () => {
    const db = await connect(); const query = db.query.bind(db);
    db.query = async (sql, params) => {
      if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY')) f.state.pieces[0].tarea_revision++;
      return query(sql, params);
    };
    return db;
  };
  await assert.rejects(f.reconcile(expected), { status: 409 });
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE cliente_objetivos_mensuales')), false);
});

test('read snapshot and write transactions discard clients when rollback fails', async () => {
  for (const read of [true,false]) {
    const calls = []; const failure = Error('primary failure'), rollback = Error('rollback failure');
    const db = { async query(sql) {
      calls.push(sql);
      if (sql.startsWith('BEGIN')) return { rows: [] };
      if (sql === 'ROLLBACK') throw rollback;
      throw failure;
    }, release(error) { assert.equal(error, rollback); calls.push('discard'); } };
    const pool = { connect: async () => db };
    await assert.rejects(read ? readGoals(pool, '2026-10') : prepareGoal(pool, { period: '2026-10', key: 'cliente-1', responsibleIds: [7] }), error => error === failure);
    assert.equal(calls.at(-1), 'discard');
  }
});

test('link options bound candidate ordinals to stored quota and forged extra writes reject', async () => {
  const calls = [];
  const task = { id: 20, titulo: 'Video', subtipo: 'reel', estado: 'pendiente', cliente_id: 1,
    revision: 1, updated_at: '2026-10-01', propiedades_extra: { workspace: 'render_os' } };
  const db = { async query(sql, params = []) {
    calls.push({sql,params});
    if (sql.startsWith('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios')) return {rows:[{...auth,activo:true,nombre:'Persisted QA'}]};
    if (sql.includes('SELECT t.*,p.tipo pieza_tipo')) return {rows:[task]};
    if (sql.includes('p.id<>$1')) return {rows:[]};
    if (sql.startsWith('SELECT id,nombre,reels')) return {rows:[{id:9,reels:1,carruseles:0}]};
    if (sql.startsWith('SELECT p.id,p.tipo,p.numero')) { assert.match(sql,/p.numero <= \$3/); assert.equal(params[2],1); return {rows:[]}; }
    if (sql.startsWith('SELECT p.tarea_id,p.publicacion_id')) return {rows:[{tarea_id:21,clave:'cliente-1',periodo:'2026-10'}]};
    if (sql.startsWith('SELECT p.*,')) return {rows:[{id:10,numero:2,tipo:'video',reels:1,carruseles:0}]};
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|SELECT id FROM tareas|SELECT p.id FROM publicaciones|SELECT h.id FROM historias)/.test(sql)) return {rows:[]};
    throw Error(`Unexpected link query: ${sql}`);
  }, release() {} };
  await goalLinkOptions(db,20,'2026-10');
  await assert.rejects(linkGoalTask({connect:async()=>db},10,{tarea_id:20,expected_tarea_updated_at:'2026-10-01',expected_pieza_updated_at:'2026-10-01'},auth),{status:409});
  assert.equal(calls.some(call=>call.sql.startsWith('UPDATE')),false);
  const source = readFileSync(new URL('../src/client-goals.js',import.meta.url),'utf8');
  assert.match(source,/FROM cliente_objetivo_piezas WHERE objetivo_id=\$1 AND tipo=\$2 AND numero <= \$3/);
});

test('router exposes admin-only reconciliation, closed payload and real prepare validation', async () => {
  const f = fixture(); const router = createClientGoalsRouter({ pool: f.pool });
  const route = router.stack.find(layer => layer.route?.path === '/reconciliar').route;
  let status; let payload; const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
  route.stack[0].handle({ auth: { ...auth, rol: 'community' } }, res, () => assert.fail('must deny'));
  assert.equal(status, 403);
  await route.stack.at(-1).handle({ auth, body: { periodo: '2026-10', clave: 'cliente-1', responsables: [7], expected_quota_revision: f.revision() } }, res, error => { throw error; });
  assert.equal(payload.creadas, 1);
  await route.stack.at(-1).handle({ auth, body: { abono_mensual: 1 } }, res, error => { throw error; });
  assert.equal(status, 400);
});

test('migration is additive minimal audit with restrictive references and FK indexes', () => {
  const sql = readFileSync(new URL('../migrations/077_goal_quota_reviews.sql', import.meta.url), 'utf8');
  assert.match(sql, /REFERENCES cliente_objetivos_mensuales\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.equal((sql.match(/CREATE INDEX/g) || []).length, 2);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /abono|importe|payload|JSONB/i);
});
