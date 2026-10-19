import test from 'node:test';
import assert from 'node:assert/strict';
import { correctProductionRecord } from '../src/production-record-updates.js';

const now = new Date('2026-10-19T15:00:00Z');
const input = { recordId: 'a', amount: 2, actorName: 'Renamed actor', actorId: 42, now };
const task = (planned = 7) => ({ id: 1, estado: 'aprobada', propiedades_extra: {
  produccion_videos_previstos: planned, produccion_confirmada_at: 'old', other: { preserved: true },
  produccion_registros: [
    { id: 'a', cantidad: 5, fecha: '2026-10-01', usuario: 'Recorder', usuario_id: 10, periodo_objetivo: '2026-10' },
    { id: 'b', cantidad: 4, fecha: '2026-10-02', cantidad_mes_actual: 2, cantidad_adelanto: 2, periodo_adelanto: '2026-11' },
    { id: 'c', cantidad: 3, fecha: '2026-12-03', cantidad_mes_actual: 0, cantidad_adelanto: 3, periodo_adelanto: '2027-01' },
  ],
} });
const allocation = records => records.map(record => [record.cantidad_mes_actual, record.cantidad_adelanto, record.periodo_adelanto]);

test('earlier decrease reallocates ALL subsequent records and uses each record date', () => {
  const result = correctProductionRecord(task(), input);
  assert.equal(result.previous, 5);
  assert.deepEqual(allocation(result.records), [[2, 0, null], [4, 0, null], [1, 2, '2027-01']]);
  assert.deepEqual(result.records.map(record => record.id), ['a', 'b', 'c']);
});

test('earlier increase moves later quantities into advance, including year rollover', () => {
  const result = correctProductionRecord(task(), { ...input, amount: 8 });
  assert.deepEqual(allocation(result.records), [[7, 1, '2026-11'], [0, 4, '2026-11'], [0, 3, '2027-01']]);
  for (const record of result.records) assert.equal(record.cantidad_mes_actual + record.cantidad_adelanto, record.cantidad);
});

test('audit uses actual previous amount, stable actor ID and supplied timestamp', () => {
  const source = task();
  source.propiedades_extra.produccion_registros[0].corregido_desde = 99;
  const first = correctProductionRecord(source, input);
  assert.equal(first.previous, 5);
  assert.equal(first.records[0].corregido_desde, 5);
  assert.equal(first.records[0].corregido_por_id, 42);
  assert.equal(first.records[0].corregido_por, 'Renamed actor');
  assert.equal(first.records[0].corregido_at, now.toISOString());
  assert.equal(first.records[0].usuario_id, 10);
  assert.equal(first.records[0].periodo_objetivo, '2026-10');
  assert.equal(first.records[1].corregido_at, undefined);
  const second = correctProductionRecord({ propiedades_extra: { ...source.propiedades_extra, produccion_registros: first.records } }, { ...input, amount: 3 });
  assert.equal(second.previous, 2);
  assert.equal(second.records[0].corregido_desde, 2);
});

test('input task, properties and every original record are immutable', () => {
  const source = task();
  const before = structuredClone(source);
  source.propiedades_extra.produccion_registros.forEach(Object.freeze);
  Object.freeze(source.propiedades_extra.produccion_registros);
  Object.freeze(source.propiedades_extra);
  Object.freeze(source);
  const result = correctProductionRecord(source, input);
  assert.deepEqual(source, before);
  assert.notEqual(result.records, source.propiedades_extra.produccion_registros);
  result.records.forEach((record, index) => assert.notEqual(record, source.propiedades_extra.produccion_registros[index]));
  assert.deepEqual(Object.keys(result).sort(), ['previous', 'records']);
});

test('missing, zero or invalid planned count means no advances and clears stale allocations', () => {
  for (const planned of [undefined, null, 0, -1, 'invalid', 1.5]) {
    const source = task();
    source.propiedades_extra.produccion_videos_previstos = planned;
    const result = correctProductionRecord(source, input);
    assert.deepEqual(allocation(result.records), [[2, 0, null], [4, 0, null], [3, 0, null]]);
  }
});

test('middle correction preserves earlier audit and stored order rather than sorting dates', () => {
  const source = task();
  source.propiedades_extra.produccion_registros[0].fecha = '2026-12-30';
  source.propiedades_extra.produccion_registros[0].corregido_por_id = 10;
  const result = correctProductionRecord(source, { ...input, recordId: 'b', amount: 1 });
  assert.equal(result.previous, 4);
  assert.deepEqual(allocation(result.records), [[5, 0, null], [1, 0, null], [1, 2, '2027-01']]);
  assert.equal(result.records[0].corregido_por_id, 10);
});

test('missing record is a 404, including missing/non-array record collections', () => {
  for (const source of [task(), {}, { propiedades_extra: { produccion_registros: null } }]) {
    assert.throws(() => correctProductionRecord(source, { ...input, recordId: 'missing' }), { status: 404 });
  }
  assert.throws(() => correctProductionRecord(task(), { ...input, recordId: undefined }), { status: 404 });
});

test('quantities must be positive safe integers; invalid audit inputs fail with 400', () => {
  for (const amount of [0, -1, 1.5, '2', null, true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => correctProductionRecord(task(), { ...input, amount }), { status: 400 });
  }
  for (const extra of [{ actorId: 0 }, { actorId: '42' }, { actorName: '' }, { now: 'invalid' }]) {
    assert.throws(() => correctProductionRecord(task(), { ...input, ...extra }), { status: 400 });
  }
});

test('record ID matching supports numeric legacy IDs; legacy quantities are normalized for allocation', () => {
  const source = task();
  source.propiedades_extra.produccion_registros[0].id = 7;
  source.propiedades_extra.produccion_registros[0].cantidad = '5';
  const result = correctProductionRecord(source, { ...input, recordId: '7' });
  assert.equal(result.previous, 5);
  assert.deepEqual(allocation(result.records), [[2, 0, null], [4, 0, null], [1, 2, '2027-01']]);
});
