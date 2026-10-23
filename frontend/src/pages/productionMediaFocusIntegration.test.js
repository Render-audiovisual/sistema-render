import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createProductionDraft, productionMediaDraft, verifiedProductionDraftVisit } from './productionDraft.js';

// Actual callback/JSX extraction + real draft/focus models. Fake DOM events
// below are not a mounted React/browser or virtual-keyboard certification.
const source = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Productions.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = (root, predicate) => { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const owner = name => { const n = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(n, name); return n; };
const media = owner('MediaForm'), detail = owner('VisitDetail');
const initializer = (root, name) => { const n = nodes(root, ts.isVariableDeclaration).find(n => n.name.getText(ast) === name); assert.ok(n, name); return n.initializer; };
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
const attributes = node => new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(n => [n.name.getText(ast), n.initializer]));
const effects = root => nodes(root, ts.isCallExpression).filter(n => n.expression.getText(ast) === 'useLayoutEffect');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function aggregate(revision = 1) {
  return { id: '10000000-0000-4000-8000-000000000161', revision, cliente_id: 31, cliente_nombre: 'QA161',
    fecha: '2026-10-20', titulo: 'Visita', drive_url: '', observaciones: '', participante_ids: [91001],
    videos: [], fotos: [] };
}
function receipt(kind, revision = 2) {
  const visit = aggregate(revision);
  visit[kind] = [kind === 'videos'
    ? { id: '20000000-0000-4000-8000-000000000161', visita_id: visit.id, titulo: 'Video', guion: 'Guion',
      estado: 'grabado', material_url: '', observaciones: '' }
    : { id: '30000000-0000-4000-8000-000000000161', tipo: 'Equipo', estado: 'realizada', drive_url: '', observaciones: '' }];
  return { visita: visit };
}

test('actual JSX assigns separate persistent video/photo refs only to new forms, never edit forms', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const forms = nodes(detail, ts.isJsxSelfClosingElement).filter(n => n.tagName.getText(ast) === 'MediaForm');
  assert.equal(forms.length, 2);
  const edit = forms.find(n => attributes(n).has('item')), added = forms.find(n => !attributes(n).has('item'));
  assert.ok(edit && added);
  for (const name of ['focusReturnTarget', 'focusReturnCurrent', 'onCreated']) assert.equal(attributes(edit).has(name), false);
  assert.equal(attributes(added).get('focusReturnTarget').expression.getText(ast), 'mediaFocusTargets.current[kind]');
  assert.equal(attributes(added).get('focusReturnCurrent').expression.body.getText(ast), 'mediaFocusOwner.current');
  const ref = nodes(detail, ts.isJsxOpeningElement).find(n => n.tagName.getText(ast) === 'button' && attributes(n).has('ref'));
  assert.ok(ref); assert.equal(attributes(ref).get('ref').expression.getText(ast), 'mediaFocusTargets.current[kind]');
  const refs = evaluate(initializer(detail, 'mediaFocusTargets').arguments[0], {});
  assert.deepEqual(refs, { videos: { current: null }, fotos: { current: null } });
  assert.notEqual(refs.videos, refs.fotos);
});

test('actual submit captures the form synchronously before the first await, validates ACK before onCreated and checks child lifetime', () => {
  const submit = initializer(media, 'submit');
  const capture = nodes(submit, ts.isCallExpression).find(n => n.expression.getText(ast) === 'captureProductionMediaFocus');
  const awaited = nodes(submit, ts.isAwaitExpression)[0]; assert.ok(capture && capture.end < awaited.pos);
  const options = new Map(capture.arguments[0].properties.map(p => [p.name.getText(ast), p.initializer.getText(ast)]));
  assert.equal(options.get('form'), 'event.currentTarget'); assert.equal(options.get('target'), 'focusReturnTarget?.current');
  assert.equal(options.get('isCurrent'), 'focusReturnCurrent', 'Parent lifetime must survive successful child unmount');
  const created = nodes(submit, ts.isCallExpression).find(n => n.expression.getText(ast) === 'onCreated');
  const complete = nodes(submit, ts.isCallExpression).find(n => n.expression.getText(ast) === 'form.complete');
  assert.ok(complete.pos < created.pos);
  const gate = nodes(submit, ts.isIfStatement).find(n => nodes(n.thenStatement, ts.isCallExpression).some(c => c.expression.getText(ast) === 'onCreated'));
  assert.ok(gate.expression.getText(ast).includes('!item') && gate.expression.getText(ast).includes('focusMounted.current'));
});

function parentHarness(kind = 'videos') {
  const pendingMediaFocus = { current: null }, mediaFocusOwner = { current: false }, states = [];
  const deps = { pendingMediaFocus, mediaFocusOwner, kind, setAdding: update => states.push(update({ videos: true, fotos: true })) };
  const added = nodes(detail, ts.isJsxSelfClosingElement).find(n => n.tagName.getText(ast) === 'MediaForm' && attributes(n).has('onCreated'));
  const onCreated = evaluate(attributes(added).get('onCreated').expression, deps);
  const layout = effects(detail).find(n => n.arguments[1]?.getText(ast) === '[adding]'); assert.ok(layout);
  const restore = evaluate(layout.arguments[0], deps);
  const lifetime = effects(detail).find(n => n.arguments[0].getText(ast).includes('mediaFocusOwner.current=true')); assert.ok(lifetime);
  const cleanupLifetime = evaluate(lifetime.arguments[0], deps)();
  const cleanupEffect = effects(detail).find(n => n.arguments[1]?.getText(ast) === '[]' && n.arguments[0].getText(ast).includes('pendingMediaFocus.current?.dispose')); assert.ok(cleanupEffect);
  const cleanupPending = evaluate(cleanupEffect.arguments[0], deps)();
  return { pendingMediaFocus, mediaFocusOwner, states, onCreated, restore,
    cleanup() { cleanupLifetime(); cleanupPending(); } };
}

test('actual parent queues then restores once after adding commit; replacement and unmount only dispose', () => {
  for (const kind of ['videos', 'fotos']) {
    const p = parentHarness(kind), calls = [];
    const intent = { restore() { calls.push('restore'); }, dispose() { calls.push('dispose'); } };
    p.onCreated(intent); assert.deepEqual(calls, []); assert.equal(p.pendingMediaFocus.current, intent);
    assert.equal(p.states[0][kind], false); assert.equal(p.states[0][kind === 'videos' ? 'fotos' : 'videos'], true);
    p.restore(); p.restore(); assert.deepEqual(calls, ['restore']); assert.equal(p.pendingMediaFocus.current, null);
    p.onCreated(intent); p.onCreated(null); assert.deepEqual(calls, ['restore', 'dispose']);
    p.onCreated(intent); p.cleanup(); assert.deepEqual(calls, ['restore', 'dispose', 'dispose']);
    assert.equal(p.mediaFocusOwner.current, false); p.restore(); assert.equal(calls.filter(c => c === 'restore').length, 1);
  }
});

function domFixture() {
  const listeners = new Set();
  const trackedTarget = () => {
    const node = new EventTarget(), add = node.addEventListener.bind(node), remove = node.removeEventListener.bind(node);
    node.addEventListener = (type, listener, options) => {
      const capture = options === true || options?.capture === true;
      if (![...listeners].some(row => row.node === node && row.type === type && row.listener === listener && row.capture === capture)) listeners.add({ node, type, listener, capture });
      add(type, listener, options);
    };
    node.removeEventListener = (type, listener, options) => {
      const capture = options === true || options?.capture === true;
      for (const row of listeners) if (row.node === node && row.type === type && row.listener === listener && row.capture === capture) listeners.delete(row);
      remove(type, listener, options);
    };
    return node;
  };
  const doc = trackedTarget(), win = trackedTarget(), focus = [];
  doc.defaultView = win; doc.visibilityState = 'visible'; doc.hidden = false;
  win.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  const send = (type, target) => { const event = new Event(type); Object.defineProperty(event, 'target', { value: target }); doc.dispatchEvent(event); };
  class Element extends EventTarget {
    constructor(tag, parent = null) { super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.parentElement = parent;
      this.ownerDocument = doc; this.isConnected = true; this.disabled = false; this.attributes = new Map(); }
    contains(other) { for (let n = other; n; n = n.parentElement) if (n === this) return true; return false; }
    matches(selector) {
      return selector.split(',').some(s => {
        s = s.trim(); if (s === ':disabled') return this.disabled;
        if (s === 'dialog[open]') return this.tagName === 'DIALOG' && this.hasAttribute('open');
        if (s === '[role="dialog"][aria-modal="true"]') return this.getAttribute('role') === 'dialog' && this.getAttribute('aria-modal') === 'true';
        if (s.startsWith('[')) { const m = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s); return Boolean(m && this.hasAttribute(m[1]) && (m[2] === undefined || this.getAttribute(m[1]) === m[2])); }
        return this.tagName.toLowerCase() === s;
      });
    }
    closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
    getClientRects() { return this.isConnected ? [{}] : []; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    focus(options) { focus.push({ target: this, options }); doc.activeElement = this; send('focusin', this); }
  }
  const body = new Element('body'), form = new Element('form', body), submit = new Element('button', form);
  const target = new Element('button', body), other = new Element('button', body);
  doc.body = body; doc.documentElement = body; doc.activeElement = submit; doc.hasFocus = () => true;
  doc.querySelectorAll = () => []; doc.querySelector = () => null;
  return { doc, win, form, submit, target, other, focus, listenerCount: () => listeners.size,
    moveAway() { doc.activeElement = other; send('focusin', other); },
    removeForm() { form.isConnected = false; submit.isConnected = false; doc.activeElement = body; } };
}

async function submission({ kind = 'videos', edit = false } = {}) {
  const { captureProductionMediaFocus } = await import('./productionMediaFocus.js');
  const p = parentHarness(kind), dom = domFixture(), pending = deferred(), trace = [], errors = [], created = [], captures = [];
  const initial = edit ? receipt(kind, 1).visita : aggregate();
  const item = edit ? initial[kind][0] : undefined;
  const model = createProductionDraft(initial, productionMediaDraft(item, kind));
  model.edit({ ...model.snapshot.draft, ...(kind === 'videos' ? { titulo: 'Video', guion: 'Guion', estado: 'grabado' } : { tipo: 'Equipo', estado: 'realizada' }) });
  const form = { get draft() { return model.snapshot.draft; },
    begin() { trace.push('begin'); return model.begin(initial); },
    complete(value) {
      const fresh = verifiedProductionDraftVisit(value, initial.id);
      model.complete(fresh, productionMediaDraft(item ? fresh[kind].find(row => row.id === item.id) : null, kind));
      trace.push('validated-ACK');
    }, fail(error) { model.fail(error); trace.push('failed'); } };
  const focusMounted = { current: false }, activeMediaFocus = { current: null };
  const mount = effects(media).find(n => n.arguments[0].getText(ast).includes('focusMounted.current=true')); assert.ok(mount);
  const cleanupMedia = evaluate(mount.arguments[0], { focusMounted, activeMediaFocus })();
  const deps = { form, draft: form.draft, item, video: kind === 'videos', kind, document: dom.doc, focusMounted, activeMediaFocus,
    focusReturnTarget: { current: dom.target }, focusReturnCurrent: () => p.mediaFocusOwner.current,
    safeProductionUrl: evaluate(owner('safeProductionUrl'), {}), setError: error => errors.push(error),
    captureProductionMediaFocus(options) { trace.push('capture'); captures.push(options); return captureProductionMediaFocus(options); },
    onWrite(visit, path, method, body) { trace.push('dispatch'); assert.equal(visit.revision, 1);
      assert.equal(path, `/${kind}${item ? `/${item.id}` : ''}`); assert.equal(method, edit ? 'PATCH' : 'POST');
      assert.deepEqual(body, form.draft); return pending.promise; },
    onCreated(intent) { trace.push('created'); created.push(intent); p.onCreated(intent); },
  };
  const submit = evaluate(initializer(media, 'submit'), deps);
  const work = submit({ currentTarget: dom.form, preventDefault() {} });
  return { p, dom, pending, trace, errors, created, captures, model, focusMounted, activeMediaFocus, cleanupMedia, work };
}

for (const kind of ['videos', 'fotos']) test(`new ${kind}: real helper + actual submit restores once only after validated ACK and parent commit`, async () => {
  const f = await submission({ kind });
  assert.deepEqual(f.trace, ['capture', 'begin', 'dispatch']); assert.equal(f.dom.focus.length, 0);
  assert.equal(f.captures[0].form, f.dom.form); assert.equal(f.captures[0].target, f.dom.target);
  assert.equal(f.captures[0].isCurrent(), true);
  f.pending.resolve(receipt(kind)); await f.work;
  assert.deepEqual(f.trace, ['capture', 'begin', 'dispatch', 'validated-ACK', 'created']);
  assert.ok(f.created[0]); assert.equal(f.dom.focus.length, 0);
  assert.equal(f.activeMediaFocus.current, null, 'Confirmed intent detached before child cleanup');
  f.cleanupMedia(); f.dom.removeForm(); // Expected successful child unmount, not owner retirement.
  f.p.restore(); f.p.restore();
  assert.equal(f.dom.focus.length, 1); assert.equal(f.dom.focus[0].target, f.dom.target);
  f.p.cleanup(); assert.equal(f.dom.focus.length, 1);
  assert.equal(f.dom.listenerCount(), 0);
});

for (const kind of ['videos', 'fotos']) test(`${kind}: busy target may still be disabled at ACK, but must be enabled at post-unmount restoration`, async () => {
  const f = await submission({ kind });
  // Actual VisitDetail binds the persistent target's disabled={busy}. The
  // parent's setBusy(false) need not have committed when awaited onWrite
  // resolves into this child's submit callback.
  f.dom.target.disabled = true;
  f.pending.resolve(receipt(kind)); await f.work;
  assert.ok(f.created[0], 'Valid ACK must retain the focus intent through the pending busy=false commit');
  assert.equal(f.dom.focus.length, 0);
  f.cleanupMedia(); f.dom.removeForm(); f.dom.target.disabled = false;
  f.p.restore(); assert.equal(f.dom.focus.length, 1); assert.equal(f.dom.focus[0].target, f.dom.target);
  f.p.cleanup();
});

for (const failure of ['write', 'invalid-ACK', 'child-unmount', 'parent-unmount', 'user-focus']) test(`${failure}: no focus transfer or invalid saved callback`, async () => {
  const f = await submission();
  if (failure === 'child-unmount') f.cleanupMedia();
  if (failure === 'parent-unmount') { f.p.cleanup(); f.cleanupMedia(); }
  if (failure === 'user-focus') f.dom.moveAway();
  if (failure === 'write') f.pending.reject(Object.assign(new Error('Conflict'), { status: 409 }));
  else f.pending.resolve(failure === 'invalid-ACK' ? { visita: { id: aggregate().id, revision: 2 } } : receipt('videos'));
  await f.work;
  if (failure === 'write' || failure === 'invalid-ACK' || failure === 'child-unmount' || failure === 'parent-unmount') assert.equal(f.created.length, 0);
  else { assert.equal(f.created.length, 1); assert.equal(f.created[0], null); }
  f.dom.removeForm(); f.p.restore(); assert.equal(f.dom.focus.length, 0);
  f.p.cleanup();
  assert.equal(f.dom.listenerCount(), 0);
});

test('actual child cleanup synchronously disposes the captured intent while onWrite remains unsettled', async () => {
  const f = await submission();
  assert.ok(f.activeMediaFocus.current); assert.ok(f.dom.listenerCount() > 0);
  let settled = false; f.work.then(() => { settled = true; });
  // No server response is needed for cleanup: never hold document/window
  // listeners until an unbounded write promise happens to settle.
  f.cleanupMedia();
  assert.equal(settled, false); assert.equal(f.focusMounted.current, false);
  assert.equal(f.activeMediaFocus.current, null); assert.equal(f.dom.listenerCount(), 0);
  assert.equal(f.created.length, 0); assert.equal(f.dom.focus.length, 0);
  f.p.cleanup(); assert.equal(f.dom.listenerCount(), 0);
  f.pending.resolve(receipt('videos')); await f.work;
  assert.equal(f.created.length, 0); assert.equal(f.dom.listenerCount(), 0); assert.equal(f.dom.focus.length, 0);
});

test('owner retirement between confirmed ACK and layout disposes pending intent without focus', async () => {
  const f = await submission(); f.pending.resolve(receipt('videos')); await f.work;
  assert.ok(f.created[0]); f.cleanupMedia(); f.dom.removeForm(); f.p.cleanup(); f.p.restore();
  assert.equal(f.dom.focus.length, 0);
  assert.equal(f.dom.listenerCount(), 0);
});

for (const kind of ['videos', 'fotos']) test(`existing ${kind} edit never creates a return-focus intent or invokes creation callback`, async () => {
  const f = await submission({ kind, edit: true }); f.pending.resolve(receipt(kind)); await f.work;
  assert.equal(f.captures.length, 0); assert.equal(f.created.length, 0); assert.equal(f.dom.focus.length, 0);
  assert.equal(f.model.snapshot.blocked, false); f.p.cleanup();
});
