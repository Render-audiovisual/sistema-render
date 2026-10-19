import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateEditorialEvidence } from '../src/editorial-evidence-read.js';

const ID = '10000000-0000-4000-8000-000000000001';
const TIME = '2026-01-01T12:00:00.000Z';
const base = (extra = {}) => ({ id: 1, cliente_id: 7, estado: 'publicada', fecha_programada: '2025-12-31', 'fecha_publicación_real': TIME, ...extra });
const current = (extra = {}) => ({ piece_id: 1, piece_cliente_id: 7, piece_estado: 'publicada', piece_actual_at: new Date(TIME),
  piece_fecha_programada: '2025-12-31', piece_archived: false, cliente_activo: true, revision: '3', current_event_id: ID,
  event_id: ID, event_dominio: 'historia', event_pieza_id: 1, event_cliente_id: 7, event_actor_id: 4,
  event_action: 'confirmar', event_source: 'manual', event_occurred_at: new Date(TIME), event_recorded_at: new Date(TIME), ...extra });
function dbFor(results) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: results }; } };
}
const evidence = async (row = base(), lookup = current(), domain = 'historia') => (await annotateEditorialEvidence(dbFor(lookup ? [lookup] : []), domain, [row]))[0].publicacion_evidencia;

for (const domain of ['historia', 'publicacion']) {
  test(`${domain}: one deduplicated bounded read, preserves input order without mutating source`, async () => {
    const row = Object.freeze(base({ publicacion_evidencia: { malicious: 'ignore' } }));
    const second = base({ id: 2 });
    const db = dbFor([current({ event_dominio: domain })]);
    const result = await annotateEditorialEvidence(db, domain, [second, row, row]);
    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.calls[0].params, [domain, [1, 2]]);
    assert.deepEqual(result.map(r => r.id), [2, 1, 1]);
    assert.notEqual(result[1], row);
    assert.deepEqual(row.publicacion_evidencia, { malicious: 'ignore' });
    assert.equal(result[1].publicacion_evidencia.classification, 'confirmada_manualmente');
    assert.equal(result[0].publicacion_evidencia.classification, 'historica_sin_confirmacion');
    assert.match(db.calls[0].sql, /WHERE p\.id=ANY\(\$2::int\[\]\)/);
    assert.doesNotMatch(db.calls[0].sql, /FOR UPDATE|FOR SHARE|INSERT|UPDATE |DELETE |SELECT \*/);
  });
}

test('empty/invalid-ID batches do not query and invalid domains cannot select tables', async () => {
  const db = dbFor([]);
  assert.deepEqual(await annotateEditorialEvidence(db, 'historia', []), []);
  const output = await annotateEditorialEvidence(db, 'historia', [base({ id: null }), base({ id: {} })]);
  assert.equal(db.calls.length, 0);
  assert.ok(output.every(r => r.publicacion_evidencia.confirmation === null));
  for (const domain of ['historias', '__proto__', 'publicacion;DROP TABLE tareas', null]) {
    await assert.rejects(annotateEditorialEvidence(db, domain, []), TypeError);
  }
});

test('evidence is an exact closed projection with UTC instants; financial sentinels are never copied into proof', async () => {
  const dto = await evidence(base({ metadata: { salario: 'PRIVATE', publicacion_evidencia: { classification: 'confirmada_manualmente' } } }),
    current({ salario: 'PRIVATE', event_metadata: { token: 'PRIVATE' } }));
  assert.deepEqual(dto, { classification: 'confirmada_manualmente', revision: 3,
    confirmation: { id: ID, actor_id: 4, occurred_at: TIME, recorded_at: TIME, source: 'manual' } });
  assert.doesNotMatch(JSON.stringify(dto), /PRIVATE|salario|metadata|token/);
});

test('Date and explicit offset roots compare as instants; timezone-less, malformed and impossible dates receive no credit', async () => {
  for (const value of [new Date(TIME), '2026-01-01T09:00:00-03:00', '2026-01-01T12:00:00Z']) {
    assert.equal((await evidence(base({ 'fecha_publicación_real': value }))).classification, 'confirmada_manualmente');
  }
  for (const value of ['2026-01-01 12:00', '2026-01-01T12:00:00', '2026-02-30T12:00:00Z', '0000-01-01T12:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T12:00:60Z', '2026-01-01T12:00:00+24:00', new Date(NaN), 1767268800000, {}, null, undefined]) {
    assert.equal((await evidence(base({ 'fecha_publicación_real': value }))).confirmation, null);
  }
});

test('every base observed identity/state/date field must match current data, not just lookup ID', async () => {
  for (const change of [{ cliente_id: 8 }, { estado: 'lista' }, { 'fecha_publicación_real': '2026-01-02T12:00:00Z' }, { fecha_programada: '2026-01-02' }, { cliente_id: null }, { estado: undefined }, { fecha_programada: undefined }, { fecha_programada: '2025-02-30' }]) {
    assert.equal((await evidence(base(change))).confirmation, null);
  }
  assert.equal((await evidence(base({ id: 2 }))).confirmation, null);
});

test('each missing, invalid or conflicting current evidence field fails closed', async () => {
  for (const [key, value] of Object.entries({ revision: '9007199254740992', current_event_id: 'invalid', event_id: '20000000-0000-4000-8000-000000000002', event_dominio: 'publicacion', event_pieza_id: 2, event_cliente_id: 8, event_actor_id: 0, event_action: 'retirar', event_source: 'external', event_occurred_at: '2026-01-02T12:00:00Z', event_recorded_at: '2026-01-01 12:00', piece_id: 2, piece_cliente_id: 8, piece_estado: 'lista', piece_actual_at: null, piece_fecha_programada: null })) {
    assert.equal((await evidence(base(), current({ [key]: value }))).confirmation, null, key);
  }
  for (const key of Object.keys(current())) {
    const lookup = current(); delete lookup[key];
    assert.equal((await evidence(base(), lookup)).confirmation, null, `missing ${key}`);
  }
});

test('archived/inactive current or observed rows never receive a confirmation', async () => {
  for (const lookup of [current({ piece_archived: true }), current({ cliente_activo: false }), current({ piece_archived: null }), current({ cliente_activo: null })]) {
    assert.equal((await evidence(base(), lookup)).confirmation, null);
  }
  for (const row of [base({ metadata: { archivado_tablero: true } }), base({ metadata: { archivado_tablero: 'true' } }), base({ cliente_activo: false })]) {
    assert.equal((await evidence(row)).confirmation, null);
  }
});

test('unknown coverage follows only observed legacy state/date; metadata, tasks and forged old evidence do not count', async () => {
  assert.equal((await evidence(base(), null)).classification, 'historica_sin_confirmacion');
  assert.equal((await evidence(base({ estado: 'lista' }), null)).classification, 'historica_sin_confirmacion');
  assert.equal((await evidence(base({ 'fecha_publicación_real': null }), null)).classification, 'historica_sin_confirmacion');
  const noProof = base({ estado: 'lista', 'fecha_publicación_real': null,
    publicacion_evidencia: { classification: 'confirmada_manualmente', revision: 8, confirmation: { source: 'manual' } },
    metadata: { fecha_publicación_real: TIME, publicada: true, revision_aprobada: true }, task: { estado: 'finalizada' } });
  assert.deepEqual(await evidence(noProof, null), { classification: 'no_publicada', revision: 0, confirmation: null });
});

test('unsafe revision and duplicate current lookup rows cannot manufacture proof', async () => {
  for (const revision of [-1, 0, 1.5, '1.5', 'NaN', null, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const dto = await evidence(base(), current({ revision }));
    assert.equal(dto.revision, 0);
    assert.equal(dto.confirmation, null);
  }
  const result = await annotateEditorialEvidence(dbFor([current(), current()]), 'historia', [base()]);
  assert.equal(result[0].publicacion_evidencia.confirmation, null);
});

test('large repeated batch stays a single query and unexpected database errors propagate', async () => {
  const db = dbFor([current()]);
  const result = await annotateEditorialEvidence(db, 'historia', Array.from({ length: 1000 }, () => base()));
  assert.equal(result.length, 1000);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params[1], [1]);
  const error = new Error('SQL unavailable');
  await assert.rejects(annotateEditorialEvidence({ query: async () => { throw error; } }, 'historia', [base()]), e => e === error);
});
