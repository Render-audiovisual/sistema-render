import test from 'node:test';
import assert from 'node:assert/strict';
import * as canonical from '../../../shared/feedback-client.mjs';
import * as browser from '../features/render-os/utils/feedback-client.js';

test('browser and server contract use the same classification functions, not copied rules', () => {
  for (const key of ['normalizeFeedbackText','resolveFeedbackClient','isClientFeedback']) assert.equal(browser[key], canonical[key]);
});
test('explicit client and accent normalization preserve existing shared behavior', () => {
  assert.equal(canonical.normalizeFeedbackText('ÁRBOL'), 'arbol');
  assert.equal(canonical.resolveFeedbackClient({titulo:'Interno',feedback:{cliente:'  Cliente histórico  '}}, []), 'Cliente histórico');
  assert.equal(canonical.resolveFeedbackClient({titulo:'Revisión Ángel Azul'}, ['El Ángel Azul']), 'El Ángel Azul');
});
test('ambiguous historical title remains unassigned, never guessed from first match', () => {
  assert.equal(canonical.resolveFeedbackClient({titulo:'Lavalle cambios'}, ['Lavalle Norte','Lavalle Sur']), '');
  assert.equal(canonical.isClientFeedback({titulo:'Reunión interna'}, ['Lavalle']), false);
  assert.equal(canonical.isClientFeedback({titulo:'Lavalle revisión'}, ['Lavalle']), true);
});
