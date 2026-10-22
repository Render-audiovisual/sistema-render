import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as context from './productionRouteContext.js';
import { verifiedProductionDraftVisit } from './productionDraft.js';

// Execute canonical callbacks/URL writer extracted through AST. No mounted
// React, browser navigation, native dialogs, HTTP or persistence claims.
const source = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('Productions.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length, 0);
function find(root, predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(root); return result;
}
function expression(name) {
  const nodes = find(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(nodes.length, 1, `Actual ${name} callback exists exactly once`);
  return nodes[0].initializer.getText(tree);
}
const evaluate = (code, bindings) => Function(...Object.keys(bindings), `return (${code});`)(...Object.values(bindings));
function validator() {
  if (typeof context.validProductionDay === 'function') return context.validProductionDay;
  const local = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'validProductionDay');
  if (local) return evaluate(local.getText(tree), {});
  return evaluate(expression('validProductionDay'), {});
}
function harness({ busy = false, batchBusy = false, allow = true } = {}) {
  const effects = [], openVersion = { current: 9 }, dirty = { current: new Set(['visit:original', 'videos:new']) };
  const state = { day: '2026-10-20', selected: { id: 'original' }, creating: true, detailLoading: true };
  let permissionCalls = 0, prompts = 0;
  const actualMayLeave = evaluate(expression('mayLeave'), {
    dirty, writeLock: { current: busy }, batchDraft: { current: { busy: batchBusy } },
    window: { confirm() { prompts++; return allow; } },
  });
  const deps = { month: '2026-10', day: state.day, clientId: '37', tab: 'pending', openVersion,
    validProductionDay: validator(),
    mayLeave() { permissionCalls++; return actualMayLeave(); },
    writeProductionLocation(value) { effects.push(['url', value]); },
  };
  for (const [name, key] of [['setDay', 'day'], ['setSelected', 'selected'], ['setCreating', 'creating'], ['setDetailLoading', 'detailLoading']]) {
    deps[name] = value => { effects.push([key, value, openVersion.current]); state[key] = value; };
  }
  return { deps, state, effects, dirty, openVersion, permissionCalls: () => permissionCalls, prompts: () => prompts };
}

test('invalid, out-of-month and same day return before discard or any effects', () => {
  for (const value of [undefined, null, 20, {}, '', '2026-10-00', '2026-10-32', '2026-02-30', '2026-11-01',
    '2026-09-30', '0000-10-21', '2026-10-2', '2026-10-21\n', ' 2026-10-21', '2026-10-21T00:00:00Z', '2026-10-20']) {
    const h = harness(); const before = structuredClone(h.state);
    evaluate(expression('selectDay'), h.deps)(value);
    assert.equal(h.permissionCalls(), 0, JSON.stringify(value));
    assert.equal(h.prompts(), 0); assert.equal(h.openVersion.current, 9);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.state, before);
    assert.equal(h.dirty.current.size, 2);
  }
});

for (const [name, flags] of [['cancel', { allow: false }], ['write busy', { busy: true }], ['history batch busy', { batchBusy: true }]]) {
  test(`day selection denied by actual mayLeave (${name}) retains draft registration and detail`, () => {
    const h = harness(flags), before = structuredClone(h.state);
    evaluate(expression('selectDay'), h.deps)('2026-10-21');
    assert.equal(h.permissionCalls(), 1);
    assert.equal(h.prompts(), name === 'cancel' ? 1 : 0);
    assert.equal(h.openVersion.current, 9); assert.deepEqual(h.effects, []);
    assert.deepEqual(h.state, before); assert.deepEqual([...h.dirty.current], ['visit:original', 'videos:new']);
  });
}

test('accepted day selection fences old opens, closes detail/create and replaces the same context once', () => {
  const h = harness();
  evaluate(expression('selectDay'), h.deps)('2026-10-21');
  assert.equal(h.permissionCalls(), 1); assert.equal(h.prompts(), 1);
  assert.equal(h.openVersion.current, 10); assert.equal(h.dirty.current.size, 0);
  assert.deepEqual(h.effects, [
    ['day', '2026-10-21', 10], ['selected', null, 10], ['creating', false, 10], ['detailLoading', false, 10],
    ['url', { month: '2026-10', day: '2026-10-21', clientId: '37', tab: 'pending', replace: true }],
  ]);
});

function writer() {
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'writeProductionLocation');
  assert.ok(declaration);
  return declaration.getText(tree);
}
function fakeWindow(href) {
  const effects = [], historyState = { task: 71, fromTasks: '/workspace/tareas?task=71', sentinel: { retain: true } };
  const win = { location: new URL(href), history: { state: historyState } };
  for (const method of ['pushState', 'replaceState']) win.history[method] = (state, title, url) => {
    effects.push({ method, state, title, url: String(url) }); win.location = new URL(url);
  };
  return { win, effects, historyState };
}
test('actual URL writer persists day using replace while preserving opaque history state, unrelated query and hash', () => {
  const h = fakeWindow('https://render.test/producciones?mes=2026-10&dia=2026-10-01&dia=2026-10-02&dia[]=bad&dia[x]=bad&cliente[]=bad&visita=old&task=71&extra=keep#detail');
  const write = evaluate(writer(), { window: h.win });
  write({ month: '2026-10', day: '2026-10-21', clientId: '37', tab: 'pending', replace: true });
  assert.equal(h.effects.length, 1); assert.equal(h.effects[0].method, 'replaceState');
  assert.equal(h.effects[0].state, h.historyState);
  assert.deepEqual(h.win.location.searchParams.getAll('dia'), ['2026-10-21']);
  assert.equal(h.win.location.searchParams.get('mes'), '2026-10');
  assert.equal(h.win.location.searchParams.get('cliente'), '37'); assert.equal(h.win.location.searchParams.get('tab'), 'pending');
  assert.equal(h.win.location.searchParams.get('task'), '71'); assert.equal(h.win.location.searchParams.get('extra'), 'keep');
  assert.equal(h.win.location.hash, '#detail'); assert.equal(h.win.location.searchParams.has('visita'), false);
  assert.ok(![...h.win.location.searchParams.keys()].some(key => /^(?:dia|cliente)\[/.test(key)));
  write({ month: '2026-10', day: '2026-10-21', clientId: '37', tab: 'pending', replace: true });
  assert.equal(h.effects.length, 1, 'Exact URL no-op adds no history entry');
});

test('writer without explicit day removes old dia and bracket forms rather than carrying it into a changed month', () => {
  const h = fakeWindow('https://render.test/producciones?mes=2026-10&dia=2026-10-31&dia=2026-10-30&dia[]=x&dia[a]=x&task=71#keep');
  evaluate(writer(), { window: h.win })({ month: '2026-11', clientId: '', tab: 'calendar' });
  assert.equal(h.effects.length, 1); assert.equal(h.effects[0].method, 'pushState');
  assert.equal(h.effects[0].state, h.historyState); assert.equal(h.win.location.searchParams.get('mes'), '2026-11');
  assert.ok(![...h.win.location.searchParams.keys()].some(key => key === 'dia' || key.startsWith('dia[')));
  assert.equal(h.win.location.searchParams.get('task'), '71'); assert.equal(h.win.location.hash, '#keep');
});

for (const outcome of ['success', 'failure']) {
  test(`day selection fences a previously pending actual openVisit ${outcome}, including finally`, async () => {
    const h = harness(); h.dirty.current.clear();
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const deps = { ...h.deps, apiRequest: () => pending, verifiedProductionDraftVisit,
      assertProductionClient: context.assertProductionClient, productionLocation: context.productionLocation,
      setError: value => h.effects.push(['error', value]), setMonth: value => h.effects.push(['month', value]),
    };
    const opening = evaluate(expression('openVisit'), deps)('11111111-1111-4111-8111-111111111111');
    assert.equal(h.openVersion.current, 10);
    evaluate(expression('selectDay'), deps)('2026-10-21');
    assert.equal(h.openVersion.current, 11);
    const afterSelection = structuredClone(h.effects), state = structuredClone(h.state);
    if (outcome === 'failure') reject(new Error('Old detail failed'));
    else resolve({ id: '11111111-1111-4111-8111-111111111111', revision: 2, cliente_id: 37, cliente_nombre: 'QA',
      fecha: '2026-10-19', titulo: 'Old result', drive_url: '', observaciones: '', participante_ids: [], videos: [], fotos: [] });
    await opening;
    assert.deepEqual(h.effects, afterSelection, 'No old selection, URL, error or finally writes');
    assert.deepEqual(h.state, state); assert.equal(h.state.day, '2026-10-21'); assert.equal(h.state.selected, null);
  });
}

test('desktop calendar and mobile day input both execute selectDay, never direct setDay', () => {
  const attr = (node, name) => node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === name);
  const elements = find(tree, node => ts.isJsxElement(node));
  const grid = elements.find(node => node.openingElement.tagName.getText(tree) === 'div' && attr(node.openingElement, 'className')?.initializer?.text === 'prod-days');
  assert.ok(grid);
  const desktop = find(grid, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button');
  assert.equal(desktop.length, 1);
  const mobile = find(tree, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'input'
    && attr(node, 'type')?.initializer?.text === 'date' && attr(node, 'value')?.initializer?.expression?.getText(tree) === 'day');
  assert.equal(mobile.length, 1);
  const calls = [];
  const bindings = { date: '2026-10-21', selectDay: value => calls.push(value), setDay: () => assert.fail('Controls must pass through the discard/version guard') };
  evaluate(attr(desktop[0].openingElement, 'onClick').initializer.expression.getText(tree), bindings)();
  evaluate(attr(mobile[0], 'onChange').initializer.expression.getText(tree), bindings)({ target: { value: '2026-10-22' } });
  assert.deepEqual(calls, ['2026-10-21', '2026-10-22']);
});
