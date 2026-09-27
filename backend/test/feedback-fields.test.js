import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedback } from '../src/feedback-fields.js';
test('legacy notes accept empty optional metadata', () => {
  assert.deepEqual(normalizeFeedback({}), { cliente: '', responsable: '', referencia: '', responsables: [], estado: 'pendiente', vigencia: 'puntual', flujo: '' });
});
test('metadata trims text and ignores fields that could change task permissions', () => {
  assert.deepEqual(normalizeFeedback({ cliente: ' Cristal ', responsable: ' Oriana ', referencia: ' texto ', estado: 'publicada', rol: 'admin' }), { cliente: 'Cristal', responsable: 'Oriana', referencia: 'texto', responsables: ['Oriana'], estado: 'pendiente', vigencia: 'puntual', flujo: '' });
});
test('feedback supports equal multiple responsibles, status and validity', () => {
  assert.deepEqual(normalizeFeedback({ responsables: [' Oriana ', 'Ana Mayerro', 'oriana'], estado: 'resuelto', vigencia: 'permanente', flujo: 'feedback' }), {
    cliente: '', responsable: 'Oriana', referencia: '', responsables: ['Oriana', 'Ana Mayerro'], estado: 'resuelto', vigencia: 'permanente', flujo: 'feedback',
  });
});
test('rejects malformed values and oversized fields without truncating data', () => {
  for (const value of [null, [], 'text', { cliente: {} }, { referencia: 'x'.repeat(2001) }]) assert.throws(() => normalizeFeedback(value));
});
