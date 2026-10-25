import test from 'node:test';
import assert from 'node:assert/strict';
import { productionResultStatus } from './productionResultStatus.js';

const evidence = patch => ({ id: '11111111-2222-4333-8444-555555555555', visita_revision: 7,
  revision_resultante: 8, registrado_at: '2026-10-29T12:34:56.123Z', parcial: true, vigente: true, ...patch });
const unknown = { label: 'Resultado sin verificar', tone: 'unknown' };

test('explicit null means no recorded result; missing projection is unknown rather than invented absence', () => {
  assert.deepEqual(productionResultStatus(null, 8), { label: 'Sin resultado registrado', tone: 'pending' });
  assert.deepEqual(productionResultStatus(null), { label: 'Sin resultado registrado', tone: 'pending' });
  for (const value of [undefined, false, true, 0, '', 'null', [], {}]) assert.deepEqual(productionResultStatus(value, 8), unknown);
});

test('current partial/complete and obsolete results have distinct fixed labels and tones', () => {
  assert.deepEqual(productionResultStatus(evidence(), 8), { label: 'Resultado parcial registrado', tone: 'partial' });
  assert.deepEqual(productionResultStatus(evidence({ parcial: false }), 8), { label: 'Resultado registrado', tone: 'complete' });
  for (const parcial of [true, false]) assert.deepEqual(productionResultStatus(evidence({ parcial, vigente: false }), 9),
    { label: 'Resultado desactualizado', tone: 'outdated' });
});

test('revision observations must be positive numeric integers, exactly consecutive and not future or contradictory', () => {
  for (const revision of [undefined, null, 0, -1, '8', 8.5, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(productionResultStatus(evidence(), revision), unknown);
  }
  for (const patch of [ { visita_revision: '7' }, { visita_revision: 0 }, { visita_revision: -1 },
    { visita_revision: 7.5 }, { visita_revision: NaN }, { visita_revision: 2147483647, revision_resultante: 2147483648 },
    { revision_resultante: '8' }, { revision_resultante: 7 }, { revision_resultante: 9 },
    { vigente: false }, { vigente: 'true' }, { parcial: 1 }, { parcial: null } ]) {
    assert.deepEqual(productionResultStatus(evidence(patch), 8), unknown);
  }
  assert.deepEqual(productionResultStatus(evidence(), 7), unknown);
  assert.deepEqual(productionResultStatus(evidence(), 9), unknown);
  assert.deepEqual(productionResultStatus(evidence({ visita_revision: 2147483646, revision_resultante: 2147483647 }), 2147483647),
    { label: 'Resultado parcial registrado', tone: 'partial' });
});

test('UUID is an exact complete string, without whitespace, newline or object coercion', () => {
  for (const id of [null, undefined, 7, { toString: () => evidence().id }, evidence().id + '\n',
    ' ' + evidence().id, evidence().id.slice(1), evidence().id.replace('1', 'z')]) {
    assert.deepEqual(productionResultStatus(evidence({ id }), 8), unknown);
  }
  assert.equal(productionResultStatus(evidence({ id: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF' }), 8).tone, 'partial');
});

test('timestamps require real calendar dates, a complete ISO time and an explicit timezone', () => {
  for (const registrado_at of ['2026-02-29T12:00:00Z', '2026-02-30T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-13-01T12:00:00Z', '0000-01-01T00:00:00Z', '2026-10-29', '2026-10-29T12:00:00',
    '2026-10-29T24:00:00Z', '2026-10-29T12:60:00Z', '2026-10-29T12:00:60Z',
    '2026-10-29T12:00:00+24:00', '2026-10-29T12:00:00-03:60', '2026-10-29T12:00:00Z\n',
    'tomorrow', '', null, 1793275200000, new Date('2026-10-29T12:00:00Z')]) {
    assert.deepEqual(productionResultStatus(evidence({ registrado_at }), 8), unknown);
  }
  for (const registrado_at of ['2028-02-29T00:00:00Z', '2026-10-29T23:59:59.123456Z',
    '2026-10-29T12:34:56-03:00', '2026-10-29T00:00:00+02:00']) {
    assert.equal(productionResultStatus(evidence({ registrado_at }), 8).tone, 'partial');
  }
});

test('missing required fields and inherited evidence fail closed; hostile accessors never escape as exceptions', () => {
  for (const key of Object.keys(evidence())) {
    const value = evidence(); delete value[key]; assert.deepEqual(productionResultStatus(value, 8), unknown);
  }
  assert.deepEqual(productionResultStatus(Object.create(evidence()), 8), unknown);
  const getter = evidence(); Object.defineProperty(getter, 'id', { get() { throw Error('untrusted'); } });
  assert.deepEqual(productionResultStatus(getter, 8), unknown);
  assert.deepEqual(productionResultStatus(new Proxy({}, { getOwnPropertyDescriptor() { throw Error('untrusted'); } }), 8), unknown);
});

test('output strips financial/unknown properties, cannot be mutated and does not mutate caller evidence', () => {
  const value = evidence({ label: '<script>untrusted</script>', tone: 'financial', importe: 999,
    resumen: { private: true }, nested: { preserve: true } });
  const before = structuredClone(value), result = productionResultStatus(value, 8);
  assert.deepEqual(Object.keys(result), ['label', 'tone']);
  assert.deepEqual(result, { label: 'Resultado parcial registrado', tone: 'partial' });
  assert.deepEqual(value, before); assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.label = 'Changed'; }, TypeError);
  assert.equal(productionResultStatus(evidence(), 8).label, 'Resultado parcial registrado');
});
