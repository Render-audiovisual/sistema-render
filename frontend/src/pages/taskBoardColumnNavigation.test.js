import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BOARD_COLUMNS } from '../features/render-os/constants.js';
import { writeTaskViewUrl } from '../features/render-os/utils/task-view-state.js';

const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const component = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TasksView');
function nodes(predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(component); return result;
}
function initializer(name) {
  return nodes(n => ts.isVariableDeclaration(n) && n.name.getText(file) === name)[0].initializer;
}
function evaluate(node, dependencies) {
  return new Function(...Object.keys(dependencies), `return (${node.getText(file)});`)(...Object.values(dependencies));
}
const effects = () => nodes(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect');

test('actual mobile initializer consumes observed display column including finalizadas', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const declaration = nodes(n => ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.name.elements[0]?.name?.getText(file) === 'mobileBoardColumn')[0];
  for (const column of BOARD_COLUMNS) assert.equal(evaluate(declaration.initializer, { useState: value => value, initialViewState: { boardColumn: column.id } }), column.id);
  assert.ok(BOARD_COLUMNS.some(c => c.id === 'finalizadas'));
});

test('actual selection allowlist changes only local column and scroll, without history entries or unknown-column scroll', () => {
  const events = []; let pushes = 0, pops = 0;
  const select = evaluate(initializer('selectMobileBoardColumn').arguments[0], {
    BOARD_COLUMNS, setMobileBoardColumn: value => events.push(['column', value]),
    window: { requestAnimationFrame: fn => fn(), history: { pushState: () => pushes++ }, dispatchEvent: () => pops++ },
    mobileBoardNavRef: { current: { scrollIntoView: options => events.push(['scroll', options]) } },
  });
  for (const invalid of ['finalizada', '', null, 123, 'unknown']) select(invalid);
  assert.deepEqual(events, []);
  for (const column of BOARD_COLUMNS) select(column.id);
  assert.deepEqual(events.filter(e => e[0] === 'column').map(e => e[1]), BOARD_COLUMNS.map(c => c.id));
  assert.equal(events.filter(e => e[0] === 'scroll').length, BOARD_COLUMNS.length);
  assert.equal(pushes, 0); assert.equal(pops, 0);
});

test('actual popstate restores task/view/calendar/column and removes its exact listener on cleanup', () => {
  const effect = effects().find(n => n.arguments[0].getText(file).includes('addEventListener("popstate"'));
  const observed = [], listeners = new Map(); let aborted = 0;
  const window = { location: { search: '?task=72&board_column=finalizadas' },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { assert.equal(listeners.get(type), fn); listeners.delete(type); } };
  const cleanup = evaluate(effect.arguments[0], {
    window, URLSearchParams, openRequestRef: { current: { abort: () => aborted++ } },
    getTaskViewState: search => { assert.equal(search, window.location.search); return { view: 'board', calendarMonth: '2026-10', boardColumn: 'finalizadas' }; },
    setReviewRequestedTaskId: v => observed.push(['review', v]),
    setSelectedId: v => observed.push(['task', v]), setView: v => observed.push(['view', v]),
    setCalendarMonth: v => observed.push(['month', v]), setMobileBoardColumn: v => observed.push(['column', v]),
  })();
  listeners.get('popstate')();
  assert.equal(aborted, 1);
  assert.deepEqual(observed, [['review', null], ['task', 72], ['view', 'board'], ['month', '2026-10'], ['column', 'finalizadas']]);
  cleanup(); assert.equal(listeners.size, 0);
});

test('actual URL effect replaces same history state with column, retaining helper-owned query/task/hash context', () => {
  const effect = effects().find(n => n.arguments[0].getText(file).includes('writeTaskViewUrl('));
  const dependencies = effect.arguments[1].elements.map(n => n.getText(file));
  assert.ok(dependencies.includes('mobileBoardColumn'));
  const href = 'https://render.example.test/workspace/tareas?task=72&q=brief&cliente=8#detail';
  const state = { task: 72, opaque: 'preserved' }; let replaced = 0, pushes = 0, pops = 0, notices = 0;
  const inputs = Object.fromEntries(dependencies.map(name => [name, name]));
  inputs.mobileBoardColumn = 'finalizadas';
  inputs.query = 'brief';
  evaluate(effect.arguments[0], { ...inputs,
    window: { location: { href }, CustomEvent: class { constructor(type) { this.type = type; } },
      dispatchEvent: event => { assert.equal(replaced, 1, 'Notice follows actual history write'); if (event.type === 'popstate') pops++; else { assert.equal(event.type, 'render:view-preference-change'); notices++; } },
      history: { state, pushState: () => pushes++, replaceState(nextState, title, url) {
      assert.equal(nextState, state); assert.equal(title, '');
      assert.equal(url.searchParams.get('task'), '72'); assert.equal(url.searchParams.get('q'), 'brief');
      assert.equal(url.hash, '#detail'); assert.equal(url.searchParams.get('board_column'), 'finalizadas'); replaced++;
    } } },
    writeTaskViewUrl,
  })();
  assert.equal(replaced, 1);
  assert.equal(pushes, 0); assert.equal(pops, 0); assert.equal(notices, 1);
});
