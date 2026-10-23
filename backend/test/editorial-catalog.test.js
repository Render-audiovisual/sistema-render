import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITORIAL_CATALOG_SQL, loadEditorialCatalogSnapshot as load } from '../src/editorial-catalog.js';

const BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const ACTOR = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
const auth = Object.freeze({ id: 17, rol: 'admin', session_version: 3 });
const current = Object.freeze({ ...auth, activo: true });
const eventId = '11111111-1111-4111-8111-111111111111';
const instant = '2026-10-20T12:00:00.000Z';
const row = Object.freeze({ id: 5, cliente_id: 2, cliente_nombre: 'QA', estado: 'publicada', fecha_programada: '2026-10-20', fecha_publicación_real: instant,
  idea: 'Visible', copy: 'Copy', internal_only: 'private root', metadata: Object.freeze({ hora: '12:00', tipo: 'Promo', private_key: 'secret', nested: { secret: 'secret' } }) });
const proof = domain => ({ piece_id: 5, piece_cliente_id: 2, piece_estado: 'publicada', piece_fecha_programada: '2026-10-20', piece_actual_at: instant,
  piece_archived: false, cliente_activo: true, revision: 4, current_event_id: eventId, event_id: eventId, event_dominio: domain,
  event_pieza_id: 5, event_cliente_id: 2, event_actor_id: 17, event_action: 'confirmar', event_source: 'manual', event_occurred_at: instant, event_recorded_at: instant });
function fixture({ actor = current, rows = [row], failAt, rollbackFailure, leaseFailure, proofOverride = {} } = {}) {
  const calls = [], released = []; let leases = 0;
  const failure = Error('simulated query failure');
  const db = { async query(sql, values) {
    const stage = sql === BEGIN ? 'begin' : sql === ACTOR ? 'actor' : Object.values(EDITORIAL_CATALOG_SQL).includes(sql) ? 'catalog' : sql === 'COMMIT' ? 'commit' : sql === 'ROLLBACK' ? 'rollback' : 'evidence';
    calls.push({ sql, values, stage });
    if (stage === 'rollback' && rollbackFailure) throw rollbackFailure;
    if (stage === failAt) throw failure;
    if (stage === 'actor') return { rows: actor ? [actor] : [] };
    if (stage === 'catalog') return { rows };
    if (stage === 'evidence') {
      assert.match(sql, /SELECT p\.id AS piece_id/); assert.match(sql, /LEFT JOIN editorial_publicacion_versiones/); assert.match(sql, /LEFT JOIN editorial_publicacion_eventos/);
      assert.match(sql, /WHERE p\.id=ANY\(\$2::int\[\]\)/); assert.deepEqual(values[1], [5]);
      assert.match(sql, new RegExp(`FROM ${values[0] === 'historia' ? 'historias' : 'publicaciones'} p`));
      return { rows: [{ ...proof(values[0]), ...proofOverride }] };
    }
    assert.ok(['begin', 'commit', 'rollback'].includes(stage)); return { rows: [] };
  }, release: reason => released.push(reason) };
  const pool = { async connect() { leases++; if (leaseFailure) throw leaseFailure; return db; }, query: () => assert.fail('Never query pool outside leased snapshot') };
  return { pool, db, calls, released, failure, leases: () => leases };
}

test('constant SQL preserves explicit story/publication fields, archive predicates and stable ordering', () => {
  assert.equal(Object.isFrozen(EDITORIAL_CATALOG_SQL), true); assert.deepEqual(Object.keys(EDITORIAL_CATALOG_SQL), ['historia', 'publicacion']);
  const shared = ['id', 'cliente_id', 'estado', 'idea', 'copy', 'material_referencia', 'aclaraciones', 'prioridad', 'responsable', 'metadata', 'created_at', 'updated_at'];
  for (const [domain, alias, table] of [['historia', 'h', 'historias'], ['publicacion', 'p', 'publicaciones']]) {
    const sql = EDITORIAL_CATALOG_SQL[domain];
    for (const field of shared) assert.match(sql, new RegExp(`\\b${alias}\\.${field}\\b`));
    assert.match(sql, new RegExp(`FROM ${table} ${alias} JOIN clientes c ON c.id=${alias}.cliente_id`));
    assert.match(sql, new RegExp(`ORDER BY ${alias}.fecha_programada DESC,${alias}.id$`)); assert.doesNotMatch(sql, /SELECT\s+\*|\b[hp]\.\*|FOR UPDATE|INSERT|DELETE|UPDATE\s/i);
  }
  for (const field of ['responsable_planificacion', 'responsable_diseño', 'responsable_revisión', 'responsable_publicacion', 'fecha_planificacion_inicio', 'fecha_diseño_inicio', 'fecha_diseño_entrega', 'fecha_revisión_inicio', 'fecha_revisión_aprobación', 'fecha_publicación_real', 'notas_planificacion', 'notas_diseño', 'notas_revisión', 'notas_bloqueador']) assert.ok(EDITORIAL_CATALOG_SQL.historia.includes(`h.${field}`), field);
  for (const field of ['tipo', 'duracion_segundos', 'num_imagenes', 'responsable_diseño', 'responsable_edición', 'responsable_revisión', 'responsable_publicacion', 'fecha_diseño_entrega', 'fecha_edición_entrega', 'fecha_revisión_aprobación', 'fecha_publicación_real', 'origen_calendario', 'calendario_clave', 'fecha_bloqueada']) assert.ok(EDITORIAL_CATALOG_SQL.publicacion.includes(`p.${field}`), field);
  assert.match(EDITORIAL_CATALOG_SQL.historia, /WHERE h.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'/);
  assert.match(EDITORIAL_CATALOG_SQL.publicacion, /WHERE \$1::boolean OR p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'/);
});
test('both domains use real evidence annotation in same RR snapshot; verified admin preserves existing raw fields', async () => {
  for (const domain of ['historia', 'publicacion']) for (const includeArchived of [false, true]) {
    const f = fixture(), result = await load(f.pool, auth, domain, { includeArchived });
    assert.deepEqual(f.calls.map(c => c.stage), ['begin', 'actor', 'catalog', 'evidence', 'commit']);
    assert.deepEqual(f.calls[1], { sql: ACTOR, values: [17], stage: 'actor' });
    assert.equal(f.calls[2].sql, EDITORIAL_CATALOG_SQL[domain]); assert.deepEqual(f.calls[2].values, domain === 'publicacion' ? [includeArchived] : []);
    assert.equal(result[0].internal_only, 'private root'); assert.deepEqual(result[0].metadata, row.metadata);
    assert.deepEqual(result[0].publicacion_evidencia, { classification: 'confirmada_manualmente', revision: 4, confirmation: { id: eventId, actor_id: 17, occurred_at: instant, recorded_at: instant, source: 'manual' } });
    assert.equal(Object.hasOwn(row, 'publicacion_evidencia'), false); assert.deepEqual(f.released, [undefined]);
  }
});
test('verified nonadmin has closed operational root/metadata while real evidence remains equal to admin', async () => {
  for (const domain of ['historia', 'publicacion']) {
    const admin = await load(fixture().pool, auth, domain);
    const observed = { ...auth, rol: 'diseno' }, f = fixture({ actor: { ...observed, activo: true } });
    const result = await load(f.pool, observed, domain);
    assert.equal(result[0].internal_only, undefined); assert.deepEqual(result[0].metadata, { hora: '12:00', tipo: 'Promo' });
    assert.deepEqual(result[0].publicacion_evidencia, admin[0].publicacion_evidencia); assert.equal(result[0].idea, row.idea);
    assert.doesNotMatch(JSON.stringify(result), /private root|private_key|secret|nested/);
  }
});
test('real annotation rejects inconsistent proof rather than manufacturing manual confirmation', async () => {
  const f = fixture({ proofOverride: { event_cliente_id: 99 } });
  assert.deepEqual((await load(f.pool, auth, 'historia'))[0].publicacion_evidencia, { classification: 'historica_sin_confirmacion', revision: 4, confirmation: null });
});
test('invalid own domain, options and captured authority fail before acquiring lease', async () => {
  for (const domain of ['toString', '__proto__', 'constructor', '', 'historias', 'publicaciones', null, undefined]) {
    const f = fixture(); await assert.rejects(load(f.pool, auth, domain), TypeError); assert.equal(f.leases(), 0);
  }
  for (const includeArchived of [null, 0, 1, 'true', [], {}]) {
    const f = fixture(); await assert.rejects(load(f.pool, auth, 'publicacion', { includeArchived }), TypeError); assert.equal(f.leases(), 0);
  }
  const invalid = [null, undefined, {}, { ...auth, rol: '' }, { ...auth, rol: ' \n' }, { ...auth, rol: 1 }];
  for (const key of ['id', 'session_version']) for (const value of [undefined, null, '17', 0, -1, 1.5, NaN, Infinity, 2147483648]) invalid.push({ ...auth, [key]: value });
  for (const value of invalid) { const f = fixture(); await assert.rejects(load(f.pool, value, 'historia'), error => error.status === 401); assert.equal(f.leases(), 0); }
});
test('authority and archive flag are captured before pending lease and cannot be rewritten by caller', async () => {
  const f = fixture(); let release;
  const mutable = { ...auth }, options = { includeArchived: true };
  const pool = { connect: () => new Promise(resolve => { release = resolve; }) };
  const pending = load(pool, mutable, 'publicacion', options);
  mutable.id = 99; mutable.rol = 'diseno'; mutable.session_version = 99; options.includeArchived = false;
  release(f.db); await pending;
  assert.deepEqual(f.calls[1].values, [17]); assert.deepEqual(f.calls[2].values, [true]);
});
test('actor mismatches reject401 and rollback without domain or evidence queries', async () => {
  for (const actor of [null, { ...current, id: 18 }, { ...current, activo: false }, { ...current, activo: null }, { ...current, rol: 'diseno' }, { ...current, session_version: 4 }, { ...current, session_version: '3' }]) {
    const f = fixture({ actor }); await assert.rejects(load(f.pool, auth, 'historia'), error => error.status === 401);
    assert.deepEqual(f.calls.map(c => c.stage), ['begin', 'actor', 'rollback']); assert.deepEqual(f.released, [undefined]);
  }
});
test('every transactional stage rolls back; rollback failure discards lease without replacing primary error', async () => {
  for (const failAt of ['begin', 'actor', 'catalog', 'evidence', 'commit']) for (const badRollback of [false, true]) {
    const rollbackFailure = badRollback ? Error('rollback broken') : undefined, f = fixture({ failAt, rollbackFailure });
    await assert.rejects(load(f.pool, auth, 'publicacion'), error => error === f.failure);
    assert.equal(f.calls.at(-1).stage, 'rollback'); assert.deepEqual(f.released, [rollbackFailure]);
    assert.equal(f.calls.filter(c => c.stage === failAt).length, 1);
  }
});
test('malformed catalog rows fail annotation and rollback; empty catalog commits without evidence query', async () => {
  const malformed = fixture({ rows: null }); await assert.rejects(load(malformed.pool, auth, 'historia'), TypeError);
  assert.deepEqual(malformed.calls.map(c => c.stage), ['begin', 'actor', 'catalog', 'rollback']); assert.deepEqual(malformed.released, [undefined]);
  const empty = fixture({ rows: [] }); assert.deepEqual(await load(empty.pool, auth, 'publicacion'), []);
  assert.deepEqual(empty.calls.map(c => c.stage), ['begin', 'actor', 'catalog', 'commit']); assert.deepEqual(empty.calls[2].values, [false]);
});
test('pool lease failure propagates without rollback/release on a connection never obtained', async () => {
  const leaseFailure = Error('lease failed'), f = fixture({ leaseFailure });
  await assert.rejects(load(f.pool, auth, 'historia'), error => error === leaseFailure); assert.deepEqual(f.calls, []); assert.deepEqual(f.released, []);
});
