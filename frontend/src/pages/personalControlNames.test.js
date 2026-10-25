import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('./PersonalLists.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PersonalLists.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = []; (function visit(node) { nodes.push(node); ts.forEachChild(node, visit); })(ast);
function evaluate(text, deps) {
  const code = ts.transpileModule(`const extracted=(${text});`, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  return new Function('React', ...Object.keys(deps), `${code};return extracted;`)(React, ...Object.values(deps));
}
const component = (name, deps = {}) => {
  const node = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name); return evaluate(node.getText(ast), deps);
};
const completionLabel = component('completionLabel');
const find = (element, predicate) => {
  const result = []; function walk(value) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!React.isValidElement(value)) return;
    if (predicate(value)) result.push(value);
    walk(value.props.children);
  } walk(element); return result;
};
const deps = { completionLabel, useState: initial => [initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {},
  ItemActions: component('ItemActions'), TableActions: component('TableActions') };

for (const accepted of [false, true]) test(`unsubmitted item clears only after writer admission (${accepted})`, () => {
  const changes = [], consumed = [];
  const tree = component('ItemsBlock', { ...deps, uid: () => 'synthetic-id' })({ type: 'checklist', content: { items: [] },
    draft: ' New item ', onDraftChange() {}, onDraftSubmitted: value => consumed.push(value),
    onChange: value => { changes.push(value); return accepted; } });
  find(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(changes[0].items, [{ id: 'synthetic-id', texto: 'New item', completado: false }]);
  assert.deepEqual(consumed, accepted ? [' New item '] : []);
});

test('checklist names identify each item, empty text and state; callback still addresses the original ID', () => {
  const content = { titulo: 'QA', items: [{ id: 'one', texto: 'Revisar guion', completado: false }, { id: 'two', texto: '', completado: true }] };
  const before = JSON.stringify(content), changes = [];
  const tree = component('ItemsBlock', deps)({ type: 'checklist', content, onChange: value => changes.push(value) });
  const checks = find(tree, node => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(checks.map(node => node.props['aria-label']), ['Completado: elemento 1 · Revisar guion', 'Completado: elemento 2']);
  assert.deepEqual(checks.map(node => node.props.checked), [false, true]);
  const texts = find(tree, node => node.type === 'input' && node.props['aria-label']?.startsWith('Texto del elemento'));
  assert.deepEqual(texts.map(node => node.props['aria-label']), ['Texto del elemento 1', 'Texto del elemento 2']);
  checks[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [{ ...content, items: [{ ...content.items[0], completado: true }, content.items[1]] }]);
  assert.equal(JSON.stringify(content), before);
  assert.match(renderToStaticMarkup(tree), /aria-label="Completado: elemento 1 · Revisar guion"/);
});

test('table completion names identify row and column; empty headers remain understandable and writes retain IDs', () => {
  const content = { titulo: 'QA', columnas: [{ id: 'a', titulo: 'Material' }, { id: 'b', titulo: '' }],
    filas: [{ id: 'r1', celdas: { a: { texto: 'Drive QA', completado: false } } }, { id: 'r2', celdas: { b: { texto: 'Nota', completado: true } } }] };
  const before = JSON.stringify(content), changes = [];
  const tree = component('TableBlock', deps)({ content, onChange: value => changes.push(value) });
  const checks = find(tree, node => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(checks.map(node => node.props['aria-label']), [
    'Completado: fila 1, columna 1 · Material', 'Completado: fila 1, columna 2',
    'Completado: fila 2, columna 1 · Material', 'Completado: fila 2, columna 2',
  ]);
  const fields = find(tree, node => node.type === 'textarea');
  assert.equal(fields[3].props['aria-label'], 'Columna 2, fila 2');
  checks[3].props.onChange({ target: { checked: false } });
  assert.deepEqual(changes[0].filas[1].celdas.b, { texto: 'Nota', completado: false });
  assert.deepEqual(changes[0].filas[0], content.filas[0]);
  assert.equal(JSON.stringify(content), before);
  assert.match(renderToStaticMarkup(tree), /aria-label="Completado: fila 2, columna 2"/);
});

test('accessible completion detail is whitespace-normalized and bounded without changing user content', () => {
  assert.equal(completionLabel('elemento 1', '\n  Revisar\tguion  '), 'Completado: elemento 1 · Revisar guion');
  assert.equal(completionLabel('elemento 1', null), 'Completado: elemento 1');
  const long = 'x'.repeat(200); const label = completionLabel('elemento 1', long);
  assert.equal(label, `Completado: elemento 1 · ${'x'.repeat(119)}…`);
  assert.equal(long.length, 200);
});

test('Drive search has a meaningful name independent of its decorative glyph and keeps query updates', () => {
  const drive = readFileSync(new URL('./Drive.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('Drive.jsx', drive, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let input; (function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'input'
      && node.attributes.properties.some(attr => attr.name?.getText(file) === 'name' && attr.initializer?.text === 'drive-search')) input = node;
    ts.forEachChild(node, visit);
  })(file);
  assert.ok(input); const changes = [];
  const element = evaluate(input.getText(file), { query: 'QA', setQuery: value => changes.push(value) });
  assert.equal(element.props.type, 'search'); assert.equal(element.props['aria-label'], 'Buscar archivos en esta carpeta');
  assert.equal(element.props.autoComplete, 'off'); assert.equal(element.props.value, 'QA');
  element.props.onChange({ target: { value: 'material' } }); assert.deepEqual(changes, ['material']);
  assert.match(drive, /<span aria-hidden="true">⌕<\/span>/);
});
