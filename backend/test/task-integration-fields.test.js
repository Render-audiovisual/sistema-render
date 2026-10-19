import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTaskBusinessInput } from '../src/task-integration-fields.js';

test('all caller Wilson provenance and replay fields reject before mutation', () => {
  for (const key of ['wilson_idempotency_key', 'wilson_last_update_key', 'wilson_confirmado_por', 'wilson_archive_key',
    'wilson_provenance', 'WILSON_future_field', 'origen_integracion', 'ORIGEN_INTEGRACION']) {
    for (const value of [null, '', {}, true, 42]) {
      assert.throws(() => assertTaskBusinessInput({ [key]: value }), { status: 400 });
      assert.throws(() => assertTaskBusinessInput({ propiedades_extra: { [key]: value } }), { status: 400 });
    }
  }
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
