import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { publicationCalendarSummary } from '../shared/editorial/publication-calendar-summary.js';

const piece = (id, fecha_programada, extra = {}) => ({ id, fecha_programada, ...extra });
const ids = result => Object.fromEntries(Object.entries(result).map(([key, rows]) => [key, rows.map(row => row.id)]));
const empty = { scheduledMonth: [], today: [], tomorrow: [], nextSevenDays: [] };

test('scheduled month and seven-day agenda are independent, preserving caller cohort order and original rows', () => {
  const rows = [piece(1, '2026-10-20'), piece(2, '2026-10-21'), piece(3, '2026-10-22'), piece(4, '2026-10-27'), piece(5, '2026-10-28'), piece(6, '2026-11-01')];
  for (const row of rows) Object.freeze(row); Object.freeze(rows);
  const before = JSON.stringify(rows);
  const result = publicationCalendarSummary(rows, { month: '2026-11', today: '2026-10-21' });
  assert.deepEqual(ids(result), { scheduledMonth: [6], today: [2], tomorrow: [3], nextSevenDays: [2, 3, 4] });
  assert.equal(result.today[0], rows[1]); assert.equal(result.scheduledMonth[0], rows[5]);
  assert.equal(JSON.stringify(rows), before);
  assert.notEqual(result.today, result.nextSevenDays);
});

for (const [name, today, dates, expectedTomorrow, month] of [
  ['year rollover', '2026-12-31', ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-06', '2027-01-07'], 3, '2027-01'],
  ['leap February', '2028-02-28', ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-05', '2028-03-06'], 3, '2028-03'],
  ['nonleap February', '2027-02-28', ['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-06', '2027-03-07'], 3, '2027-03'],
]) test(`${name}: today through today+6 inclusive, tomorrow by UTC calendar arithmetic`, () => {
  const rows = dates.map((date, index) => piece(index + 1, date));
  const result = publicationCalendarSummary(rows, { month, today });
  assert.deepEqual(result.today, [rows[1]]);
  assert.deepEqual(result.tomorrow.map(row => row.id), [expectedTomorrow]);
  assert.deepEqual(result.nextSevenDays.map(row => row.id), [2, 3, 4]);
  assert.deepEqual(result.scheduledMonth.map(row => row.id), [4, 5, ...(name === 'leap February' ? [] : [3])].sort((a, b) => a - b));
});

test('malformed or impossible scheduled dates and invalid IDs cannot enter any bucket', () => {
  const invalidDates = [undefined, null, 123, '', '0000-01-01', '2026-02-29', '2028-02-30', '2026-04-31', '2026-13-01',
    '2026-00-01', '2026-10-00', '2026-10-32', '2026-10-1', '2026-10-21\n', ' 2026-10-21', '2026-10-21T00:00:00Z'];
  for (const date of invalidDates) assert.deepEqual(publicationCalendarSummary([piece(1, date)], { month: '2026-10', today: '2026-10-21' }), empty);
  for (const id of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.deepEqual(publicationCalendarSummary([piece(id, '2026-10-21')], { month: '2026-10', today: '2026-10-21' }), empty);
  for (const value of [null, undefined, {}, 'not an array']) assert.deepEqual(publicationCalendarSummary(value, { month: '2026-10', today: '2026-10-21' }), empty);
});

test('invalid month fails only monthly bucket; invalid today fails only relative agenda buckets', () => {
  const rows = [piece(1, '2026-10-21')];
  for (const month of [undefined, null, 202610, '', '0000-10', '2026-00', '2026-13', '2026-1', '2026-10-01', '2026-10\n', ' 2026-10'])
    assert.deepEqual(ids(publicationCalendarSummary(rows, { month, today: '2026-10-21' })), { scheduledMonth: [], today: [1], tomorrow: [], nextSevenDays: [1] });
  for (const today of [undefined, null, '', '2026-02-29', '0000-10-21', '2026-10-21\n'])
    assert.deepEqual(ids(publicationCalendarSummary(rows, { month: '2026-10', today })), { scheduledMonth: [1], today: [], tomorrow: [], nextSevenDays: [] });
  assert.deepEqual(publicationCalendarSummary(rows), empty);
});

test('duplicate valid piece IDs count once and retain the first scheduled observation, not a later duplicate state', () => {
  const first = Object.freeze(piece(1, '2026-10-21', { estado: 'pendiente' }));
  const rows = Object.freeze([first, Object.freeze(piece(1, '2026-11-01', { estado: 'publicada' })), Object.freeze(piece(2, '2026-10-22'))]);
  assert.deepEqual(ids(publicationCalendarSummary(rows, { month: '2026-10', today: '2026-10-21' })), {
    scheduledMonth: [1, 2], today: [1], tomorrow: [2], nextSevenDays: [1, 2],
  });
  assert.equal(publicationCalendarSummary(rows, { month: '2026-10', today: '2026-10-21' }).today[0], first);
});

test('every work/publication state remains scheduled agenda; no actual date or evidence is inferred/read', () => {
  const rows = ['pendiente', 'lista', 'bloqueada', 'rechazada', 'publicada', 'finalizada', 'historical_unknown'].map((estado, index) => {
    const row = piece(index + 1, '2026-10-21', { estado });
    for (const field of ['fecha_publicación_real', 'fecha_publicacion_real', 'publicacion_evidencia'])
      Object.defineProperty(row, field, { get() { assert.fail(`Agenda must not inspect ${field}`); } });
    return Object.freeze(row);
  });
  const result = publicationCalendarSummary(Object.freeze(rows), { month: '2026-10', today: '2026-10-21' });
  assert.deepEqual(result.scheduledMonth, rows); assert.deepEqual(result.today, rows); assert.deepEqual(result.nextSevenDays, rows);
  assert.deepEqual(result.tomorrow, []);
  const actualOnly = piece(99, null, { estado: 'publicada', fecha_publicación_real: '2026-10-21T12:00:00Z' });
  assert.deepEqual(publicationCalendarSummary([actualOnly], { month: '2026-10', today: '2026-10-21' }), empty);
});

const source = readFileSync(new URL('./Publicaciones.jsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('Publicaciones.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length, 0);
function find(root, predicate) { const result = []; function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); } visit(root); return result; }
function declaration(name) { const rows = find(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name); assert.equal(rows.length, 1, name); return rows[0].initializer; }
const attribute = (element, name) => element.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);

test('actual memo consumes the visible type-filtered cohort and observes cohort/month/today dependencies', () => {
  const imports = tree.statements.filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '../shared/editorial/publication-calendar-summary.js');
  assert.equal(imports.length, 1);
  assert.ok(imports[0].importClause.namedBindings.elements.some(node => node.name.text === 'publicationCalendarSummary' && !node.propertyName));
  const memo = declaration('estadisticas'); assert.equal(memo.expression.getText(tree), 'useMemo');
  const callback = memo.arguments[0], call = callback.body;
  assert.ok(ts.isCallExpression(call)); assert.equal(call.expression.getText(tree), 'publicationCalendarSummary');
  assert.equal(call.arguments[0].getText(tree), 'piezasFiltradas');
  assert.deepEqual(call.arguments[1].properties.map(node => [node.name.text, node.initializer.getText(tree)]), [['month', 'mesISO'], ['today', 'hoyISO']]);
  assert.deepEqual(memo.arguments[1].elements.map(node => node.getText(tree)), ['piezasFiltradas', 'mesISO', 'hoyISO']);
  const pieces = [piece(1, '2026-10-21', { tipo: 'video' }), piece(2, '2026-10-21', { tipo: 'carrusel' })];
  const filter = declaration('piezasFiltradas').arguments[0];
  const cohort = Function('piezas', 'filtroTipo', `return (${filter.getText(tree)})();`)(pieces, 'carrusel');
  const summary = Function('publicationCalendarSummary', 'piezasFiltradas', 'mesISO', 'hoyISO', `return (${callback.getText(tree)})();`)(publicationCalendarSummary, cohort, '2026-10', '2026-10-21');
  assert.deepEqual(ids(summary), { scheduledMonth: [2], today: [2], tomorrow: [], nextSevenDays: [2] });
});

test('actual summary JSX renders exact scheduled labels/counts and explicit non-publication meaning', () => {
  const nodes = find(tree, node => ts.isJsxElement(node) && attribute(node, 'className')?.initializer?.text === 'publication-check-summary');
  assert.equal(nodes.length, 1);
  const rows = [piece(1, '2026-10-21'), piece(2, '2026-10-22'), piece(3, '2026-10-22'), piece(4, '2026-10-27'), piece(5, '2026-10-01'), piece(6, '2026-10-02')];
  const estadisticas = publicationCalendarSummary(rows, { month: '2026-10', today: '2026-10-21' });
  const js = ts.transpileModule(`const element = (${nodes[0].getText(tree)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const element = Function('React', 'estadisticas', `${js};return element;`)(React, estadisticas);
  const html = renderToStaticMarkup(element);
  assert.deepEqual([...html.matchAll(/<strong>(\d+)<\/strong>/g)].map(match => Number(match[1])), [6, 1, 2, 4]);
  assert.deepEqual([...html.matchAll(/<span>([^<]+)<\/span>/g)].map(match => match[1]), ['Planificadas del mes', 'Agenda de hoy', 'Agenda de mañana', 'Próximos 7 días']);
  assert.equal(element.props['aria-label'], 'Agenda por fecha programada; no acredita publicaciones realizadas');
  const labels = find(tree, ts.isJsxText).map(node => node.text.trim());
  assert.ok(labels.includes('Confirmadas · cohorte programada'));
  assert.ok(labels.includes('Históricas sin confirmación · cohorte programada'));
});
