import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createGoalDraftMemory, makeGoalDraftHref } from '../shared/navigation/goalDraftMemory.js';
import { captureSessionBinding, sessionBindingMatches } from '../shared/session/session-binding.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { navigateWithinApp } from '../shared/navigation/location.js';

test('recovery notice has touch targets, hides conflicting modal actions and clears mobile header only once', () => {
  const css = readFileSync(new URL('./GoalDraftMemoryProvider.css', import.meta.url), 'utf8');
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /body:has\(\.modal-overlay\[aria-label="Detalle de la pieza"\]\)\s+\.render-goal-draft-notice\s*\{\s*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*980px\)/);
  assert.match(css, /\.render-goal-draft-notice\s*~\s*\.quick-home\s*\{\s*padding-top:\s*24px/);
  assert.match(css, /:focus-visible/);
});

// Production components, real memory/session/router kernels, manual hook leases.
// No mounted browser, cookie jar, HTTP or persistence is involved.
const source = readFileSync(new URL('./GoalDraftMemoryProvider.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('GoalDraftMemoryProvider.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
function extract(name, deps) {
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  const js = ts.transpileModule(node.getText(file).replace(/^export\s+/, ''), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(deps), `${js};return ${name};`)(...Object.values(deps));
}
const draft = extra => ({ pieceId: 3, taskId: 9, clientId: 7, period: '2026-10',
  title: 'PRIVATE TITLE 739', copy: 'PRIVATE COPY 951',
  baseline: JSON.stringify({ title: 'PRIVATE BASELINE 482', copy: 'Original' }),
  taskVersion: '2026-10-20T11:00:00.123Z', taskRevision: 6, ...extra });
const memory = () => createGoalDraftMemory({ isCurrent: () => true });
function providerFixture() {
  const sessions = createBrowserSessionState();
  function accept(id = 7) {
    assert.equal(sessions.acceptBootstrap(sessions.beginBootstrap(), {
      usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'custom' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43),
    }), true);
  }
  accept();
  const refs = [], guards = [];
  let cursor = 0, setup, cleanup;
  const Provider = extract('GoalDraftMemoryProvider', {
    React, captureSessionBinding, sessionBindingMatches, createGoalDraftMemory,
    getSesion: sessions.getSession,
    useRef: initial => refs[cursor++] ||= { current: initial },
    useLayoutEffect: effect => { setup = effect; },
    useNavigationGuard: guard => { guards.push(guard); },
    GoalDraftMemoryContext: { Provider: ({ children }) => children },
    GoalDraftRecoveryNotice: () => null,
  });
  function render() { cursor = 0; return Provider({ session: sessions.getSession(), children: React.createElement('main', null, 'Child') }); }
  const tree = render(), store = tree.props.value;
  return { store, sessions, accept, render, guards, tree,
    setup() { cleanup = setup(); }, cleanup() { cleanup(); } };
}

test('actual provider is transparent, guards unload only and resets before StrictMode lease withdrawal', () => {
  const h = providerFixture(); h.setup();
  assert.equal(renderToStaticMarkup(h.tree), '<main>Child</main>');
  assert.ok(h.store.retain(draft()));
  const guard = h.guards.at(-1);
  for (const type of ['link', 'traverse', 'refresh', undefined]) assert.deepEqual(guard({ type }), { dirty: false, busy: false });
  assert.deepEqual(guard({ type: 'unload' }), { dirty: true, busy: false });
  h.store.markSaving(h.store.getSnapshot());
  assert.deepEqual(guard({ type: 'unload' }), { dirty: true, busy: false });
  const observed = [];
  h.store.subscribe(() => observed.push(h.store.getSnapshot()));
  h.cleanup();
  assert.deepEqual(observed, [null], 'Synchronous subscriber reads while lease is still valid');
  // Do not read while unmounted: setup must revive this same, fresh store.
  h.setup(); assert.equal(h.render().props.value, h.store);
  assert.ok(h.store.retain(draft({ title: 'After StrictMode probe' })));
  assert.deepEqual(guard({ type: 'unload' }), { dirty: true, busy: false });
  h.cleanup(); assert.equal(h.store.getSnapshot(), null);
  assert.equal(h.store.retain(draft()), null, 'Ended lease cannot publish');
});

test('real cookie-session A/B/A observations never grant old provider memory to a fresh session', () => {
  const h = providerFixture(); h.setup();
  const original = h.sessions.getSession();
  assert.ok(h.store.retain(draft()));
  h.accept(8); h.accept(7); // Same cookie fields and user ID, different owned observation.
  assert.notEqual(h.sessions.getSession(), original);
  assert.equal(h.store.getSnapshot(), null);
  assert.equal(h.store.retain(draft()), null);
  assert.deepEqual(h.guards.at(-1)({ type: 'unload' }), { dirty: false, busy: false });
  h.cleanup();
});

class UIEvent {
  constructor(type, extra = {}) { Object.assign(this, { type, defaultPrevented: false }, extra); }
  preventDefault() { this.defaultPrevented = true; }
}
function windowFixture(href = 'https://render.test/inicio') {
  const events = [], history = [], prompts = [];
  const win = { location: new URL(href), CustomEvent: UIEvent, PopStateEvent: UIEvent,
    dispatchEvent(event) { events.push(event); return !event.defaultPrevented; },
    confirm(message) { prompts.push(message); return false; }, scrollTo() {},
  };
  win.history = { state: null, pushState(state, _title, target) { history.push(target); this.state = state; win.location = new URL(target, win.location); } };
  return { win, events, history, prompts };
}
function noticeFixture(store, href) {
  const browser = windowFixture(href);
  const Notice = extract('GoalDraftRecoveryNotice', { React, makeGoalDraftHref, navigateWithinApp,
    // Intentionally read the live snapshot, not React SSR's null server snapshot.
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    window: browser.win, CustomEvent: UIEvent,
  });
  const tree = Notice({ memory: store });
  const buttons = tree ? tree.props.children[1].props.children : [];
  return { ...browser, tree, buttons, html: () => renderToStaticMarkup(tree) };
}

test('notice SSR is absent without a draft and generic without free-text or baseline leakage', () => {
  const store = memory(); assert.equal(noticeFixture(store).html(), '');
  for (const status of ['editing', 'uncertain', 'saving']) {
    store.reset(); store.retain(draft({ status }));
    const h = noticeFixture(store), html = h.html();
    assert.match(html, /aria-label="Borrador de contenido"/);
    assert.match(html, /Contenido sin guardar/);
    assert.doesNotMatch(html, /PRIVATE|739|951|482|2026-10-20|taskRevision|taskVersion/);
    assert.equal(h.buttons.every(b => b.props.disabled === (status === 'saving')), true);
    assert.equal((html.match(/disabled=""/g) || []).length, status === 'saving' ? 2 : 0);
    if (status === 'uncertain') assert.match(html, /No se pudo confirmar/);
    if (status === 'saving') assert.match(html, /guardado está en curso/);
  }
});

test('Retomar uses actual SPA navigation for a different valid URL', () => {
  const store = memory(), held = store.retain(draft()), h = noticeFixture(store);
  h.buttons[0].props.onClick();
  assert.deepEqual(h.history, [makeGoalDraftHref(held)]);
  assert.deepEqual(h.events.map(e => e.type), ['render:before-navigation', 'popstate']);
  assert.equal(h.win.location.pathname, '/clientes');
  assert.equal(store.getSnapshot(), held);
});

test('Retomar on same canonical URL dispatches retry only, without history changes', () => {
  const store = memory(); store.retain(draft());
  const h = noticeFixture(store, 'https://render.test/clientes?borrador=3&periodo=2026-10&cliente=7');
  h.buttons[0].props.onClick();
  assert.deepEqual(h.history, []);
  assert.deepEqual(h.events.map(e => e.type), ['render:retry-goal-draft']);
});

test('stale notice actions cannot navigate, prompt, or discard a newer draft', () => {
  const store = memory(); store.retain(draft()); const h = noticeFixture(store);
  const newer = store.retain(draft({ title: 'Newer' }));
  h.win.confirm = () => assert.fail('Stale click must not prompt');
  for (const button of h.buttons) button.props.onClick();
  assert.deepEqual(h.events, []); assert.deepEqual(h.history, []);
  assert.equal(store.getSnapshot(), newer);
});

test('Discard requires confirmation and clears only the exact rendered token', () => {
  const store = memory(), held = store.retain(draft()), h = noticeFixture(store);
  h.buttons[1].props.onClick(); assert.equal(h.prompts.length, 1); assert.equal(store.getSnapshot(), held);
  h.win.confirm = () => true;
  h.buttons[1].props.onClick(); assert.equal(store.getSnapshot(), null);
  assert.deepEqual(h.events, []); assert.deepEqual(h.history, []);
  store.retain(draft()); const race = noticeFixture(store);
  let newer;
  race.win.confirm = () => { newer = store.retain(draft({ title: 'Changed during confirmation' })); return true; };
  race.buttons[1].props.onClick(); assert.equal(store.getSnapshot(), newer);
});
