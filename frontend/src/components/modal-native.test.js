import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Actual component JSX/hooks with injected effects and simulated native objects.
// SSR does not exercise the browser top layer, inert behavior or real focus trap.
const source = readFileSync(new URL('./Modal.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Modal.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const owner = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'Modal');
const compiled = ts.transpileModule(owner.getText(ast), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function component(deps) {
  const exports = {};
  new Function('exports', ...Object.keys(deps), compiled)(exports, ...Object.values(deps));
  return exports.Modal;
}
const SSRModal = component({ React, useRef: React.useRef, useEffect: React.useEffect });
const markup = props => renderToStaticMarkup(React.createElement(SSRModal, { title: React.createElement('h2', null, 'Title'), ...props }, React.createElement('p', null, 'Body')));
function fixture(props = {}) {
  const refs = [], listeners = new Map(), events = []; let cursor = 0, effect, effectDeps, tree;
  const invoker = { isConnected: true, disabled: false, matches: () => false, closest: () => null, focus: () => events.push('invoker-focus') };
  const document = { activeElement: invoker };
  const window = { addEventListener: (name, fn) => { assert.equal(listeners.has(name), false); listeners.set(name, fn); }, removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  const Modal = component({ React, document, window, useRef: value => refs[cursor++] ||= { current: value }, useEffect: (fn, deps) => { effect = fn; effectDeps = deps; } });
  let currentProps = { onClose: () => events.push('close'), ...props };
  const render = changes => { cursor = 0; currentProps = { ...currentProps, ...changes }; tree = Modal(currentProps); return tree; };
  render({});
  const closeButton = { focus: () => events.push('close-focus') };
  const dialog = { open: false, showModal() { events.push('show'); this.open = true; }, close() { events.push('dialog-close'); this.open = false; } };
  refs[0].current = closeButton; refs[2].current = dialog;
  return { refs, listeners, events, document, invoker, dialog, render, get tree() { return tree; }, mount: () => effect(), get effectDeps() { return effectDeps; } };
}
const buttonOf = f => f.tree.props.children.props.children[0].props.children[1];
const event = (key = 'Escape') => { const calls = []; return { key, calls, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') }; };

test('SSR default remains one legacy div dialog with unchanged chrome and enabled close', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const html = markup({ overlayAriaLabel: 'Legacy overlay', className: 'extra' });
  assert.match(html, /^<div class="modal-overlay open" role="dialog" aria-modal="true" aria-label="Legacy overlay">/);
  assert.match(html, /class="modal extra"/); assert.match(html, /class="modal-header"/); assert.match(html, /aria-label="Cerrar"/); assert.match(html, /<p>Body<\/p>/);
  assert.doesNotMatch(html, /<dialog|render-native-dialog|disabled=|aria-busy=/);
  assert.equal((html.match(/role="dialog"/g) || []).length, 1);
});
test('SSR opt-in uses a single native dialog, busy semantics and disabled custom close', () => {
  const html = markup({ native: true, closeDisabled: true, closeLabel: 'Do not close', overlayAriaLabel: 'Native overlay' });
  assert.match(html, /^<dialog class="modal-overlay open render-native-dialog" role="dialog" aria-modal="true" aria-label="Native overlay" aria-busy="true" tabindex="-1">/);
  assert.equal((html.match(/<dialog\b/g) || []).length, 1); assert.equal((html.match(/role="dialog"/g) || []).length, 1);
  assert.match(html, /aria-label="Do not close" disabled=""/); assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:=|>)/);
});
test('native hook promotes before initial focus, installs no global Escape and closes/restores on cleanup', () => {
  const f = fixture({ native: true, initialFocusRef: { current: { focus: () => f.events.push('initial-focus') } } });
  const cleanup = f.mount(); assert.deepEqual(f.effectDeps, [true]); assert.deepEqual(f.events, ['show', 'initial-focus']); assert.equal(f.listeners.size, 0);
  cleanup(); assert.deepEqual(f.events, ['show', 'initial-focus', 'dialog-close', 'invoker-focus']); assert.equal(f.dialog.open, false);
});
test('native hook focuses close fallback and never calls showModal twice on already open dialog', () => {
  const f = fixture({ native: true }); f.dialog.open = true;
  const cleanup = f.mount(); assert.deepEqual(f.events, ['close-focus']); cleanup(); assert.deepEqual(f.events, ['close-focus', 'dialog-close', 'invoker-focus']);
});
test('explicit return target survives an invoker disabled before effect and restores only after it becomes usable', () => {
  const target = { isConnected: true, disabled: true, matches: () => false, closest: () => null, focus() { events.push('explicit-focus'); } };
  const returnFocusRef = { current: target }, events = [];
  const f = fixture({ native: true, returnFocusRef });
  f.document.activeElement = null;
  const cleanup = f.mount(); target.disabled = false; cleanup();
  assert.deepEqual(events, ['explicit-focus']);
  assert.equal(f.events.includes('invoker-focus'), false);
  const locked = fixture({ native: true, returnFocusRef }); target.disabled = true;
  locked.mount()(); assert.deepEqual(events, ['explicit-focus'], 'Never focus an invoker still disabled');
});
test('cleanup consults the latest explicit return ref and excludes retired disconnected or inert targets', () => {
  const f = fixture({ native: true });
  const cleanup = f.mount(), events = [];
  const target = { isConnected: true, disabled: false, matches: () => false, closest: () => null, focus: () => events.push('replacement') };
  f.render({ returnFocusRef: { current: target } }); cleanup(); assert.deepEqual(events, ['replacement']);
  for (const mode of ['disconnected', 'disabled', 'inert']) {
    const g = fixture({ native: true, returnFocusRef: { current: { ...target, isConnected: mode !== 'disconnected', disabled: mode === 'disabled', closest: () => mode === 'inert' ? {} : null } } });
    g.mount()(); assert.deepEqual(events, ['replacement'], mode);
  }
  const removed = fixture({ native: true }), finish = removed.mount();
  removed.render({ returnFocusRef: { current: null } }); finish();
  assert.equal(removed.events.includes('invoker-focus'), false, 'Explicitly missing target does not resurrect an old invoker');
});
test('retained native cancel/button handlers consult latest callback and busy state', () => {
  const f = fixture({ native: true }), cleanup = f.mount();
  const cancel = f.tree.props.onCancel, click = buttonOf(f).props.onClick;
  const first = event(); cancel(first); assert.deepEqual(first.calls, ['prevent', 'stop']); assert.equal(f.events.filter(x => x === 'close').length, 1);
  f.render({ closeDisabled: true, onClose: () => f.events.push('new-close') });
  assert.equal(buttonOf(f).props.disabled, true); cancel(event()); click(); assert.equal(f.events.includes('new-close'), false);
  f.render({ closeDisabled: false }); cancel(event()); click(); assert.equal(f.events.filter(x => x === 'new-close').length, 2); cleanup();
});
test('native Escape keydown stops bubbling only; cancel owns close while other keys pass through', () => {
  const f = fixture({ native: true }), escape = event(), enter = event('Enter');
  f.tree.props.onKeyDown(escape); f.tree.props.onKeyDown(enter);
  assert.deepEqual(escape.calls, ['stop']); assert.deepEqual(enter.calls, []); assert.deepEqual(f.events, []);
});
test('legacy global Escape uses latest close guard and removes exact listener on cleanup', () => {
  const f = fixture(), cleanup = f.mount(); assert.deepEqual(f.effectDeps, [false]); assert.deepEqual(f.events, ['close-focus']);
  const handler = f.listeners.get('keydown'); assert.ok(handler); handler(event('Enter')); assert.deepEqual(f.events, ['close-focus']);
  f.render({ closeDisabled: true, onClose: () => f.events.push('latest') }); handler(event()); assert.equal(f.events.includes('latest'), false);
  f.render({ closeDisabled: false }); handler(event()); assert.equal(f.events.at(-1), 'latest'); cleanup();
  assert.equal(f.listeners.size, 0); assert.equal(f.events.includes('show'), false); assert.equal(f.events.includes('dialog-close'), false);
});
test('backdrop close is explicit, target-only and respects latest busy for either overlay', () => {
  for (const native of [false, true]) {
    const f = fixture({ native }), target = {};
    f.tree.props.onMouseDown({ target, currentTarget: target }); assert.deepEqual(f.events, []);
    f.render({ closeOnBackdropClick: true }); const handler = f.tree.props.onMouseDown;
    handler({ target: {}, currentTarget: target }); assert.deepEqual(f.events, []);
    handler({ target, currentTarget: target }); assert.deepEqual(f.events, ['close']);
    f.render({ closeDisabled: true }); handler({ target, currentTarget: target }); assert.deepEqual(f.events, ['close']);
  }
});
test('cleanup restores only usable invokers, never disconnected, disabled or inert targets', () => {
  for (const mode of ['disconnected', 'disabled', 'matches-disabled', 'inert', 'absent']) {
    const f = fixture({ native: true });
    if (mode === 'disconnected') f.invoker.isConnected = false;
    if (mode === 'disabled') f.invoker.disabled = true;
    if (mode === 'matches-disabled') f.invoker.matches = () => true;
    if (mode === 'inert') f.invoker.closest = () => ({});
    if (mode === 'absent') f.document.activeElement = null;
    const cleanup = f.mount(); assert.doesNotThrow(cleanup); assert.equal(f.events.includes('invoker-focus'), false, mode); assert.equal(f.events.includes('dialog-close'), true);
  }
});
test('unsupported or throwing showModal fails closed without throwing and obeys busy close guard', () => {
  for (const unsupported of [true, false]) for (const closeDisabled of [true, false]) {
    const f = fixture({ native: true, closeDisabled });
    if (unsupported) f.dialog.showModal = undefined; else f.dialog.showModal = () => { throw Error('unsupported'); };
    assert.doesNotThrow(() => assert.equal(f.mount(), undefined));
    assert.deepEqual(f.events, closeDisabled ? [] : ['close']); assert.equal(f.listeners.size, 0);
  }
});

function tabFixture() {
  const f = fixture({ native: true });
  let controls = [];
  f.dialog.querySelectorAll = selector => {
    assert.equal(selector, 'button, input, select, textarea, a[href], [tabindex]');
    return controls;
  };
  f.dialog.contains = element => element === f.dialog || controls.includes(element);
  f.dialog.focus = () => { f.events.push('root-focus'); f.document.activeElement = f.dialog; };
  const control = (name, { tabIndex = 0, disabled = false, inert = false, visible = true } = {}) => ({
    name, tabIndex,
    matches: selector => { assert.equal(selector, ':disabled'); return disabled; },
    closest: selector => { assert.equal(selector, '[inert]'); return inert ? {} : null; },
    getClientRects: () => visible ? [{}] : [],
    focus() { f.events.push(name); f.document.activeElement = this; },
  });
  const tab = (active, shiftKey = false, defaultPrevented = false) => {
    f.document.activeElement = active;
    const e = { ...event('Tab'), shiftKey, defaultPrevented };
    f.tree.props.onKeyDown(e); return e;
  };
  return { ...f, control, tab, setControls: value => { controls = value; } };
}
test('actual native Tab handler wraps first ShiftTab and last forward, but leaves interior movement to UA', () => {
  const f = tabFixture(), first = f.control('first-close'), middle = f.control('middle'), last = f.control('last');
  f.setControls([first, middle, last]);
  assert.deepEqual(f.tab(first, true).calls, ['prevent']); assert.equal(f.document.activeElement, last);
  assert.deepEqual(f.tab(last).calls, ['prevent']); assert.equal(f.document.activeElement, first);
  for (const [active, shift] of [[first, false], [middle, false], [middle, true], [last, true]]) {
    const before = [...f.events]; assert.deepEqual(f.tab(active, shift).calls, []);
    assert.equal(f.document.activeElement, active); assert.deepEqual(f.events, before);
  }
  assert.equal(f.tree.props.tabIndex, -1);
  const legacy = fixture(); assert.equal(legacy.tree.props.onKeyDown, undefined); assert.equal(legacy.tree.props.tabIndex, undefined);
});
test('native Tab excludes disabled, inert, hidden and negative tabindex controls at either boundary', () => {
  const f = tabFixture(), first = f.control('first'), last = f.control('last');
  const excluded = [f.control('disabled', { disabled: true }), f.control('inert', { inert: true }), f.control('hidden', { visible: false }), f.control('negative', { tabIndex: -1 })];
  f.setControls([...excluded, first, last, ...excluded]);
  assert.deepEqual(f.tab(first, true).calls, ['prevent']); assert.equal(f.document.activeElement, last);
  assert.deepEqual(f.tab(last).calls, ['prevent']); assert.equal(f.document.activeElement, first);
  assert.deepEqual(f.events, ['last', 'first']);
});
test('native Tab with no usable controls focuses dialog itself; single control wraps both ways', () => {
  const f = tabFixture();
  for (const controls of [[], [f.control('disabled', { disabled: true }), f.control('hidden', { visible: false })]]) {
    f.setControls(controls);
    for (const shift of [false, true]) {
      assert.deepEqual(f.tab(f.invoker, shift).calls, ['prevent']); assert.equal(f.document.activeElement, f.dialog);
    }
  }
  const only = f.control('only'); f.setControls([only]);
  for (const shift of [false, true]) { assert.deepEqual(f.tab(only, shift).calls, ['prevent']); assert.equal(f.document.activeElement, only); }
});
test('native Tab from external active element reenters correct boundary; prevented Tab is untouched', () => {
  const f = tabFixture(), first = f.control('first'), last = f.control('last'); f.setControls([first, last]);
  for (const active of [f.invoker, null]) {
    assert.deepEqual(f.tab(active).calls, ['prevent']); assert.equal(f.document.activeElement, first);
    assert.deepEqual(f.tab(active, true).calls, ['prevent']); assert.equal(f.document.activeElement, last);
  }
  const before = [...f.events]; assert.deepEqual(f.tab(last, false, true).calls, []);
  assert.deepEqual(f.events, before); assert.equal(f.document.activeElement, last);
});
test('retained native handler uses current dialog ref and freshly queries controls after busy/DOM changes', () => {
  const f = tabFixture(), original = f.control('original'); f.setControls([original]);
  const handler = f.tree.props.onKeyDown, currentControl = f.control('replacement'); let queries = 0;
  const replacement = { querySelectorAll: () => { queries++; return [currentControl]; }, contains: active => active === currentControl };
  f.refs[2].current = replacement; f.document.activeElement = f.invoker;
  f.render({ closeDisabled: true }); const e = { ...event('Tab'), shiftKey: false }; handler(e);
  assert.deepEqual(e.calls, ['prevent']); assert.equal(queries, 1); assert.equal(f.document.activeElement, currentControl);
  assert.deepEqual(f.events, ['replacement']);
  f.refs[2].current = null; const absent = event('Tab'); assert.doesNotThrow(() => handler(absent)); assert.deepEqual(absent.calls, []);
});
