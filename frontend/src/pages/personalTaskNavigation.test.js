import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { personalTaskHref, personalProductionTaskHref, personalHomeNavigate } from './personalHome.js';
import { getTaskViewState } from '../features/render-os/utils/task-view-state.js';
import { buildTaskPageUrl } from '../features/render-os/services/render-os-api.js';

const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('./QuickHome.jsx');
function find(root, predicate) { let found; function visit(n) { if (predicate(n)) found = n; ts.forEachChild(n, visit); } visit(root); assert.ok(found); return found; }
function evaluate(node, dependencies) {
  const js = ts.transpileModule(`const extracted=(${node.getText(file)});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), `${js};return extracted;`)(...Object.values(dependencies));
}

test('personal task link is exact numeric int32 identity, never a display name or implicit all-tasks fallback', () => {
  for (const id of [1, 7, 2147483647]) {
    assert.equal(personalTaskHref(id), `/workspace/tareas?view=list&responsible=id%3A${id}`);
    assert.equal(personalProductionTaskHref(id), `${personalTaskHref(id)}&sector=produccion`);
  }
  for (const id of [0, -1, 2147483648, 1.5, NaN, Infinity, '7', 'Luciano', '', null, undefined, { id: 7 }]) {
    assert.equal(personalTaskHref(id), null); assert.equal(personalProductionTaskHref(id), null);
  }
});

test('real view parser and API builder retain assigned-ID scope, normal workspace and unrestricted personal sectors', () => {
  const selection = getTaskViewState(new URL(personalTaskHref(7), 'https://render.example.test').search);
  assert.equal(selection.view, 'list'); assert.equal(selection.responsible, 'id:7');
  const api = new URL(buildTaskPageUrl(selection), 'https://render.example.test');
  assert.equal(api.pathname, '/api/tareas'); assert.equal(api.searchParams.get('workspace'), 'render_os');
  assert.equal(api.searchParams.get('asignado_a_id'), '7'); assert.equal(api.searchParams.get('limit'), '50');
  assert.equal(api.searchParams.get('offset'), '0'); assert.equal(api.searchParams.has('tipo_tarea'), false);
  assert.equal(api.searchParams.has('asignado_a'), false); assert.equal(api.searchParams.has('nombre'), false);
  const production = getTaskViewState(new URL(personalProductionTaskHref(7), api.origin).search);
  assert.equal(new URL(buildTaskPageUrl(production), api.origin).searchParams.get('tipo_tarea'), 'produccion');
});

test('actual work-section JSX links verified session-view ID and preserves onNavigate identity', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const link = find(file, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(file) === 'HomeLink' && n.children.some(c => ts.isJsxText(c) && c.text.includes('Ver todas mis tareas')));
  assert.ok(ts.isBinaryExpression(link.parent));
  assert.equal(link.parent.operatorToken.kind, ts.SyntaxKind.AmpersandAmpersandToken);
  const condition = link.parent.left;
  assert.equal(condition.getText(file), 'personalTaskHref(userId)');
  const onNavigate = () => {};
  const element = evaluate(link, { React: { createElement: (type, props, ...children) => ({ type, props, children }) }, HomeLink: 'HomeLink', personalTaskHref, userId: 7, onNavigate });
  assert.equal(element.props.href, personalTaskHref(7)); assert.equal(element.props.onNavigate, onNavigate);
  const identity = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'identity');
  assert.equal(identity.initializer.getText(file), 'useSessionView(sesion)');
  const id = find(file, n => ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.name.elements.some(e => e.name.getText(file) === 'userId'));
  assert.equal(id.initializer.getText(file), 'identity');
  assert.ok(id.name.elements.some(e => e.propertyName?.getText(file) === 'id' && e.name.getText(file) === 'userId'));
  let section = link.parent;
  while (section && !(ts.isJsxElement(section) && section.openingElement.tagName.getText(file) === 'section')) section = section.parent;
  assert.match(section.openingElement.getText(file), /aria-labelledby="qh-work-title"/);
});

test('actual HomeLink delegates plain click once and retains browser modifier/middle-click semantics', () => {
  const fn = find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeLink');
  const js = ts.transpileModule(fn.getText(file), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const HomeLink = new Function('React', 'personalHomeNavigate', `${js};return HomeLink;`)({ createElement: (type, props) => ({ type, props }) }, personalHomeNavigate);
  for (const variant of ['plain', 'ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'middle', 'prevented', 'no-handler']) {
    let prevented = 0, navigated = 0;
    const href = personalTaskHref(7), element = HomeLink({ href, onNavigate: variant === 'no-handler' ? undefined : value => { assert.equal(value, href); navigated++; }, children: 'Ver todas mis tareas' });
    const event = { button: variant === 'middle' ? 1 : 0, defaultPrevented: variant === 'prevented', preventDefault: () => prevented++, [variant]: true };
    element.props.onClick(event);
    assert.equal(element.type, 'a'); assert.equal(element.props.href, href);
    assert.equal(prevented, variant === 'plain' ? 1 : 0, variant); assert.equal(navigated, variant === 'plain' ? 1 : 0, variant);
  }
});

test('generic task shortcut and bounded Home summary enumeration are unchanged by full-list navigation', () => {
  const areas = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'WORK_AREAS');
  assert.deepEqual(evaluate(areas.initializer, {}).find(area => area.title === 'Tareas'), { href: '/workspace/tareas', title: 'Tareas' });
  const taskRows = find(file, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === 'TaskRows' && n.attributes.getText(file).includes('data.tasks'));
  assert.equal(taskRows.attributes.properties.find(p => p.name?.getText(file) === 'items').initializer.expression.getText(file), 'data.tasks');
  const model = parse('./personalHome.js');
  const rows = find(model, n => ts.isVariableDeclaration(n) && n.name.getText(model) === 'tasks').initializer;
  assert.equal(rows.expression.getText(model), 'rows'); assert.equal(rows.arguments[0].getText(model), 'value.tasks');
  assert.equal(rows.arguments[1].getText(model), '12');
});
