import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedback } from '../src/feedback-fields.js';
test('legacy notes accept empty optional metadata', () => {
  assert.deepEqual(normalizeFeedback({}), { cliente: '', responsable: '', referencia: '' });
});
test('metadata trims text and ignores fields that could change task permissions', () => {
  assert.deepEqual(normalizeFeedback({ cliente: ' Cristal ', responsable: ' Oriana ', referencia: ' texto ', estado: 'publicada', rol: 'admin' }), { cliente: 'Cristal', responsable: 'Oriana', referencia: 'texto' });
});
test('rejects malformed values and oversized fields without truncating data', () => {
  for (const value of [null, [], 'text', { cliente: {} }, { referencia: 'x'.repeat(2001) }]) assert.throws(() => normalizeFeedback(value));
});
