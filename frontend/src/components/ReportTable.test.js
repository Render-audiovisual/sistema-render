import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(new URL('./ReportTable.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ReportTable.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const declarations = file.statements.filter(node => ts.isFunctionDeclaration(node));
const compiled = ts.transpileModule(declarations.map(node => node.getText(file).replace(/^export /, '')).join('\n'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ReportTable, ReportCell } = new Function('React', `${compiled};return {ReportTable,ReportCell};`)(React);
const element = React.createElement;

test('actual element tree has exact native table roles, caption and ordered unchanged string headers', () => {
  const columns = Object.freeze(['Cliente', '0', 'Cliente', 'No disponible']);
  const child = element('tr', { role: 'row' }, element(ReportCell, { label: 'Cliente' }, 'Cuenta'));
  const wrap = ReportTable({ caption: 'Informe observado', columns, children: child });
  assert.equal(wrap.type, 'div'); assert.equal(wrap.props.className, 'rpr-table-wrap rpr-responsive-wrap');
  const table = wrap.props.children;
  assert.equal(table.type, 'table'); assert.equal(table.props.className, 'rpr-responsive-table'); assert.equal(table.props.role, 'table');
  const [caption, head, body] = table.props.children;
  assert.equal(caption.type, 'caption'); assert.equal(caption.props.className, 'rpr-sr-only'); assert.equal(caption.props.children, 'Informe observado');
  assert.equal(head.type, 'thead'); assert.equal(head.props.role, 'rowgroup');
  assert.equal(head.props.children.type, 'tr'); assert.equal(head.props.children.props.role, 'row');
  const headers = head.props.children.props.children;
  assert.deepEqual(headers.map(header => header.props.children), [...columns]);
  for (const header of headers) { assert.equal(header.type, 'th'); assert.equal(header.props.scope, 'col'); assert.equal(header.props.role, 'columnheader'); }
  assert.equal(body.type, 'tbody'); assert.equal(body.props.role, 'rowgroup'); assert.equal(body.props.children, child);
});

test('ReportCell preserves value identity, hidden mobile label and optional wide class without added semantics', () => {
  const values = ['', 0, null, undefined, 'No disponible', element('strong', null, 'Valor')];
  for (const children of values) for (const wide of [false, true]) {
    const cell = ReportCell({ label: 'Valor observado', children, wide });
    assert.equal(cell.type, 'td'); assert.equal(cell.props.role, 'cell');
    assert.equal(cell.props.className, wide ? 'rpr-cell-wide' : undefined);
    const [label, value] = cell.props.children;
    assert.equal(label.type, 'span'); assert.equal(label.props.className, 'rpr-cell-label'); assert.equal(label.props['aria-hidden'], 'true');
    assert.equal(label.props.children, 'Valor observado');
    assert.equal(value.type, 'span'); assert.equal(value.props.className, 'rpr-cell-value'); assert.equal(value.props.children, children);
  }
  assert.equal(ReportCell({ label: 'Default', children: 0 }).props.className, undefined);
});

test('real React SSR escapes captions, exact headers, cell labels and values instead of injecting markup', () => {
  const text = '<script>"&</script>';
  const html = renderToStaticMarkup(element(ReportTable, { caption: text, columns: [text] },
    element('tr', { role: 'row' }, element(ReportCell, { label: text }, text))));
  const escaped = '&lt;script&gt;&quot;&amp;&lt;/script&gt;';
  assert.ok(html.includes(`<caption class="rpr-sr-only">${escaped}</caption>`));
  assert.ok(html.includes(`<th scope="col" role="columnheader">${escaped}</th>`));
  assert.ok(html.includes(`<span class="rpr-cell-label" aria-hidden="true">${escaped}</span>`));
  assert.ok(html.includes(`<span class="rpr-cell-value">${escaped}</span>`));
  assert.doesNotMatch(html, /<script>|dangerouslySetInnerHTML/);
  assert.equal((html.match(/<table\b/g) || []).length, 1);
  assert.equal((html.match(/<tbody role="rowgroup">/g) || []).length, 1);
});

test('children actions/details remain a single original instance with unchanged handlers', () => {
  let clicked = 0, toggled = 0;
  const onClick = event => { clicked++; assert.equal(event.type, 'click'); };
  const onToggle = event => { toggled++; assert.equal(event.type, 'toggle'); };
  const button = element('button', { type: 'button', onClick }, 'Abrir tarea');
  const details = element('details', { onToggle }, element('summary', null, 'Historial'), button);
  const cell = ReportCell({ label: 'Acciones', wide: true, children: details });
  assert.equal(cell.props.children[1].props.children, details);
  assert.equal(details.props.onToggle, onToggle);
  assert.equal(details.props.children[1], button); assert.equal(button.props.onClick, onClick);
  button.props.onClick({ type: 'click' }); details.props.onToggle({ type: 'toggle' });
  assert.equal(clicked, 1); assert.equal(toggled, 1);
  const row = element('tr', { role: 'row' }, cell);
  const table = ReportTable({ caption: 'Acciones', columns: ['Acciones'], children: row });
  assert.equal(table.props.children.props.children[2].props.children, row);
  const html = renderToStaticMarkup(table);
  assert.equal((html.match(/<button\b/g) || []).length, 1);
  assert.equal((html.match(/<details\b/g) || []).length, 1);
  assert.equal((html.match(/<summary\b/g) || []).length, 1);
  assert.match(html, /class="rpr-cell-wide"/);
});

test('SSR retains zero, explicit unavailable and blank values; empty body does not fabricate rows', () => {
  const row = element('tr', { role: 'row' }, ...[0, 'No disponible', '', null].map((value, index) =>
    element(ReportCell, { key: index, label: `Campo ${index}` }, value)));
  const html = renderToStaticMarkup(element(ReportTable, { caption: 'Observación', columns: ['Cero', 'Ausente', 'Vacío', 'Nulo'] }, row));
  assert.match(html, /class="rpr-cell-value">0<\/span>/);
  assert.match(html, /class="rpr-cell-value">No disponible<\/span>/);
  assert.equal((html.match(/class="rpr-cell-value"><\/span>/g) || []).length, 2);
  const empty = renderToStaticMarkup(element(ReportTable, { caption: 'Sin filas', columns: [] }));
  assert.match(empty, /<tbody role="rowgroup"><\/tbody>/);
  assert.equal((empty.match(/<tr\b/g) || []).length, 1, 'Only the header row, no fabricated empty business row');
  assert.doesNotMatch(empty, /<td\b|No disponible/);
});

test('JSX parses and presentation contains no state, network, row cloning or duplicate mobile data tree', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.deepEqual(declarations.map(node => node.name.text), ['ReportTable', 'ReportCell']);
  const imports = file.statements.filter(ts.isImportDeclaration);
  assert.deepEqual(imports.map(node => node.moduleSpecifier.text), ['react']);
  const tags = [], calls = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) tags.push(node.tagName.getText(file));
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(tags.filter(tag => tag === 'table').length, 1);
  assert.equal(tags.filter(tag => tag === 'tbody').length, 1);
  assert.equal(tags.filter(tag => tag === 'td').length, 1);
  assert.deepEqual(calls, ['columns.map']);
  const tbody = [];
  function findBody(node) { if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'tbody') tbody.push(node); ts.forEachChild(node, findBody); }
  findBody(file);
  assert.equal(tbody.length, 1); assert.equal(tbody[0].children.length, 1);
  assert.ok(ts.isJsxExpression(tbody[0].children[0])); assert.equal(tbody[0].children[0].expression.getText(file), 'children');
});
