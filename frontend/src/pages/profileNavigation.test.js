import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createProfileSessionGuard } from '../shared/session/profile-session.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { registerNavigationGuard, installUnsavedNavigation } from '../shared/navigation/unsaved.js';
import { navigateWithinApp } from '../shared/navigation/location.js';

// Actual Perfil getter/photo callback extraction + actual guard/event protocol.
// No mounted React, browser credential entry, backend or Web Storage access.
const source = readFileSync(new URL('./Perfil.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Perfil.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) { const found = []; const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }; visit(root); return found; }
const variable = name => { const result = nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === name); assert.ok(result, name); return result; };
const evaluate = (name, context) => new Function(...Object.keys(context), `return (${variable(name).initializer.getText()});`)(...Object.values(context));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
class Custom extends Event { constructor(type, options = {}) { super(type, options); this.detail = options.detail; } }
class Pop extends Event { constructor(type, options = {}) { super(type, options); this.state = options.state; } }
class Window extends EventTarget {
  constructor() {
    super(); this.location = new URL('https://fixture.invalid/perfil'); this.CustomEvent = Custom; this.PopStateEvent = Pop;
    this.prompts = []; this.accept = false; this.effects = [];
    this.confirm = message => { this.prompts.push(message); return this.accept; };
    this.history = { state: { keep: true }, pushState: (state, _title, href) => { this.effects.push('push'); this.location = new URL(href, this.location); } };
    this.scrollTo = () => this.effects.push('scroll');
  }
}
function fixture({ cookie = false } = {}) {
  const win = new Window(), effects = [], state = {}, store = createBrowserSessionState();
  let mounted = true, live;
  const publish = id => {
    if (cookie) { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, { usuario: { id, usuario: 'qa_profile', nombre: 'Synthetic profile', rol: 'edicion' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); live = store.getSession(); }
    else live = { token: `synthetic-profile-${id}`, usuario: { id, usuario: 'qa_profile', nombre: 'Synthetic profile', rol: 'edicion' } };
  };
  publish(7); const session = live;
  const runtime = cookie ? { mode: 'browser', getSession: store.getSession, getSnapshot: store.getSnapshot, invalidateSession: store.invalidate } : undefined;
  const capture = () => createProfileSessionGuard({ session, readSession: () => cookie ? store.getSession() : live,
    isMounted: () => mounted, runtime, save: () => assert.fail('Navigation getter must not persist credentials'),
    clear: key => { assert.equal(key, 'render_sesion'); live = null; }, navigate: href => { navigateWithinApp(win, href); } });
  const context = { capture, perfilUsuario: session.usuario, usuarioNuevo: session.usuario.usuario,
    passwordUsuario: '', actual: '', nueva: '', confirmar: '', busy: false, operationPending: { current: false } };
  let latest = evaluate('profileNavigationStatus', context);
  const installed = installUnsavedNavigation(win), remove = registerNavigationGuard(win, navigation => latest(navigation));
  const render = () => { latest = evaluate('profileNavigationStatus', context); return latest; };
  for (const name of ['MensajeFoto', 'ErrorFoto', 'EnviandoFoto']) context[`set${name}`] = value => { effects.push(name); state[name] = value; };
  return { win, context, effects, state, store, publish, capture, render, status: () => latest(),
    unmount: () => { mounted = false; }, dispose: () => { remove(); installed.dispose(); }, remove };
}

test('Perfil registers the named getter with existing hook, without separate unload/history listeners', () => {
  const call = nodes(file, ts.isCallExpression).find(n => n.expression.getText() === 'useNavigationGuard');
  assert.ok(call); assert.equal(call.arguments[0].getText(), 'profileNavigationStatus');
  assert.match(source, /useNavigationGuard.*shared\/navigation\/useNavigationGuard/);
  assert.doesNotMatch(source, /addEventListener\(['"](?:beforeunload|render:before-navigation)|history\.(?:go|back|replaceState)/);
});

test('unchanged current profile is clean; each credential field or exact username difference is dirty even with collapsed forms', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.status(), { dirty: false, busy: false });
    for (const field of ['usuarioNuevo', 'passwordUsuario', 'actual', 'nueva', 'confirmar']) {
      const before = f.context[field]; f.context[field] = field === 'usuarioNuevo' ? `${before} ` : 'synthetic-draft';
      assert.deepEqual(f.render()(), { dirty: true, busy: false }, field);
      assert.equal(navigateWithinApp(f.win, '/inicio'), false);
      assert.equal(f.win.location.pathname, '/perfil'); assert.equal(f.context[field], field === 'usuarioNuevo' ? `${before} ` : 'synthetic-draft');
      f.context[field] = before; f.render();
    }
    assert.equal(f.win.prompts.length, 5); assert.deepEqual(f.win.effects, []);
  } finally { f.dispose(); }
});

test('synchronous operation ref blocks navigation before React busy render, without prompting or clearing drafts', () => {
  const f = fixture();
  try {
    f.context.operationPending.current = true;
    assert.deepEqual(f.status(), { dirty: false, busy: true });
    f.win.accept = true; assert.equal(navigateWithinApp(f.win, '/inicio'), false); assert.equal(f.win.prompts.length, 0);
    f.context.operationPending.current = false; f.context.busy = true;
    assert.deepEqual(f.render()(), { dirty: false, busy: true });
    f.context.busy = false; f.render(); assert.equal(navigateWithinApp(f.win, '/inicio'), true);
  } finally { f.dispose(); }
});

test('dirty discard uses the existing single confirmation; busy still takes priority over accepting discard', () => {
  const f = fixture();
  try {
    f.context.actual = 'synthetic-old-password'; f.render();
    assert.equal(navigateWithinApp(f.win, '/inicio'), false); assert.equal(f.win.prompts.length, 1);
    f.win.accept = true; f.context.operationPending.current = true;
    assert.equal(navigateWithinApp(f.win, '/inicio'), false); assert.equal(f.win.prompts.length, 1);
    f.context.operationPending.current = false;
    assert.equal(navigateWithinApp(f.win, '/inicio'), true); assert.equal(f.win.prompts.length, 2);
    assert.equal(f.context.actual, 'synthetic-old-password', 'Guard itself never clears or stores credential drafts');
  } finally { f.dispose(); }
});

for (const kind of ['replacement', 'unmount']) test(`stale profile after ${kind} is clean/not busy even if old operation/draft remains`, () => {
  const f = fixture({ cookie: true });
  try {
    f.context.nueva = 'synthetic-draft'; f.context.busy = true; f.context.operationPending.current = true; f.render();
    if (kind === 'replacement') f.publish(8); else f.unmount();
    assert.deepEqual(f.status(), { dirty: false, busy: false });
    assert.equal(navigateWithinApp(f.win, '/login'), true); assert.equal(f.win.prompts.length, 0);
    assert.equal(f.context.nueva, 'synthetic-draft'); assert.equal(f.context.operationPending.current, true);
  } finally { f.dispose(); }
});

for (const cookie of [false, true]) test(`actual ${cookie ? 'cookie invalidation' : 'bearer clear'} makes security reauthentication navigation unblocked`, () => {
  const f = fixture({ cookie });
  try {
    f.context.passwordUsuario = 'synthetic-current-password'; f.context.operationPending.current = true; f.context.busy = true; f.render();
    const guard = f.capture(); assert.equal(guard.current(), true); assert.equal(guard.requireReauthentication(), true);
    assert.equal(guard.current(), false); assert.deepEqual(f.status(), { dirty: false, busy: false });
    assert.equal(f.win.location.pathname, '/login'); assert.equal(f.win.prompts.length, 0);
  } finally { f.dispose(); }
});

for (const outcome of ['success', 'prepare failure', 'upload failure', 'stale']) test(`actual photo handler protects preparation/upload and cleans up only current operation: ${outcome}`, async () => {
  const f = fixture(), prepare = deferred(), upload = deferred(); let writes = 0;
  Object.assign(f.context, { getApplicationSession: () => null,
    reducirFotoPerfil: () => prepare.promise,
    guardarFotoPerfil: async (_photo, guard) => { assert.equal(guard.current(), true); writes++; return upload.promise; },
    profileFailureMessage: () => 'Synthetic photo failure' });
  f.context.canChangePhoto = evaluate('canChangePhoto', f.context);
  const handler = evaluate('handleFotoPerfil', f.context);
  const event = () => ({ target: { files: [{ type: 'image/png' }], value: 'synthetic-file' } });
  try {
    const pending = handler(event());
    assert.equal(f.context.operationPending.current, true); assert.deepEqual(f.status(), { dirty: false, busy: true });
    assert.equal(navigateWithinApp(f.win, '/inicio'), false);
    await handler(event()); assert.equal(writes, 0, 'Duplicate photo action must not start a second upload');
    if (outcome === 'prepare failure') prepare.reject(new Error('Synthetic prepare failure'));
    else { prepare.resolve('data:image/png;base64,synthetic'); await settle(); assert.equal(writes, 1);
      assert.equal(f.status().busy, true); assert.equal(navigateWithinApp(f.win, '/inicio'), false);
      if (outcome === 'stale') { f.publish(8); upload.reject(new Error('Old private error')); }
      else if (outcome === 'upload failure') upload.reject(new Error('Synthetic upload failure'));
      else upload.resolve();
    }
    const effects = f.effects.length; await pending;
    if (outcome === 'stale') { assert.equal(f.effects.length, effects); assert.deepEqual(f.status(), { dirty: false, busy: false }); }
    else { assert.equal(f.context.operationPending.current, false); assert.equal(f.state.EnviandoFoto, false); assert.equal(f.status().busy, false); }
  } finally { f.dispose(); }
});

test('registered guard prevents unload with current draft and unregister cleanup removes that protection', () => {
  const f = fixture();
  try {
    f.context.confirmar = 'synthetic-draft'; f.render();
    const blocked = new Event('beforeunload', { cancelable: true }); f.win.dispatchEvent(blocked); assert.equal(blocked.defaultPrevented, true);
    f.remove(); const free = new Event('beforeunload', { cancelable: true }); f.win.dispatchEvent(free); assert.equal(free.defaultPrevented, false);
    assert.equal(navigateWithinApp(f.win, '/inicio'), true);
  } finally { f.dispose(); }
});

test('existing busy expression covers photo, username and password writes independently', () => {
  for (const field of ['enviandoFoto', 'enviandoUsuario', 'enviando']) {
    const state = { enviandoFoto: false, enviandoUsuario: false, enviando: false };
    assert.equal(evaluate('busy', state), false); state[field] = true;
    assert.equal(evaluate('busy', state), true);
    const f = fixture();
    try { f.context.busy = evaluate('busy', state); assert.equal(f.render()().busy, true); }
    finally { f.dispose(); }
  }
});
