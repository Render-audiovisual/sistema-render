import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { registerNavigationGuard, installUnsavedNavigation } from '../shared/navigation/unsaved.js';

const source = readFileSync(new URL('./ClienteModals.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ClienteModals.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
}
const component = name => nodes(ast, ts.isFunctionDeclaration).find(node => node.name?.text === name);
const editor = component('EditarCuotaSession');
function callback(name, context) {
  const node = nodes(editor, ts.isVariableDeclaration).find(node => node.name.getText(ast) === name);
  assert.ok(node, `actual editor callback ${name}`);
  return new Function(...Object.keys(context), `return (${node.initializer.getText(ast)});`)(...Object.values(context));
}
class FakeEvents {
  listeners = new Map();
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, values = {}) {
    const event = { type, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}
const initial = { nombre: 'QA agreement', activo: true, cuotaReels: '3', cuotaCarruseles: '2',
  cuotaFeedReels: '0', cuotaFeedCarruseles: '0', abonoMensual: '120.50', diasReels: [1], diasCarruseles: [3] };
function fixture(t) {
  let current = true, allow = false, confirmations = 0;
  const win = new FakeEvents();
  win.navigation = new FakeEvents(); win.location = { href: 'https://render.test/clientes' };
  win.confirm = () => { confirmations++; return allow; };
  const state = { snapshot: JSON.stringify(initial), baseline: { current: JSON.stringify(initial) },
    pending: { current: false }, capture: () => ({ current: () => current }) };
  // Re-evaluate with the latest render snapshot; execute the actual getter body.
  const getter = () => callback('agreementNavigationStatus', state)();
  const installation = installUnsavedNavigation(win);
  const removeParent = registerNavigationGuard(win, () => ({ dirty: false, busy: false }));
  const removeEditor = registerNavigationGuard(win, getter);
  t.after(() => { removeEditor(); removeParent(); installation.dispose(); });
  return { state, getter, win, obsolete: () => { current = false; }, allow: () => { allow = true; },
    confirmations: () => confirmations, removeEditor,
    navigate: () => win.emit('render:before-navigation', { detail: { href: '/inicio' } }),
    unload: () => win.emit('beforeunload'),
    traverse: () => win.navigation.emit('navigate', { navigationType: 'traverse', destination: { sameDocument: true, url: 'https://render.test/inicio' } }),
  };
}

test('guard is registered only in editable session, not outer wrapper or read-only detail', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const calls = node => nodes(node, ts.isCallExpression).filter(call => call.expression.getText(ast) === 'useNavigationGuard');
  assert.equal(calls(editor).length, 1);
  assert.equal(calls(editor)[0].arguments[0].getText(ast), 'agreementNavigationStatus');
  for (const name of ['EditarCuotaClienteModal', 'DetalleClienteModal', 'DetalleClienteSession']) assert.equal(calls(component(name)).length, 0);
  assert.match(source, /from ['"]\.\.\/shared\/navigation\/useNavigationGuard\.js['"]/);
});

test('all agreement snapshot fields block unload and SPA escape despite clean parent guard', t => {
  const f = fixture(t);
  assert.deepEqual(f.getter(), { dirty: false, busy: false });
  assert.equal(f.navigate().defaultPrevented, false);
  assert.equal(f.unload().defaultPrevented, false);
  for (const field of Object.keys(initial)) {
    const value = initial[field];
    f.state.snapshot = JSON.stringify({ ...initial, [field]: Array.isArray(value) ? [...value, 5] : typeof value === 'boolean' ? !value : value + '1' });
    assert.deepEqual(f.getter(), { dirty: true, busy: false }, field);
    assert.equal(f.navigate().defaultPrevented, true, field);
    assert.equal(f.unload().defaultPrevented, true, field);
    assert.equal(f.traverse().defaultPrevented, true, field);
  }
  f.allow(); assert.equal(f.navigate().defaultPrevented, false);
});

test('pending save/recovery blocks navigation even when baseline matches; never prompts discard while busy', t => {
  const f = fixture(t); f.state.pending.current = true; f.allow();
  assert.deepEqual(f.getter(), { dirty: false, busy: true });
  assert.equal(f.navigate().defaultPrevented, true);
  assert.equal(f.traverse().defaultPrevented, true);
  assert.equal(f.unload().defaultPrevented, true);
  assert.equal(f.confirmations(), 0);
  f.state.pending.current = false;
  assert.equal(f.navigate().defaultPrevented, false);
});

test('obsolete identity never blocks replacement identity, even with dirty draft and pending operation', t => {
  const f = fixture(t); f.state.snapshot = 'unsaved'; f.state.pending.current = true; f.obsolete();
  assert.deepEqual(f.getter(), { dirty: false, busy: false });
  assert.equal(f.navigate().defaultPrevented, false);
  assert.equal(f.traverse().defaultPrevented, false);
  assert.equal(f.unload().defaultPrevented, false);
  assert.equal(f.confirmations(), 0);
});

test('actual verified recovery replaces baseline and matching recovered render is clean', async t => {
  const f = fixture(t); f.state.snapshot = JSON.stringify({ ...initial, nombre: 'Unsaved draft' });
  assert.equal(f.getter().dirty, true);
  const row = { id: 12, agreement_revision: 'a1:12:2:0:0', nombre: 'Recovered agreement', activo: true,
    cuota_reels: 4, cuota_carruseles: 2, cuota_feed_reels: 0, cuota_feed_carruseles: 0,
    abono_mensual: 150.75, dias_reels: [2], dias_carruseles: [4] };
  const values = { ...initial }; let requests = 0;
  const context = { ...f.state, cliente: { id: 12 }, periodo: '2026-10', revision: { current: 'a1:12:1:0:0' }, blocked: { current: true },
    capture: () => ({ current: () => true, assertCurrent() {}, async request(url) {
      requests++; assert.equal(url, '/api/clientes?periodo=2026-10'); return [row];
    } }),
    validPeriod: value => /^\d{4}-\d{2}$/.test(value), object: value => value !== null && typeof value === 'object',
    sameClient: (a, b) => String(a) === String(b), agreementParts: () => [12, 2, 0, 0],
    setCliente() {}, setGuardando() {}, setNeedsReload() {}, setError() {},
  };
  for (const field of Object.keys(values)) context[`set${field[0].toUpperCase()}${field.slice(1)}`] = value => { values[field] = value; };
  await callback('reloadAgreement', context)();
  assert.equal(requests, 1); assert.equal(context.blocked.current, false);
  assert.equal(context.revision.current, row.agreement_revision);
  f.state.snapshot = JSON.stringify(values);
  assert.equal(f.state.baseline.current, f.state.snapshot);
  assert.deepEqual(f.getter(), { dirty: false, busy: false });
  assert.equal(f.navigate().defaultPrevented, false);
  assert.equal(f.unload().defaultPrevented, false);
});

test('failed/uncertain save remains dirty; confirmed matching baseline and unregistration release editor guard', t => {
  const f = fixture(t); f.state.snapshot = JSON.stringify({ ...initial, abonoMensual: '999.25' });
  assert.equal(f.navigate().defaultPrevented, true);
  // Same baseline transition used only after acknowledged writes in guardar.
  f.state.baseline.current = f.state.snapshot;
  assert.equal(f.navigate().defaultPrevented, false);
  f.state.snapshot = 'another draft'; f.removeEditor();
  assert.equal(f.navigate().defaultPrevented, false, 'clean parent remains registered');
  assert.equal(f.unload().defaultPrevented, false);
});
