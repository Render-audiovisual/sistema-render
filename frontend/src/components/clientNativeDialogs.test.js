import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Actual JSX bindings and callback bodies; SSR is not native-browser focus QA.
function parse(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  return ast;
}
function find(root, predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(root); return result;
}
const clients = parse('./ClienteModals.jsx');
const agreement = parse('./StartMonthlyAgreementModal.jsx');
const page = parse('../pages/Clientes.jsx');
const modalAst = parse('./Modal.jsx');
const modal = modalAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'Modal');
const compilerOptions = { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const exports = {};
new Function('exports', 'React', 'useRef', 'useEffect', ts.transpileModule(modal.getText(modalAst), { compilerOptions }).outputText)(exports, React, React.useRef, React.useEffect);
function evaluate(expression, deps) {
  const code = ts.transpileModule(`const result = (${expression});`, { compilerOptions }).outputText;
  return new Function('React', ...Object.keys(deps), `${code};return result;`)(React, ...Object.values(deps));
}
const openings = root => find(root, n => ts.isJsxOpeningElement(n) && n.tagName.getText(root.getSourceFile()) === 'Modal');
const configs = [
  [clients, ['Acceso no disponible', 'Editar nombre y estado del cliente', 'Editar cuota mensual', 'Acceso no disponible', 'Detalle del cliente'], ['busy', 'busy', 'guardando', 'enviando !== null', 'enviando !== null || editandoCuota || startingAgreement'], ['closeIdentity', 'closeIdentity', 'closeEditor', 'closeDetail', 'closeDetail']],
  [agreement, ['Acceso no disponible', 'Configurar primer acuerdo mensual'], ['state.busy||publishing.current||closing.current', 'state.busy||publishing.current||closing.current'], ['closeSafely', 'closeSafely']],
  [page, ['Nuevo cliente'], ['guardandoCliente'], ['cerrarAltaCliente']],
];
const compact = text => text.replace(/\s/g, '');
test('client form CSS excludes checkable controls from full-width text inputs and preserves the scoped active-toggle row', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.trim().split(',').map(s => s.trim()), body }));
  const rule = selector => {
    const matches = rules.filter(r => r.selectors.includes(selector));
    assert.equal(matches.length, 1, `one unambiguous rule for ${selector}`);
    return Object.fromEntries(matches[0].body.split(';').filter(part => part.trim()).map(part => {
      const colon = part.indexOf(':'); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    }));
  };
  assert.equal(rules.some(r => r.selectors.includes('.cliente-create-modal-body input')), false, 'unqualified text-input sizing must not return');
  const text = rule('.cliente-create-modal-body input:not([type="checkbox"]):not([type="radio"])');
  assert.equal(text.width, '100%'); assert.equal(text['min-height'], '38px');
  const toggle = rule('.cliente-create-modal-body .cliente-active-toggle');
  assert.equal(toggle.display, 'flex'); assert.equal(toggle['min-height'], '44px');
  assert.ok(!toggle['flex-direction'] || toggle['flex-direction'] === 'row');
  const checkbox = rule('.cliente-active-toggle input[type="checkbox"]');
  assert.equal(checkbox.width, '18px'); assert.equal(checkbox.height, '18px'); assert.equal(checkbox['min-height'], '18px');
  assert.equal(checkbox.flex, '0 0 18px'); assert.equal(checkbox.padding, '0'); assert.equal(checkbox['accent-color'], 'var(--render-accent)');
  const inputs = find(clients, n => ts.isJsxOpeningElement(n) && n.tagName.getText(clients) === 'label' && n.attributes.properties.some(p => p.name?.text === 'className' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'cliente-active-toggle'));
  assert.ok(inputs.length, 'CSS must remain bound to an actual client editor toggle');
});
function propsFor(opening, ast, deps) {
  return Object.fromEntries(opening.attributes.properties.filter(p => p.name?.text !== 'key').map(p => {
    assert.ok(ts.isJsxAttribute(p), 'no opaque spread may conceal modal bindings');
    const value = !p.initializer ? true : ts.isStringLiteral(p.initializer) ? p.initializer.text : evaluate(p.initializer.expression.getText(ast), deps);
    return [p.name.text, value];
  }));
}
for (const [ast, labels, busyExpressions, callbacks] of configs) {
  test(`${ast.fileName}: exact native dialog labels, close bindings and all busy branches`, () => {
    const nodes = openings(ast); assert.equal(nodes.length, labels.length);
    nodes.forEach((node, index) => {
      const deps = { returnFocusRef: { current: null }, busy: false, guardando: false, guardandoCliente: false, enviando: null, editandoCuota: false, startingAgreement: false, state: { busy: false }, publishing: { current: false }, closing: { current: false }, cliente: { nombre: 'Cliente QA' }, nameInputRef: { current: null }, closeIdentity() {}, closeEditor() {}, closeDetail() {}, closeSafely() {}, cerrarAltaCliente() {} };
      const attr = name => node.attributes.properties.find(p => p.name?.text === name);
      assert.equal(compact(attr('closeDisabled').initializer.expression.getText(ast)), compact(busyExpressions[index]));
      assert.equal(attr('onClose').initializer.expression.getText(ast), callbacks[index]);
      const props = propsFor(node, ast, deps);
      assert.equal(props.native, true); assert.equal(props.overlayAriaLabel, labels[index]); assert.equal(props.closeDisabled, false);
      assert.equal(props.onClose, deps[callbacks[index]]);
      if (index === 1 && ast === clients) assert.equal(props.initialFocusRef, deps.nameInputRef);
      const html = renderToStaticMarkup(React.createElement(exports.Modal, props, 'QA body'));
      assert.match(html, /^<dialog\b/); assert.equal((html.match(/<dialog\b/g) || []).length, 1);
      assert.ok(html.includes(`aria-label="${labels[index]}"`)); assert.doesNotMatch(html, /disabled=""/);
      const expression = busyExpressions[index];
      const branches = expression.includes('state.busy') ? [{ state: { busy: true } }, { publishing: { current: true } }, { closing: { current: true } }]
        : expression.includes('enviando') ? [{ enviando: 'send' }, ...(expression.includes('editandoCuota') ? [{ editandoCuota: true }, { startingAgreement: true }] : [])]
          : [{ [expression]: true }];
      for (const branch of branches) {
        const busyProps = propsFor(node, ast, { ...deps, ...branch }); assert.equal(busyProps.closeDisabled, true);
        const busyHtml = renderToStaticMarkup(React.createElement(exports.Modal, busyProps));
        assert.match(busyHtml, /aria-busy="true"/); assert.match(busyHtml, /aria-label="Cerrar" disabled=""/);
      }
    });
  });
}
function callback(ast, name, deps) {
  const declarations = find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
  assert.equal(declarations.length, 1); return evaluate(declarations[0].initializer.getText(ast), deps);
}
test('actual identity/quota/detail close callbacks retain pending, session and draft guards', () => {
  for (const name of ['closeIdentity', 'closeEditor', 'closeDetail']) {
    const events = []; let current = true, accept = true;
    const deps = { pending: { current: false }, nestedEditing: { current: false }, accessDenied: { current: false }, locked: { current: false }, snapshot: 'draft', baseline: { current: 'saved' }, capture: () => ({ current: () => current, assertCurrent: () => assert.ok(current) }), window: { confirm: () => { events.push('confirm'); return accept; } }, onClose: () => events.push('close') };
    const close = callback(clients, name, deps);
    deps.pending.current = true; close(); assert.deepEqual(events, []);
    deps.pending.current = false; current = false; close(); assert.deepEqual(events, []); current = true;
    if (name === 'closeDetail') { deps.nestedEditing.current = true; close(); assert.deepEqual(events, []); deps.nestedEditing.current = false; }
    else { accept = false; close(); assert.deepEqual(events, ['confirm']); events.length = 0; accept = true; }
    close(); assert.equal(events.at(-1), 'close');
  }
});
test('nested editor return-focus refs originate at the actual invoker buttons and survive both scoped wrappers', () => {
  const attr = (node, name) => node.attributes.properties.find(p => p.name?.text === name);
  const refs = [];
  for (const [tag, setter] of [['EditarCuotaClienteModal', 'setEditandoCuota'], ['StartMonthlyAgreementModal', 'setStartingAgreement']]) {
    const child = find(clients, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(clients) === tag)[0];
    const binding = attr(child, 'returnFocusRef'); assert.ok(binding, `${tag} must receive its explicit invoker ref`);
    const name = binding.initializer.expression.getText(clients); refs.push(name);
    const declarations = find(clients, n => ts.isVariableDeclaration(n) && n.name.getText(clients) === name);
    assert.equal(declarations.length, 1); assert.equal(compact(declarations[0].initializer.getText(clients)), 'useRef(null)');
    const buttons = find(clients, n => ts.isJsxOpeningElement(n) && n.tagName.getText(clients) === 'button' && attr(n, 'ref')?.initializer?.expression?.getText(clients) === name);
    assert.equal(buttons.length, 1, 'ref must belong to exactly one real button');
    const click = attr(buttons[0], 'onClick').initializer.expression.getText(clients);
    assert.match(click, new RegExp(`${setter}\\(true\\)`));
    assert.ok(attr(buttons[0], 'disabled'), 'invoker remains protected while child is open');
    const identity = { current: { id: tag } };
    assert.equal(evaluate(binding.initializer.expression.getText(clients), { [name]: identity }), identity);
  }
  assert.notEqual(refs[0], refs[1], 'agreement and edit must restore their own invokers');
  for (const [ast, wrapperName, sessionNames] of [[clients, 'EditarCuotaClienteModal', ['EditarIdentidadSession', 'EditarCuotaSession']], [agreement, 'StartMonthlyAgreementModal', ['StartMonthlyAgreementSession']]]) {
    const wrapper = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === wrapperName);
    for (const sessionName of sessionNames) {
      const mount = find(wrapper, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === sessionName)[0];
      assert.ok(mount);
      assert.ok(mount.attributes.properties.some(p => ts.isJsxSpreadAttribute(p) && p.expression.getText(ast) === 'props'), 'wrapper forwards the same optional ref through props');
      const session = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === sessionName);
      assert.ok(session.parameters[0].name.elements.some(e => e.name.getText(ast) === 'returnFocusRef'));
      const nodes = openings(session); assert.ok(nodes.length);
      for (const node of nodes) {
        const value = attr(node, 'returnFocusRef'); assert.ok(value, `${sessionName} must forward on normal and denied branches`);
        const identity = { current: {} };
        assert.equal(evaluate(value.initializer.expression.getText(ast), { returnFocusRef: identity }), identity);
      }
    }
  }
});
test('actual monthly close waits through publication/closing and asks before losing a draft', () => {
  let current = true; const events = [];
  const deps = { agreementBodyRef: { current: null }, confirmClose: false, closeFocusIntent: { current: null }, capture: () => ({ current: () => current }), operation: { snapshot: { busy: false, status: 'ready', attempted: false } }, publishing: { current: false }, closing: { current: false }, dirty: true, setConfirmClose: value => events.push(['confirm', value]), closeNow: () => events.push(['close']) };
  const close = callback(agreement, 'closeSafely', deps);
  for (const ref of [deps.publishing, deps.closing]) { ref.current = true; close(); ref.current = false; }
  deps.operation.snapshot.busy = true; close(); deps.operation.snapshot.busy = false; current = false; close(); assert.deepEqual(events, []);
  current = true; close(); assert.deepEqual(events, [['confirm', true]]);
  deps.operation.snapshot.status = 'saved'; close(); assert.deepEqual(events.at(-1), ['close']);
});

function monthlyFocusFixture() {
  let current = true, capturedCurrent = true;
  const events = [], doc = { hidden: false, hasFocus: () => true, body: {} };
  const dialog = { isConnected: true, open: true };
  function control(name) {
    return { name, isConnected: true, ownerDocument: doc, disabled: false, hidden: false,
      matches(selector) { assert.equal(selector, ':disabled'); return this.disabled; },
      closest(selector) { return selector === 'dialog[open]' ? dialog.open ? dialog : null : this.hidden ? {} : null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      focus(options) { events.push(['focus', name, options]); doc.activeElement = this; },
      scrollIntoView(options) { events.push(['scroll', name, options]); },
    };
  }
  const origin = control('rubro'), keep = control('keep'), outside = control('outside'); doc.activeElement = origin;
  const deps = { agreementBodyRef: { current: control('body') }, allowed: true, state: { status: 'ready' }, confirmClose: false, dirty: true,
    capture: () => ({ current: () => current }), operation: { snapshot: { status: 'ready', busy: false, attempted: false } },
    publishing: { current: false }, closing: { current: false }, keepDraftButtonRef: { current: keep }, closeFocusIntent: { current: null }, returnDraftFocus: { current: null },
    setConfirmClose(value) { deps.confirmClose = value; }, closeNow() { assert.fail('draft confirmation cannot close'); },
  };
  const layout = find(agreement, n => ts.isCallExpression(n) && n.expression.getText(agreement) === 'useLayoutEffect');
  assert.equal(layout.length, 2);
  assert.equal(layout[0].arguments[1].getText(agreement), '[]');
  assert.equal(compact(layout[1].arguments[1].getText(agreement)), '[confirmClose,state.status,allowed,capture]');
  const run = () => evaluate(layout[1].arguments[0].getText(agreement), deps)();
  const cleanup = evaluate(layout[0].arguments[0].getText(agreement), deps)();
  const ask = () => {
    callback(agreement, 'closeSafely', deps)();
    // The captured guard and the live capture are independently fenced.
    if (deps.closeFocusIntent.current) deps.closeFocusIntent.current.guard = { current: () => capturedCurrent };
  };
  return { deps, doc, dialog, origin, keep, outside, events, run, cleanup, ask,
    retain: () => callback(agreement, 'keepEditing', deps)({ currentTarget: keep }),
    stale: () => { current = false; }, staleIntent: () => { capturedCurrent = false; } };
}
test('actual monthly layout focuses Conservar once, then restores Rubro only after the committed re-enable', () => {
  const f = monthlyFocusFixture(); f.run(); assert.deepEqual(f.events, [], 'initial mount must never move focus');
  f.ask(); assert.equal(f.deps.closeFocusIntent.current.origin, f.origin);
  f.origin.disabled = true; f.doc.activeElement = f.doc.body;
  f.run(); assert.equal(f.doc.activeElement, f.keep); assert.deepEqual(f.events[0], ['focus', 'keep', { preventScroll: true }]);
  const count = f.events.length; f.run(); assert.equal(f.events.length, count, 'same confirmation must not refocus');
  f.retain(); assert.equal(f.deps.confirmClose, false); assert.equal(f.deps.closeFocusIntent.current, null);
  assert.equal(f.doc.activeElement, f.keep, 'handler cannot focus a still-disabled origin');
  f.origin.disabled = false; f.doc.activeElement = f.doc.body; f.run();
  assert.equal(f.doc.activeElement, f.origin); assert.equal(f.deps.returnDraftFocus.current, null);
  assert.deepEqual(f.events.at(-2), ['focus', 'rubro', { preventScroll: true }]);
  assert.deepEqual(f.events.at(-1), ['scroll', 'rubro', { block: 'nearest', behavior: 'auto' }]);
  const restoredCount = f.events.length; f.run(); assert.equal(f.events.length, restoredCount);
});
test('actual monthly confirmation layout fails closed for denied, unmounted, stale and unusable contexts', () => {
  for (const mode of ['denied', 'notAllowed', 'unmounted', 'stale', 'staleIntent', 'hiddenDocument', 'blurredWindow', 'disabledButton', 'removedButton', 'hiddenButton', 'otherControl']) {
    const f = monthlyFocusFixture(); f.ask(); f.doc.activeElement = f.doc.body;
    if (mode === 'denied') f.deps.state.status = 'denied';
    if (mode === 'notAllowed') f.deps.allowed = false;
    if (mode === 'unmounted') f.cleanup();
    if (mode === 'stale') f.stale();
    if (mode === 'staleIntent') f.staleIntent();
    if (mode === 'hiddenDocument') f.doc.hidden = true;
    if (mode === 'blurredWindow') f.doc.hasFocus = () => false;
    if (mode === 'disabledButton') f.keep.disabled = true;
    if (mode === 'removedButton') f.keep.isConnected = false;
    if (mode === 'hiddenButton') f.keep.hidden = true;
    if (mode === 'otherControl') f.doc.activeElement = f.outside;
    f.run(); assert.deepEqual(f.events, [], mode);
    if (['denied', 'notAllowed', 'unmounted'].includes(mode)) {
      assert.equal(f.deps.closeFocusIntent.current, null); assert.equal(f.deps.returnDraftFocus.current, null);
    }
  }
});
test('actual monthly return intent is one-shot and cannot focus disabled, foreign, closed or unmounted drafts', () => {
  for (const mode of ['disabled', 'removed', 'hidden', 'foreignDocument', 'closedDialog', 'removedDialog', 'otherControl', 'denied', 'unmounted', 'stale']) {
    const f = monthlyFocusFixture(); f.ask(); f.run(); f.retain(); f.events.length = 0; f.doc.activeElement = f.doc.body;
    if (mode === 'disabled') f.origin.disabled = true;
    if (mode === 'removed') f.origin.isConnected = false;
    if (mode === 'hidden') f.origin.hidden = true;
    if (mode === 'foreignDocument') f.origin.ownerDocument = {};
    if (mode === 'closedDialog') f.dialog.open = false;
    if (mode === 'removedDialog') f.dialog.isConnected = false;
    if (mode === 'otherControl') f.doc.activeElement = f.outside;
    if (mode === 'denied') f.deps.state.status = 'denied';
    if (mode === 'unmounted') f.cleanup();
    if (mode === 'stale') f.stale();
    f.run(); assert.deepEqual(f.events, [], mode); assert.equal(f.deps.returnDraftFocus.current, null);
    f.origin.disabled = false; f.dialog.open = true; f.doc.activeElement = f.doc.body; f.run(); assert.deepEqual(f.events, [], `${mode}: no delayed revival`);
  }
});
test('actual Conservar button binds its ref and guarded callback; blocked clicks cannot change confirmation', () => {
  const buttons = find(agreement, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(agreement) === 'button' && n.children.some(c => ts.isJsxText(c) && c.text.trim() === 'Conservar borrador'));
  assert.equal(buttons.length, 1);
  const attributes = buttons[0].openingElement.attributes.properties;
  assert.equal(attributes.find(p => p.name.text === 'ref').initializer.expression.getText(agreement), 'keepDraftButtonRef');
  assert.equal(attributes.find(p => p.name.text === 'onClick').initializer.expression.getText(agreement), 'keepEditing');
  for (const mode of ['busy', 'publishing', 'closing', 'denied', 'stale']) {
    const f = monthlyFocusFixture(); f.ask();
    if (mode === 'busy') f.deps.operation.snapshot.busy = true;
    if (mode === 'publishing') f.deps.publishing.current = true;
    if (mode === 'closing') f.deps.closing.current = true;
    if (mode === 'denied') f.deps.operation.snapshot.status = 'denied';
    if (mode === 'stale') f.stale();
    f.retain(); assert.equal(f.deps.confirmClose, true, mode); assert.equal(f.deps.returnDraftFocus.current, null);
  }
});
test('actual new-client close refuses pending/stale and preserves dirty or uncertain creation until explicit discard', () => {
  let current = true, accept = false; const events = [];
  const deps = { creating: { current: false }, capture: () => ({ current: () => current }), createRecovery: { current: null }, nuevoCliente: { nombre: 'Draft' }, createBaseline: { current: '{}' }, window: { confirm: text => { events.push(['confirm', text]); return accept; } }, setAltaClienteAbierta: value => events.push(['open', value]), setErrorAltaCliente: value => events.push(['error', value]), closeModal: () => events.push(['close']) };
  const close = callback(page, 'cerrarAltaCliente', deps);
  deps.creating.current = true; close(); deps.creating.current = false; current = false; close(); assert.deepEqual(events, []);
  current = true; close(); assert.equal(events.length, 1); assert.equal(events[0][0], 'confirm');
  events.length = 0; deps.createBaseline.current = JSON.stringify(deps.nuevoCliente); deps.createRecovery.current = { snapshot: { blocked: true } };
  close(); assert.equal(events.length, 1); assert.match(events[0][1], /no está confirmada/);
  events.length = 0; accept = true; close(); assert.deepEqual(events.slice(1), [['open', false], ['error', null], ['close']]);
});
test('nested editors remain sibling overlays with guarded callbacks and original identity props', () => {
  for (const tag of ['EditarCuotaClienteModal', 'StartMonthlyAgreementModal']) {
    const nodes = find(clients, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(clients) === tag);
    assert.equal(nodes.length, 1); const node = nodes[0];
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ts.isJsxElement(ancestor)) assert.notEqual(ancestor.openingElement.tagName.getText(clients), 'Modal', 'nested native dialogs must not be DOM descendants');
    }
    const attrs = Object.fromEntries(node.attributes.properties.map(p => [p.name.text, p.initializer?.getText(clients)]));
    assert.equal(attrs.sesion, '{sesion}'); assert.equal(attrs.onAccessDenied, '{denyDetailAccess}');
    if (tag === 'StartMonthlyAgreementModal') assert.equal(attrs.clientId, '{cliente.id}');
    else { assert.equal(attrs.cliente, '{cliente}'); assert.equal(attrs.periodo, '{periodo}'); }
    assert.match(attrs.onClose, /guard\.(current|assertCurrent)\(/);
    assert.match(attrs.onClose, /nestedEditing\.current\s*=\s*false/);
  }
});
