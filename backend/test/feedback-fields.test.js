import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedback, assertFeedbackBusinessInput, withServerFeedbackProvenance } from '../src/feedback-fields.js';
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

test('browser cannot submit reserved provenance even when empty or at root', () => {
  for (const field of ['origen','confirmado_por','confirmado_por_id','confirmado_at','provenance_version','wilson_idempotency_key']) {
    for (const value of ['', null, false, 1, 'forged']) {
      assert.throws(() => normalizeFeedback({ [field]: value }), { status: 400 });
      assert.throws(() => assertFeedbackBusinessInput({ [field]: value }), { status: 400 });
      assert.throws(() => assertFeedbackBusinessInput({ feedback: { [field]: value } }), { status: 400 });
    }
  }
});

test('trusted provenance derives from verified identity without truncating or storing keys', () => {
  const result = withServerFeedbackProvenance({ responsables: ['QA'], flujo: 'feedback' }, {
    userId: 42, name: 'QA Verified', channel: 'whatsapp', at: '2026-10-19T12:00:00Z',
  });
  assert.equal(result.confirmado_por_id, 42);
  assert.equal(result.confirmado_por, 'QA Verified');
  assert.equal(result.confirmado_at, '2026-10-19T12:00:00.000Z');
  assert.equal(result.provenance_version, 1);
  assert.equal(result.origen, 'mia_whatsapp');
  assert.equal(result.wilson_idempotency_key, undefined);
  assert.equal(withServerFeedbackProvenance({}, { userId: 42, name: 'QA', channel: 'telegram' }).origen, 'wilson_telegram');
  for (const userId of [null, 0, -1, '42', NaN]) assert.throws(() => withServerFeedbackProvenance({}, { userId, name: 'QA', channel: 'whatsapp' }));
});
