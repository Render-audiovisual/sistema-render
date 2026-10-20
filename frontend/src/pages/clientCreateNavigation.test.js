import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { installUnsavedNavigation, registerNavigationGuard } from '../shared/navigation/unsaved.js';

const source = readFileSync(new URL('./Clientes.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Clientes.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(name) {
  let result;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result); return result.getText(ast);
}
const blank = () => ({ nombre: '', rubro: '', cuota_reels: '', cuota_carruseles: '', dias_historias: [], dias_reels: [], dias_carruseles: [], disenador_responsable: '', abono_mensual: '', vigente_desde: '2026-10' });
function fixture() {
  const state = { active: true, altaClienteAbierta: false, nuevoCliente: blank(), createBaseline: { current: JSON.stringify(blank()) }, creating: { current: false } };
  const read = () => new Function('capture', 'altaClienteAbierta', 'nuevoCliente', 'createBaseline', 'creating', `return (${find('clientCreateNavigationStatus')})();`)(
    () => ({ current: () => state.active }), state.altaClienteAbierta, state.nuevoCliente, state.createBaseline, state.creating,
  );
  return { state, read };
}
test('client creation protects only an open changed draft and its synchronous pending write', () => {
  const { state, read } = fixture();
  assert.deepEqual(read(), { dirty: false, busy: false });
  state.altaClienteAbierta = true; assert.deepEqual(read(), { dirty: false, busy: false });
  state.nuevoCliente.nombre = 'Synthetic unsaved client'; assert.deepEqual(read(), { dirty: true, busy: false });
  state.creating.current = true; assert.deepEqual(read(), { dirty: true, busy: true });
  state.active = false; assert.deepEqual(read(), { dirty: false, busy: false });
  state.active = true; state.altaClienteAbierta = false; state.creating.current = false;
  assert.deepEqual(read(), { dirty: false, busy: false }, 'hidden leftover values are not an open draft');
});
test('opening captures one baseline and close uses it rather than recalculating a clock-dependent month', () => {
  const state = fixture().state, effects = [];
  const blankNext = { ...blank(), vigente_desde: '2026-11' };
  const run = new Function('capture','modalOpen','emptyClientForm','createBaseline','setNuevoCliente','setPasoAltaCliente','setErrorAltaCliente','setAltaClienteAbierta',`return (${find('abrirAltaCliente')})();`);
  run(() => ({ current: () => true }), { current: false }, () => blankNext, state.createBaseline, value => { state.nuevoCliente = value; }, () => {}, () => {}, value => effects.push(value));
  assert.equal(state.createBaseline.current, JSON.stringify(blankNext)); assert.equal(state.nuevoCliente, blankNext); assert.deepEqual(effects, [true]);
  assert.match(find('cerrarAltaCliente'), /JSON\.stringify\(nuevoCliente\) !== createBaseline\.current/);
  assert.doesNotMatch(find('cerrarAltaCliente'), /emptyClientForm/);
});
test('actual client getter participates in shared cancel, accept, busy, unload and cleanup decisions', () => {
  const f = fixture(), listeners = new Map(); let accept = false, confirmations = 0;
  const win = { location: new URL('https://render.test/clientes?gestion=1'),
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
    confirm() { confirmations++; return accept; } };
  const installed = installUnsavedNavigation(win), unregister = registerNavigationGuard(win, f.read);
  const event = (type = 'render:before-navigation') => {
    const value = { detail: { href: '/inicio' }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.get(type)?.(value); return value;
  };
  f.state.altaClienteAbierta = true; f.state.nuevoCliente.nombre = 'Keep this draft';
  assert.equal(event().defaultPrevented, true); assert.equal(f.state.nuevoCliente.nombre, 'Keep this draft');
  accept = true; assert.equal(event().defaultPrevented, false);
  f.state.creating.current = true; const count = confirmations;
  assert.equal(event().defaultPrevented, true); assert.equal(confirmations, count);
  assert.equal(event('beforeunload').defaultPrevented, true);
  f.state.active = false; assert.equal(event().defaultPrevented, false);
  unregister(); f.state.active = true; assert.equal(event().defaultPrevented, false);
  installed.dispose(); assert.equal(listeners.size, 0);
});
test('creation guard is wired without new draft storage or changed shared primitive', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(source, /useNavigationGuard\(clientCreateNavigationStatus\)/);
  assert.doesNotMatch(find('clientCreateNavigationStatus'), /localStorage|sessionStorage|fetch|request\(/);
});
