import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBrowserSessionState } from './browser-session-state.js';
import { sessionBindingMatches } from './session-binding.js';
import { createSessionView, sessionViewInputs, sessionViewKey } from './session-view.js';
import { useSessionView } from './use-session-view.js';
const dto = (id = 7) => ({ usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) });
const install = (store, value = dto()) => store.acceptBootstrap(store.beginBootstrap(), value);

test('legacy clones yield identical complete primitive memo inputs without making cookie placeholders', () => {
  const session = { token: 'legacy-synthetic', usuario: { id: 7, rol: 'diseno' } };
  const before = sessionViewInputs(session), after = sessionViewInputs(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(before, after); assert.equal(before.cookieSession, null);
  const view = createSessionView(before); assert.equal(view.binding.mode, 'bearer'); assert.equal(view.session.token, session.token);
  assert.ok(sessionBindingMatches(view.binding, session)); assert.ok(Object.isFrozen(view));
  for (const changed of [{ ...session, token: 'new' }, { ...session, usuario: { ...session.usuario, rol: 'admin' } },
    { ...session, usuario: { ...session.usuario, id: 8 } }, { ...session, usuario: { ...session.usuario, activo: true } }])
    assert.notEqual(sessionViewKey(changed), before.key);
});
test('cookie view preserves exact DTO ownership; copied/expired observations cannot render as current', () => {
  const store = createBrowserSessionState(); install(store);
  const session = store.getSession(), inputs = sessionViewInputs(session), view = createSessionView(inputs);
  assert.equal(view.session, session); assert.equal(view.binding.mode, 'cookie'); assert.equal('token' in view.session, false);
  assert.equal(inputs.token, null); assert.equal(inputs.cookieSession, session);
  assert.equal(sessionViewKey(session), inputs.key); assert.ok(!inputs.key.includes(session.session_context));
  assert.equal(sessionViewKey({ ...session }), null); assert.equal(sessionViewKey({ ...session, token: 'cookie' }), null);
  install(store); const next = store.getSession();
  assert.notEqual(next, session); assert.notEqual(sessionViewKey(next), inputs.key);
  assert.equal(sessionViewKey(session), null); assert.equal(sessionBindingMatches(view.binding, next), false);
});
test('same cookie values in different stores cannot share a presentation cache identity', () => {
  const a = createBrowserSessionState(), b = createBrowserSessionState(); install(a); install(b);
  assert.notEqual(sessionViewKey(a.getSession()), sessionViewKey(b.getSession()));
  assert.equal(createSessionView(sessionViewInputs(null)).session, null);
});
test('actual React hook server render retains the cookie object and does not emit private keys/headers into markup', () => {
  const store = createBrowserSessionState(); install(store); const session = store.getSession(); let captured;
  function Probe() { captured = useSessionView(session); return React.createElement('span', null, captured.role); }
  const markup = renderToStaticMarkup(React.createElement(Probe));
  assert.equal(markup, '<span>diseno</span>'); assert.equal(captured.session, session);
  assert.equal(captured.binding.intent.session, session); assert.ok(!markup.includes(session.session_context));
});
