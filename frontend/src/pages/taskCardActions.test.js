import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { AREAS, STATUSES, canonicalTaskState, isTaskCompleted } from '../features/render-os/constants.js';
import { areaForTask, emojiForTaskCard, formatDate, initials, personForTask, taskResponsibleLabels } from '../features/render-os/utils/task-formatters.js';
import { getProductionPhase } from '../features/render-os/utils/production-visits.js';
import { effectiveTaskFilterState } from '../features/render-os/utils/task-view-state.js';
import { taskOrderArrowAnchor } from '../features/render-os/utils/task-manual-order.js';
import { canUserEditTask, canUserMoveTask, canUserMoveTaskToState } from '../workspace-task-state.js';

// Actual component and callbacks; no fake card or keyboard activation engine.
// SSR proves native markup. Enter/Space dispatch, focus and touch geometry are
// intentionally left to the native component fixture.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = (root, predicate) => { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const declaration = name => { const n = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(n, name); return n; };
const card = nodes(ast, ts.isVariableDeclaration).find(n => n.name.getText(ast) === 'TaskCard').initializer.arguments[0];
const controls = nodes(declaration('TasksView'), ts.isVariableDeclaration).find(n => n.name.getText(ast) === 'orderControls').initializer;
const helperSource = ['Avatar', 'taskResponsibles', 'taskResponsiblesLabel', 'AreaBadge'].map(name => declaration(name).getText(ast)).join('\n');
const compiled = ts.transpileModule(`${helperSource}\nconst ActualCard=(${card.getText(ast)});`, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const descendants = element => !React.isValidElement(element) ? [] : [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
const title = tree => descendants(tree).find(n => n.type === 'button' && n.props.className === 'ros-card-open');
const group = tree => descendants(tree).find(n => n.props.className === 'ros-order-actions');
const task = { id: 5, revision: 3, titulo: 'Editar video <QA> & revisión', estado: 'pendiente', tipo_tarea: 'edicion',
  asignado_a_id: 7, colaborador_ids: [], cliente_nombre: 'Cliente', fecha_vencimiento: '2026-10-20', propiedades_extra: { workspace: 'render_os' } };
const user = { id: 7, rol: 'admin', activo: true, nombre: 'QA' };

function fixture({ blocked = false, readOnly = false, manual = true } = {}) {
  const opens = [], moves = [], orders = [], ref = { current: { blocked: false, suppressClick: false } };
  const actor = readOnly ? { id: 8, rol: 'diseno', activo: true } : user;
  const deps = { React, useRef: () => ref, AREAS, STATUSES, canonicalTaskState, isTaskCompleted,
    areaForTask, emojiForTaskCard, formatDate, initials, personForTask, taskResponsibleLabels, getProductionPhase,
    effectiveTaskFilterState, canUserMoveTaskToState, esperandoMaterial: () => false };
  const ActualCard = new Function(...Object.keys(deps), `${compiled};return ActualCard;`)(...Object.values(deps));
  const rows = [{ ...task, id: 4 }, task, { ...task, id: 6 }, { ...task, id: 7 }];
  const controlDeps = { sort: manual ? 'manual' : 'date', archiveMode: 'active', sesion: { usuario: actor }, manualReady: !blocked,
    canUserEditTask, canonicalTaskState, effectiveTaskFilterState, taskOrderArrowAnchor,
    onReorder: (...args) => orders.push(args) };
  const orderControls = new Function(...Object.keys(controlDeps), `return (${controls.getText(ast)});`)(...Object.values(controlDeps));
  const props = { task, users: [user], user: actor, today: '2026-10-20',
    onOpen: id => opens.push(id), onMove: (...args) => moves.push(args),
    canMove: canUserMoveTask(task, actor), moveBlocked: blocked, manualControls: orderControls(task, rows, 1) };
  const tree = ActualCard(props);
  return { tree, props, opens, moves, orders, ref, html: () => renderToStaticMarkup(tree) };
}
function pointerEvent({ interactive = false } = {}) {
  const values = new Map(), classes = new Set();
  return { prevented: 0, stopped: 0, clientX: 10, clientY: 12,
    target: { closest: () => interactive ? { tagName: 'BUTTON' } : null },
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }), classList: { add: v => classes.add(v), remove: v => classes.delete(v) } },
    preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; },
    dataTransfer: { setData(type, value) { values.set(type, value); }, get types() { return [...values.keys()]; },
      getData: type => values.get(type), setDragImage() {}, effectAllowed: 'none' } };
}

test('real card is a semantic article, not a focusable button containing interactive descendants', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const f = fixture(); assert.equal(f.tree.type, 'article');
  for (const prop of ['role', 'tabIndex', 'onKeyDown', 'onKeyUp']) assert.equal(f.tree.props[prop], undefined, prop);
  const html = f.html(), opening = html.match(/^<article\b[^>]*>/)[0];
  assert.doesNotMatch(opening, /\brole=|\btabindex=/);
  assert.match(html, /<h3><button type="button" class="ros-card-open">Editar video &lt;QA&gt; &amp; revisión<\/button><\/h3>/);
  assert.equal((html.match(/class="ros-card-open"/g) || []).length, 1);
  assert.ok(group(f.tree));
  assert.equal(descendants(f.tree).filter(n => n.props.role === 'button').length, 0);
});

test('native title button opens once; forced parent bubbling cannot produce a second open', () => {
  const f = fixture(), button = title(f.tree); assert.ok(button);
  assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, undefined);
  assert.equal(button.props.children, task.titulo);
  assert.equal(button.props.onKeyDown, undefined, 'Use browser button semantics, not a second Enter/Space activation handler');
  assert.equal(button.props.onKeyUp, undefined);
  button.props.onClick(); f.tree.props.onClick(pointerEvent({ interactive: true }));
  assert.deepEqual(f.opens, [task.id]); assert.deepEqual(f.orders, []); assert.deepEqual(f.moves, []);
});

for (const action of ['up', 'down', 'end']) test(`${action}: native reorder action invokes one unchanged callback and never opens task`, () => {
  const f = fixture(), actions = group(f.tree), buttons = descendants(actions).filter(n => n.type === 'button');
  const index = ['up', 'down', 'end'].indexOf(action), button = buttons[index];
  assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, false);
  assert.equal(button.props.style.minHeight, 44); assert.ok(button.props['aria-label'].includes(task.titulo));
  const event = pointerEvent({ interactive: true }); button.props.onClick(event); actions.props.onClick(event);
  assert.equal(event.stopped, 1); f.tree.props.onClick(event); // Even accidental bubbling must be guarded.
  assert.equal(f.orders.length, 1); assert.equal(f.orders[0][0], task);
  assert.equal(f.orders[0][1]?.id ?? null, action === 'up' ? 4 : action === 'down' ? 7 : null);
  assert.deepEqual(f.opens, []); assert.deepEqual(f.moves, []);
});

test('pointer background still opens, interactive descendants do not, and dragging from title button is blocked', () => {
  const f = fixture();
  f.tree.props.onClick(pointerEvent()); assert.deepEqual(f.opens, [5]);
  f.tree.props.onClick(pointerEvent({ interactive: true })); assert.deepEqual(f.opens, [5]);
  const buttonOrigin = pointerEvent({ interactive: true });
  f.tree.props.onPointerDown(buttonOrigin); f.tree.props.onDragStart(buttonOrigin);
  assert.equal(buttonOrigin.prevented, 1); assert.deepEqual(buttonOrigin.dataTransfer.types, []);
  const background = pointerEvent(); f.tree.props.onPointerDown(background); f.tree.props.onDragStart(background);
  assert.equal(background.prevented, 0); assert.equal(background.dataTransfer.getData('text/task-id'), '5');
  f.tree.props.onClick(pointerEvent()); assert.deepEqual(f.opens, [5], 'Post-drag synthetic click remains suppressed');
  assert.deepEqual(f.orders, []); assert.deepEqual(f.moves, []);
});

test('busy manual observation disables reorder/state controls and transports no drag operation, but still allows opening', () => {
  const f = fixture({ blocked: true });
  const buttons = descendants(group(f.tree)).filter(n => n.type === 'button'); assert.equal(buttons.length, 3);
  for (const button of buttons) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, null); }
  const state = descendants(f.tree).find(n => n.type === 'select'); assert.ok(state); assert.equal(state.props.disabled, true);
  // Do not invoke disabled native controls artificially and claim a browser test.
  const event = pointerEvent(); f.tree.props.onPointerDown(event); f.tree.props.onDragStart(event);
  assert.equal(event.prevented, 1); assert.deepEqual(event.dataTransfer.types, []);
  title(f.tree).props.onClick(); assert.deepEqual(f.opens, [5]); assert.deepEqual(f.orders, []); assert.deepEqual(f.moves, []);
});

test('read-only card remains openable through the same native title without granting reorder/state/drag controls', () => {
  const f = fixture({ readOnly: true }); assert.equal(f.props.canMove, false); assert.equal(f.tree.props.draggable, false);
  assert.equal(group(f.tree), undefined); assert.equal(descendants(f.tree).some(n => n.type === 'select'), false);
  title(f.tree).props.onClick(); assert.deepEqual(f.opens, [5]);
  const event = pointerEvent(); f.tree.props.onDragStart(event); assert.equal(event.prevented, 1);
  assert.deepEqual(event.dataTransfer.types, []); assert.deepEqual(f.orders, []); assert.deepEqual(f.moves, []);
});

test('date ordering has no manual buttons while keeping native task opening', () => {
  const f = fixture({ manual: false }); assert.equal(group(f.tree), undefined);
  title(f.tree).props.onClick(); assert.deepEqual(f.opens, [5]); assert.deepEqual(f.orders, []);
});
