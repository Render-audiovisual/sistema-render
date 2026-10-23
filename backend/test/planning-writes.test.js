import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanningCheck, normalizeSpecialDatePatch, PLANNING_CHECK_SQL, SPECIAL_DATE_PATCH_SQL, savePlanningCheck, updateSpecialDate } from '../src/planning-writes.js';

// Real normalizers, authority helpers and writer callbacks; fake leased DB only.
const auth = Object.freeze({ id: 17, session_version: 3, rol: 'admin', nombre: 'Cached name' });
const actor = Object.freeze({ id: 17, session_version: 3, rol: 'admin', activo: true, nombre: ' Current name ', usuario: 'current-login' });
const validCheck = () => ({ cliente_id: 2, fecha: '2026-10-20', publicado: true });
const ACTOR = 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE';
const MUTEX = 'SELECT pg_advisory_xact_lock(8142, 1)';
const CLIENT = 'SELECT id FROM clientes WHERE id=$1 FOR SHARE';
const resultRow = Object.freeze({ id: 8, estado: 'hecho', idea: 'Observed', fecha: '2026-10-20' });
function fixture({ currentActor = actor, clientExists = true, row = resultRow, failAt, rollbackFailure, leaseFailure, holdCommit = false } = {}) {
  const calls = [], released = []; let leases = 0, releaseCommit;
  const failure = Error('query failed');
  const db = { async query(sql, values) {
    const stage = sql === 'BEGIN' ? 'begin' : sql === MUTEX ? 'mutex' : sql === ACTOR ? 'actor' : sql === CLIENT ? 'client' : [PLANNING_CHECK_SQL, SPECIAL_DATE_PATCH_SQL].includes(sql) ? 'write' : sql === 'COMMIT' ? 'commit' : sql === 'ROLLBACK' ? 'rollback' : 'unknown';
    assert.notEqual(stage, 'unknown', sql); calls.push({ sql, values, stage });
    if (stage === 'rollback' && rollbackFailure) throw rollbackFailure;
    if (stage === failAt) throw failure;
    if (stage === 'actor') return { rows: currentActor ? [currentActor] : [] };
    if (stage === 'client') return { rows: clientExists ? [{ id: 2 }] : [] };
    if (stage === 'write') return { rows: row ? [row] : [] };
    if (stage === 'commit' && holdCommit) await new Promise(resolve => { releaseCommit = resolve; });
    return { rows: [] };
  }, release: reason => released.push(reason) };
  const pool = { async connect() { leases++; if (leaseFailure) throw leaseFailure; return db; }, query: () => assert.fail('All operations must use the transaction lease') };
  return { pool, db, calls, released, failure, leases: () => leases, releaseCommit: () => releaseCommit() };
}
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const writers = {
  check: (pool, observed = auth) => savePlanningCheck(pool, observed, validCheck()),
  special: (pool, observed = auth) => updateSpecialDate(pool, observed, '8', { estado: 'hecho', idea: 'Observed' }),
};

test('check normalizer requires numeric int32, exact real calendar date and strict boolean; freezes a detached projection', () => {
  const body = validCheck(), normalized = normalizePlanningCheck(body); assert.deepEqual(normalized, body); assert.equal(Object.isFrozen(normalized), true);
  body.fecha = '2026-11-01'; assert.equal(normalized.fecha, '2026-10-20');
  for (const id of [1, 2147483647]) assert.equal(normalizePlanningCheck({ ...validCheck(), cliente_id: id }).cliente_id, id);
  for (const date of ['0001-01-01', '2024-02-29', '2000-02-29', '9999-12-31']) assert.equal(normalizePlanningCheck({ ...validCheck(), fecha: date }).fecha, date);
  for (const value of [undefined, null, '2', 0, -1, 1.5, NaN, Infinity, 2147483648]) assert.throws(() => normalizePlanningCheck({ ...validCheck(), cliente_id: value }), e => e.status === 400);
  for (const value of [undefined, null, '', '0000-01-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00', '2026-1-01', '2026-10-20T00:00:00Z', '2026-10-20\n', new Date()]) assert.throws(() => normalizePlanningCheck({ ...validCheck(), fecha: value }), e => e.status === 400);
  for (const value of [undefined, null, 0, 1, 'true', 'false', [], {}]) assert.throws(() => normalizePlanningCheck({ ...validCheck(), publicado: value }), e => e.status === 400);
  assert.equal(normalizePlanningCheck({ ...validCheck(), publicado: false }).publicado, false);
  for (const key of ['cliente_id', 'fecha', 'publicado']) { const partial = validCheck(); delete partial[key]; assert.throws(() => normalizePlanningCheck(partial)); }
});
test('both normalizers reject nonplain, empty and unknown-field bodies including forged confirmer', () => {
  for (const body of [null, undefined, [], '', 1, new Date(), {}, Object.create({ idea: 'inherited' })]) {
    assert.throws(() => normalizePlanningCheck(body), e => e.status === 400); assert.throws(() => normalizeSpecialDatePatch('8', body), e => e.status === 400);
  }
  for (const key of ['confirmado_por', 'confirmado_at', 'actor_id', 'id', 'unknown']) assert.throws(() => normalizePlanningCheck({ ...validCheck(), [key]: 'Forged' }), e => e.status === 400);
  for (const key of ['id', 'cliente_id', 'fecha', 'confirmado_por', 'unknown']) assert.throws(() => normalizeSpecialDatePatch('8', { idea: '', [key]: 'Forged' }), e => e.status === 400);
  const plainNull = Object.assign(Object.create(null), validCheck()); assert.deepEqual(normalizePlanningCheck(plainNull), validCheck());
});
test('special normalizer requires canonical route int32, closed nonempty patch and exact state/text; omission is null not empty', () => {
  for (const id of ['1', '2147483647']) assert.equal(normalizeSpecialDatePatch(id, { idea: '' }).id, Number(id));
  for (const id of [8, null, undefined, '', '0', '-1', '+8', '08', '8.0', '8e0', '8\n', '2147483648']) assert.throws(() => normalizeSpecialDatePatch(id, { idea: '' }), e => e.status === 400);
  for (const estado of ['pendiente', 'en_curso', 'hecho']) assert.deepEqual(normalizeSpecialDatePatch('8', { estado }), { id: 8, estado, idea: null });
  for (const estado of [undefined, null, '', 'publicada', 'HECHO', 0]) assert.throws(() => normalizeSpecialDatePatch('8', { estado }), e => e.status === 400);
  for (const idea of [null, undefined, 1, {}, [], 'x\0y']) assert.throws(() => normalizeSpecialDatePatch('8', { idea }), e => e.status === 400);
  const body = { idea: '' }, normalized = normalizeSpecialDatePatch('8', body); assert.deepEqual(normalized, { id: 8, estado: null, idea: '' }); assert.equal(Object.isFrozen(normalized), true);
  body.idea = 'later'; assert.equal(normalized.idea, '');
});
test('SQL uses database clock for true and clears confirmer/time for false; special omitted fields use COALESCE', () => {
  assert.match(PLANNING_CHECK_SQL, /CASE WHEN \$3 THEN clock_timestamp\(\) ELSE NULL END/);
  assert.match(PLANNING_CHECK_SQL, /confirmado_por=EXCLUDED.confirmado_por,confirmado_at=EXCLUDED.confirmado_at/);
  assert.match(PLANNING_CHECK_SQL, /ON CONFLICT \(cliente_id,fecha\)/);
  assert.match(SPECIAL_DATE_PATCH_SQL, /estado=COALESCE\(\$1,estado\),idea=COALESCE\(\$2,idea\)/);
  assert.match(SPECIAL_DATE_PATCH_SQL, /WHERE id=\$3 RETURNING/);
  for (const sql of [PLANNING_CHECK_SQL, SPECIAL_DATE_PATCH_SQL]) assert.doesNotMatch(sql, /RETURNING\s+\*|DELETE|INSERT INTO tareas|UPDATE usuarios/i);
});
test('writers use BEGIN/mutex/current actor before domain DML and return only after COMMIT', async () => {
  for (const [kind, run] of Object.entries(writers)) {
    const f = fixture({ holdCommit: true }); let settled = false;
    const pending = run(f.pool).then(value => { settled = true; return value; }); await settle();
    assert.equal(settled, false); assert.deepEqual(f.released, []);
    assert.deepEqual(f.calls.map(c => c.stage), kind === 'check' ? ['begin', 'mutex', 'actor', 'client', 'write', 'commit'] : ['begin', 'mutex', 'actor', 'write', 'commit']);
    assert.deepEqual(f.calls[2].values, [17]); f.releaseCommit(); assert.equal(await pending, resultRow); assert.deepEqual(f.released, [undefined]);
    assert.equal(f.calls.filter(c => c.stage === 'write').length, 1);
  }
});
test('check true uses only current database actor name/login/ID fallback; false always clears attribution', async () => {
  for (const [nombre, usuario, expected] of [[' Current ', 'login', 'Current'], [' ', ' login ', 'login'], [null, '', 'Usuario 17'], [123, {}, 'Usuario 17']]) for (const publicado of [true, false]) {
    const f = fixture({ currentActor: { ...actor, nombre, usuario } }); await savePlanningCheck(f.pool, auth, { ...validCheck(), publicado });
    assert.deepEqual(f.calls.find(c => c.stage === 'write').values, [2, '2026-10-20', publicado, publicado ? expected : null]);
    assert.deepEqual(f.calls.find(c => c.stage === 'client').values, [2]);
  }
});
test('special writer parameters preserve explicit empty idea and omitted fields; missing targets reject404', async () => {
  for (const [body, expected] of [[{ idea: '' }, [null, '', 8]], [{ estado: 'en_curso' }, ['en_curso', null, 8]]]) {
    const f = fixture(); await updateSpecialDate(f.pool, auth, '8', body); assert.deepEqual(f.calls.find(c => c.stage === 'write').values, expected);
  }
  const special = fixture({ row: null }); await assert.rejects(writers.special(special.pool), e => e.status === 404); assert.equal(special.calls.at(-1).stage, 'rollback');
  const client = fixture({ clientExists: false }); await assert.rejects(writers.check(client.pool), e => e.status === 404); assert.deepEqual(client.calls.map(c => c.stage), ['begin', 'mutex', 'actor', 'client', 'rollback']);
});
test('invalid inputs and invalid captured identity fail before any lease; caller role cannot grant authority', async () => {
  for (const run of Object.values(writers)) for (const key of ['id', 'session_version']) for (const value of [null, undefined, '17', 0, -1, 1.5, Infinity, 2147483648]) {
    const f = fixture(); await assert.rejects(run(f.pool, { ...auth, [key]: value }), e => e.status === 401); assert.equal(f.leases(), 0);
  }
  for (const run of [pool => savePlanningCheck(pool, auth, { ...validCheck(), confirmado_por: 'fake' }), pool => updateSpecialDate(pool, auth, '08', { idea: '' }), pool => updateSpecialDate(pool, auth, '8', {})]) {
    const f = fixture(); await assert.rejects(run(f.pool), e => e.status === 400); assert.equal(f.leases(), 0);
  }
  const f = fixture(); await writers.check(f.pool, { ...auth, rol: 'not-admin', nombre: 'forged' }); assert.equal(f.calls.find(c => c.stage === 'write').values[3], 'Current name');
});
test('auth and normalized input are detached before awaiting lease, including special empty text', async () => {
  for (const kind of ['check', 'special']) {
    const f = fixture(), observed = { ...auth }, body = kind === 'check' ? validCheck() : { estado: 'hecho', idea: '' }; let release;
    const pool = { connect: () => new Promise(resolve => { release = resolve; }) };
    const pending = kind === 'check' ? savePlanningCheck(pool, observed, body) : updateSpecialDate(pool, observed, '8', body);
    observed.id = 99; observed.session_version = 99; observed.nombre = 'forged';
    if (kind === 'check') { body.cliente_id = 99; body.fecha = '2026-11-01'; body.publicado = false; } else { body.estado = 'pendiente'; body.idea = 'mutated'; }
    release(f.db); await pending; assert.deepEqual(f.calls[2].values, [17]);
    assert.deepEqual(f.calls.find(c => c.stage === 'write').values, kind === 'check' ? [2, '2026-10-20', true, 'Current name'] : ['hecho', '', 8]);
  }
});
test('revocation/role changes reject before domain queries, rollback and release', async () => {
  for (const run of Object.values(writers)) for (const currentActor of [null, { ...actor, id: 99 }, { ...actor, activo: false }, { ...actor, session_version: 4 }, { ...actor, session_version: '3' }, { ...actor, rol: 'diseno' }]) {
    const f = fixture({ currentActor }); await assert.rejects(run(f.pool), e => e.status === (currentActor?.rol === 'diseno' ? 403 : 401));
    assert.deepEqual(f.calls.map(c => c.stage), ['begin', 'mutex', 'actor', 'rollback']); assert.deepEqual(f.released, [undefined]);
  }
});
test('faults at every stage rollback once; broken rollback discards lease without replacing primary error', async () => {
  for (const [kind, run] of Object.entries(writers)) for (const failAt of ['begin', 'mutex', 'actor', ...(kind === 'check' ? ['client'] : []), 'write', 'commit']) for (const brokenRollback of [false, true]) {
    const rollbackFailure = brokenRollback ? Error('rollback failed') : undefined, f = fixture({ failAt, rollbackFailure });
    await assert.rejects(run(f.pool), error => error === f.failure); assert.equal(f.calls.at(-1).stage, 'rollback');
    assert.equal(f.calls.filter(c => c.stage === 'rollback').length, 1); assert.deepEqual(f.released, [rollbackFailure]);
    assert.ok(f.calls.filter(c => c.stage === 'write').length <= 1, 'No extra DML/retry after failure');
  }
});
test('lease failure propagates without operating on or releasing nonexistent connection', async () => {
  for (const run of Object.values(writers)) { const leaseFailure = Error('pool failed'), f = fixture({ leaseFailure }); await assert.rejects(run(f.pool), error => error === leaseFailure); assert.deepEqual(f.calls, []); assert.deepEqual(f.released, []); }
});
