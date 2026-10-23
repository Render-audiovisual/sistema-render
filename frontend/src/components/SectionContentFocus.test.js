import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Execute the actual hook with simulated layout commits/core leases. Native
// focus resolution, observer behavior and browser top layer belong to core/QA.
const source = readFileSync(new URL('./SectionContentFocus.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SectionContentFocus.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const hook = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useSectionContentFocus');
const compiled = ts.transpileModule(hook.getText(ast), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(initial = {}) {
  const slots = [], managers = [], events = []; let cursor = 0, queued = [], result;
  let props = { sectionKey: '/inicio', owner: 0, enabled: true, ...initial };
  const document = Object.freeze({ marker: 'document' }), window = Object.freeze({ marker: 'window' });
  const deps = { React, document, window,
    useRef(initialValue) { const i = cursor++; return slots[i] ||= { current: initialValue }; },
    useLayoutEffect(fn, dependencies) {
      const i = cursor++, prior = slots[i];
      if (!prior || dependencies.some((value, j) => !Object.is(value, prior.dependencies[j]))) {
        const slot = { dependencies, cleanup: prior?.cleanup }; slots[i] = slot;
        queued.push(() => { prior?.cleanup?.(); slot.cleanup = fn(); });
      }
    },
    createSectionFocusManager(options) {
      const state = { options, disposed: false, requests: [] };
      state.manager = { request(input = {}) { state.requests.push(input); events.push(['request', input, options.isCurrent()]); return !state.disposed && options.isCurrent(); },
        dispose() { state.disposed = true; events.push(['dispose']); } };
      managers.push(state); return state.manager;
    },
  };
  const exports = {}; new Function('exports', ...Object.keys(deps), compiled)(exports, ...Object.values(deps));
  const render = changes => { props = { ...props, ...changes }; cursor = 0; result = exports.useSectionContentFocus(props); return result; };
  const commit = () => { const pending = queued; queued = []; pending.forEach(fn => fn()); };
  const marker = { isConnected: true }; render({}); if (result.marker) result.marker.props.ref.current = marker;
  return { render, commit, managers, events, document, window, marker, get result() { return result; },
    cleanup() { slots.forEach(slot => { slot?.cleanup?.(); if (slot?.cleanup) slot.cleanup = undefined; }); } };
}
function click(patch = {}) {
  const calls = []; return { button: 0, defaultPrevented: false, ...patch, preventDefault() { calls.push('preventDefault'); }, calls };
}
test('hook returns separate semantic skip anchor and hidden nonfocusable span, never a dashboard wrapper', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const f = fixture(), { skipLink, marker } = f.result;
  assert.equal(skipLink.type, 'a'); assert.equal(skipLink.props.href, '#render-main-content'); assert.equal(skipLink.props.children, 'Ir al contenido');
  assert.equal(marker.type, 'span'); assert.equal(marker.props.id, 'render-main-content'); assert.equal(marker.props.hidden, true); assert.equal(marker.props['aria-hidden'], 'true');
  assert.equal(marker.props.tabIndex, undefined); assert.equal(marker.props.role, undefined); assert.equal(marker.props.children, undefined);
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, skipLink, marker));
  assert.match(html, /^<a class="render-section-skip-link" href="#render-main-content">Ir al contenido<\/a><span id="render-main-content" hidden="" aria-hidden="true"><\/span>$/);
});
test('owner zero is valid and manager activates only in layout after marker attachment', () => {
  const f = fixture(); assert.equal(f.managers.length, 0); f.commit();
  assert.equal(f.managers.length, 1); const manager = f.managers[0];
  assert.equal(manager.options.documentTarget, f.document); assert.equal(manager.options.windowTarget, f.window);
  assert.equal(manager.options.readMarker(), f.marker); assert.equal(manager.options.isCurrent(), true); assert.deepEqual(manager.requests, [{}]);
  const replacement = {}; f.result.marker.props.ref.current = replacement; assert.equal(manager.options.readMarker(), replacement); f.cleanup();
});
test('same section/owner rerenders do not request automatic focus or replace manager', () => {
  const f = fixture(); f.commit(); const manager = f.managers[0];
  for (let i = 0; i < 5; i++) { f.render({}); f.commit(); }
  assert.equal(f.managers.length, 1); assert.equal(manager.options.isCurrent(), true); assert.deepEqual(manager.requests, [{}]); f.cleanup();
});
test('section and owner replacements fence old manager during render before cleanup, including ABA', () => {
  for (const field of ['sectionKey', 'owner']) {
    const f = fixture(); f.commit(); const old = f.managers[0], oldSkip = f.result.skipLink.props.onClick;
    f.render({ [field]: field === 'sectionKey' ? '/proyectos' : 1 }); assert.equal(old.options.isCurrent(), false); assert.equal(old.disposed, false);
    f.commit(); const next = f.managers[1]; assert.equal(old.disposed, true); assert.equal(next.options.isCurrent(), true);
    f.render({ [field]: field === 'sectionKey' ? '/inicio' : 0 });
    assert.equal(old.options.isCurrent(), false); assert.equal(next.options.isCurrent(), false);
    f.commit(); const latest = f.managers[2], event = click(); oldSkip(event);
    assert.deepEqual(event.calls, ['preventDefault']); assert.deepEqual(latest.requests, [{}]); assert.equal(old.options.isCurrent(), false); f.cleanup();
  }
});
test('disable immediately fences owner, hides nodes and disposes without requesting or transferring focus', () => {
  const f = fixture(); f.commit(); const old = f.managers[0], before = f.events.length;
  f.render({ enabled: false }); assert.equal(old.options.isCurrent(), false); assert.deepEqual(f.result, { skipLink: null, marker: null });
  f.commit(); assert.deepEqual(f.events.slice(before), [['dispose']]);
  f.render({ enabled: true }); f.commit(); assert.equal(f.managers.length, 2); assert.equal(old.options.isCurrent(), false); f.cleanup();
  const disabled = fixture({ enabled: false }); disabled.commit(); assert.equal(disabled.managers.length, 0); disabled.cleanup();
});
test('plain left and keyboard click prevent fragment default and request explicit focus only on current lease', () => {
  const f = fixture(); f.commit();
  for (const patch of [{}, { button: undefined, detail: 0 }, { button: 0, detail: 0 }]) {
    const event = click(patch); f.result.skipLink.props.onClick(event); assert.deepEqual(event.calls, ['preventDefault']); assert.deepEqual(f.managers[0].requests.at(-1), { explicit: true });
  }
  assert.equal(f.managers[0].requests.length, 4); f.cleanup();
});
test('modified, middle/right and already-prevented clicks retain native behavior and never request focus', () => {
  const f = fixture(); f.commit();
  for (const patch of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    const event = click(patch); f.result.skipLink.props.onClick(event); assert.deepEqual(event.calls, []);
  }
  assert.deepEqual(f.managers[0].requests, [{}]); f.cleanup();
});
test('before-layout or cleaned-up skip clicks are bounded no-ops; cleanup never transfers focus', () => {
  const f = fixture(), early = click(); f.result.skipLink.props.onClick(early); assert.deepEqual(early.calls, ['preventDefault']); assert.equal(f.managers.length, 0);
  f.commit(); const retained = f.result.skipLink.props.onClick, manager = f.managers[0]; f.cleanup();
  const late = click(); retained(late); assert.deepEqual(late.calls, ['preventDefault']); assert.deepEqual(manager.requests, [{}]); assert.equal(manager.options.isCurrent(), false);
  assert.deepEqual(f.events.at(-1), ['dispose']); assert.doesNotMatch(source, /history\.|location\.|navigateWithinApp|requestAppNavigation|\.focus\(/);
});
test('CSS keeps existing tokens, focus-only link, bounded mobile scroll margin and no broad main/sidebar overrides', () => {
  const css = readFileSync(new URL('./SectionContentFocus.css', import.meta.url), 'utf8');
  assert.match(css, /\.render-section-skip-link\s*\{/); assert.match(css, /position: fixed/); assert.match(css, /min-height: 44px/);
  assert.match(css, /\.render-section-skip-link:focus\s*\{\s*transform: none/); assert.match(css, /var\(--render-accent\)/); assert.match(css, /var\(--render-font\)/);
  assert.match(css, /\[data-render-section-focus-target\]:focus/); assert.match(css, /@media \(max-width: 980px\)/); assert.match(css, /scroll-margin-top: calc\(88px/);
  assert.doesNotMatch(css, /:root|\.sidebar|\bmain\s*\{|!important|transition: all|#[a-f\d]{3,8}\b/i);
});
