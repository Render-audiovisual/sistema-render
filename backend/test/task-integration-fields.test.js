import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTaskBusinessInput, assertTaskCoordinationPatch } from '../src/task-integration-fields.js';

test('all caller Wilson provenance and replay fields reject before mutation', () => {
  for (const key of ['wilson_idempotency_key', 'wilson_last_update_key', 'wilson_confirmado_por', 'wilson_archive_key',
    'wilson_provenance', 'WILSON_future_field', 'origen_integracion', 'ORIGEN_INTEGRACION']) {
    for (const value of [null, '', {}, true, 42]) {
      assert.throws(() => assertTaskBusinessInput({ [key]: value }), { status: 400 });
      assert.throws(() => assertTaskBusinessInput({ propiedades_extra: { [key]: value } }), { status: 400 });
    }
  }
});

test('coordination accepts only bounded text and strict booleans without mutating input', () => {
  for (const horario of ['', 'El martes después de las 15, confirmar', 'x'.repeat(2000)]) {
    const input = Object.freeze({ propiedades_extra: Object.freeze({ horario, coordinada: false }) });
    assert.doesNotThrow(() => assertTaskBusinessInput(input));
    assert.equal(input.propiedades_extra.horario, horario);
  }
  for (const horario of [null, true, 42, [], {}, 'x'.repeat(2001)]) {
    assert.throws(() => assertTaskBusinessInput({ propiedades_extra: { horario } }), { status: 400 });
  }
  for (const coordinada of [null, 0, 1, 'true', [], {}]) {
    assert.throws(() => assertTaskBusinessInput({ propiedades_extra: { coordinada } }), { status: 400 });
  }
});

test('coordination PATCH requires an observed revision regardless of scope or actor', () => {
  for (const metadata of [{ horario: '' }, { coordinada: false }, { horario: '15', coordinada: true }]) {
    for (const expected_revision of [undefined, null, 0, -1, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => assertTaskCoordinationPatch({ propiedades_extra: metadata, expected_revision }), { status: 400 });
    }
    assert.doesNotThrow(() => assertTaskCoordinationPatch({ propiedades_extra: metadata, expected_revision: 1 }));
  }
  assert.doesNotThrow(() => assertTaskCoordinationPatch({ propiedades_extra: { resumen: 'No coordination' } }));
});

test('business metadata is preserved and malformed shapes do not bypass the boundary', () => {
  const input = { titulo: 'QA', propiedades_extra: { resumen: 'Brief', etiquetas: ['tag'], colaboradores: ['QA'], orden: 2 } };
  const before = structuredClone(input);
  assert.doesNotThrow(() => assertTaskBusinessInput(input));
  assert.deepEqual(input, before);
  for (const input of [null, undefined, [], 'text', { propiedades_extra: null }, { propiedades_extra: [] }]) {
    assert.throws(() => assertTaskBusinessInput(input), { status: 400 });
  }
});
