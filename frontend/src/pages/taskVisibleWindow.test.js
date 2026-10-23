import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskVisibleWindow } from '../features/render-os/utils/task-visible-window.js';
import { taskOrderArrowAnchor } from '../features/render-os/utils/task-manual-order.js';
import { BOARD_COLUMNS } from '../features/render-os/constants.js';
import { effectiveTaskFilterState } from '../features/render-os/utils/task-view-state.js';

const rows = length => Array.from({ length }, (_, index) => Object.freeze({ id: index + 1, revision: 1, estado: 'pendiente' }));

test('board defaults to 250 loaded rows, then 500 and final remainder without hiding any loaded task forever', () => {
  const loaded = Object.freeze(rows(633));
  const first = taskVisibleWindow(loaded);
  assert.deepEqual(Object.keys(first), ['items', 'limit', 'hasMore', 'nextLimit']);
  assert.equal(first.limit, 250); assert.equal(first.hasMore, true); assert.equal(first.nextLimit, 500);
  assert.deepEqual(first.items, loaded.slice(0, 250));
  const second = taskVisibleWindow(loaded, first.nextLimit);
  assert.equal(second.limit, 500); assert.equal(second.hasMore, true); assert.equal(second.nextLimit, 633);
  const last = taskVisibleWindow(loaded, second.nextLimit);
  assert.equal(last.limit, 633); assert.equal(last.hasMore, false); assert.equal(last.nextLimit, 633);
  assert.deepEqual(last.items, loaded);
  assert.equal(new Set(last.items.map(row => row.id)).size, 633);
});

test('list explicitly uses a 500-row initial window and 500-row increments', () => {
  const loaded = rows(1250);
  const first = taskVisibleWindow(loaded, 500, 500);
  assert.equal(first.limit, 500); assert.equal(first.nextLimit, 1000);
  const second = taskVisibleWindow(loaded, first.nextLimit, 500);
  assert.equal(second.limit, 1000); assert.equal(second.nextLimit, 1250);
  const last = taskVisibleWindow(loaded, second.nextLimit, 500);
  assert.equal(last.hasMore, false); assert.deepEqual(last.items, loaded);
});

test('empty, exact boundary, short input and explicit review window return rendered count, not requested count', () => {
  assert.deepEqual(taskVisibleWindow([]), { items: [], limit: 0, hasMore: false, nextLimit: 0 });
  for (const length of [1, 249, 250]) {
    const loaded = rows(length), result = taskVisibleWindow(loaded);
    assert.deepEqual(result.items, loaded); assert.equal(result.limit, length);
    assert.equal(result.hasMore, false); assert.equal(result.nextLimit, length);
  }
  const loaded = rows(733);
  assert.deepEqual(taskVisibleWindow(loaded, Math.max(1, loaded.length), 500).items, loaded,
    'Review caller can explicitly request all loaded rows without changing board defaults');
});

test('invalid limits/steps are safe positive-integer fallbacks, never coercions or accidental unlimited windows', () => {
  const loaded = rows(1001);
  for (const invalid of [null, 0, -1, 1.5, NaN, Infinity, -Infinity, '500', true, [], {}, Number.MAX_SAFE_INTEGER + 1, 1n, Symbol('limit')]) {
    const invalidLimit = taskVisibleWindow(loaded, invalid);
    assert.equal(invalidLimit.limit, 250); assert.equal(invalidLimit.nextLimit, 500);
    const listFallback = taskVisibleWindow(loaded, invalid, 500);
    assert.equal(listFallback.limit, 500); assert.equal(listFallback.nextLimit, 1000);
    const invalidStep = taskVisibleWindow(loaded, 10, invalid);
    assert.equal(invalidStep.limit, 10); assert.equal(invalidStep.nextLimit, 260);
    assert.equal(taskVisibleWindow(loaded, invalid, invalid).limit, 250);
  }
  for (const invalidItems of [null, undefined, {}, 'tasks', 2, new Set(rows(2))]) {
    assert.deepEqual(taskVisibleWindow(invalidItems), { items: [], limit: 0, hasMore: false, nextLimit: 0 });
  }
});

test('safe large limits and steps clamp to loaded count without arithmetic overflow', () => {
  const loaded = rows(251);
  const large = taskVisibleWindow(loaded, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  assert.equal(large.limit, 251); assert.equal(large.nextLimit, 251); assert.equal(large.hasMore, false);
  const hugeStep = taskVisibleWindow(loaded, 1, Number.MAX_SAFE_INTEGER);
  assert.equal(hugeStep.limit, 1); assert.equal(hugeStep.nextLimit, 251); assert.equal(hugeStep.hasMore, true);
  assert.equal(Number.isSafeInteger(hugeStep.nextLimit), true);
});

test('window copies only the array; preserves observed row objects/order and never mutates caller data', () => {
  const loaded = Object.freeze(rows(600)), originalIds = loaded.map(row => row.id);
  const result = taskVisibleWindow(loaded);
  assert.notEqual(result.items, loaded); assert.equal(result.items[0], loaded[0]);
  result.items.pop(); result.items.reverse();
  assert.deepEqual(loaded.map(row => row.id), originalIds);
  assert.equal(taskVisibleWindow(loaded).items.length, 250);
});

test('presentation hasMore false describes only loaded rows and cannot invent an arrow anchor/global end', () => {
  // The server may have more than these 300 rows; helper has no server total.
  const loaded = rows(300), first = taskVisibleWindow(loaded);
  assert.equal(taskOrderArrowAnchor(first.items, 248, 'down'), undefined);
  assert.equal(taskOrderArrowAnchor(first.items, 249, 'down'), undefined);
  const expanded = taskVisibleWindow(loaded, first.nextLimit);
  assert.equal(expanded.hasMore, false); assert.equal(expanded.limit, 300);
  assert.equal(taskOrderArrowAnchor(expanded.items, 249, 'down'), loaded[251]);
  assert.equal(taskOrderArrowAnchor(expanded.items, 299, 'down'), undefined);
  assert.equal(taskOrderArrowAnchor(expanded.items, 299, 'up'), loaded[298]);
  assert.ok(!Object.hasOwn(expanded, 'total') && !Object.hasOwn(expanded, 'before_id'),
    'API continuation and explicit global-end mutation remain separate contracts');
});

test('actual board JSX Show more reaches cards251/501 with expanded manual-control limit and no API request', () => {
  const file = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  const matches = [];
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop =>
      ts.isJsxAttribute(prop) && prop.name.getText(file) === 'className'
      && ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'ros-board ros-board-four')) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(matches.length, 1, 'Extract the actual board div, not a test-rendered imitation');
  const compiled = ts.transpileModule(`const renderBoard = () => (${matches[0].getText(file)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const loaded = Object.freeze(rows(633).map(row => Object.freeze({ ...row, titulo: `Window task ${row.id}` })));
  const other = Object.freeze({ id: 900, revision: 1, estado: 'en_progreso', titulo: 'Other column task' });
  const visible = [...loaded, other], controls = [], requests = [];
  let columnLimits = {}, setterCalls = 0;
  const setColumnLimits = update => { setterCalls++; columnLimits = update(columnLimits); };
  const request = (...args) => { requests.push(args); assert.fail('Presentation expansion cannot request or mutate tasks'); };
  const columns = BOARD_COLUMNS.filter(column => column.states.includes('pendiente') || column.states.includes('en_progreso'));
  assert.equal(columns.length, 2);
  const pendingColumn = columns.find(column => column.states.includes('pendiente'));
  const render = () => {
    controls.length = 0;
    const dependencies = {
      React, boardRef: { current: null }, compactBoard: false, renderedBoardColumns: columns, visible,
      effectiveTaskFilterState, taskVisibleWindow, columnLimits, setColumnLimits, mobileBoardColumn: pendingColumn.id,
      dragOver: '', setDragOver() {}, dropOnProcessButton: request, openTask: request, move: request,
      users: [], sesion: { usuario: { id: 7, rol: 'admin' } }, today: '2026-10-23',
      canUserMoveTask: () => true, sort: 'manual', archiveMode: 'active', dropBeforeTask: request,
      orderState: { busy: false, locked: false }, setCreatingStatus: request,
      orderControls(task, items, index, limit) { controls.push({ task, items, index, limit }); return { observedLimit: limit }; },
      TaskCard: ({ task }) => React.createElement('article', { 'data-window-task': task.id }, task.titulo),
      apiRequest: request, fetch: request,
    };
    const element = new Function(...Object.keys(dependencies), `${compiled}\nreturn renderBoard;`)(...Object.values(dependencies))();
    return { element, html: renderToStaticMarkup(element) };
  };
  const descendants = element => {
    if (!React.isValidElement(element)) return [];
    return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
  };
  const more = element => descendants(element).find(node => node.type === 'button'
    && node.props['aria-label'] === `Mostrar más tareas de ${pendingColumn.label}`);
  const ids = html => [...html.matchAll(/data-window-task="(\d+)"/g)].map(match => Number(match[1]));

  let rendered = render();
  assert.deepEqual(ids(rendered.html), [...loaded.slice(0, 250).map(row => row.id), 900]);
  assert.ok(!rendered.html.includes('>Window task 251<'));
  assert.equal(more(rendered.element).props.disabled, false);
  assert.ok(controls.filter(call => call.task.estado === 'pendiente').every(call => call.limit === 250 && call.items.length === 633));
  more(rendered.element).props.onClick();
  assert.deepEqual(columnLimits, { [pendingColumn.id]: 500 });

  rendered = render();
  assert.deepEqual(ids(rendered.html), [...loaded.slice(0, 500).map(row => row.id), 900]);
  assert.ok(rendered.html.includes('>Window task 251<')); assert.ok(!rendered.html.includes('>Window task 501<'));
  assert.ok(controls.filter(call => call.task.estado === 'pendiente').every(call => call.limit === 500));
  more(rendered.element).props.onClick();

  rendered = render();
  assert.deepEqual(ids(rendered.html), [...loaded.map(row => row.id), 900]);
  assert.ok(rendered.html.includes('>Window task 501<')); assert.equal(more(rendered.element), undefined);
  assert.ok(controls.filter(call => call.task.estado === 'pendiente').every(call => call.limit === 633));
  assert.ok(controls.filter(call => call.task.estado === 'en_progreso').every(call => call.limit === 1));
  assert.equal(setterCalls, 2); assert.deepEqual(requests, []);
  assert.deepEqual(visible.map(row => row.id), [...loaded.map(row => row.id), 900]);
});
