import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

// Actual JSX declarations, real React SSR, injected observations/calculators.
// No effects, browser layout, HTTP or screen-reader behavior are simulated.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('./Reportes.jsx');
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('Reportes.jsx', source);
assert.equal(file.parseDiagnostics.length, 0);
const constants = ['PERIODS', 'initialPeriod', 'VIDEO_STATES', 'PHOTO_STATES', 'FORMAT_LABELS', 'TASK_LABELS', 'EDITORIAL_COLUMNS', 'QUOTA_COLUMNS', 'PERSON_COLUMNS'];
const functions = ['Metric', 'EditorialTable', 'PersonDetails', 'ReportesContent'];
const selected = file.statements.filter(node => ts.isFunctionDeclaration(node) ? functions.includes(node.name?.text)
  : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => constants.includes(d.name.getText(file))));
assert.equal(selected.length, constants.length + functions.length);
const sharedFile = parse('ReportTable.jsx', read('../components/ReportTable.jsx'));
const shared = sharedFile.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(sharedFile).replace(/^export /, '')).join('\n');
const compiled = ts.transpileModule(shared + '\n' + selected.map(n => n.getText(file)).join('\n'), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const editorialLabels = ['Formato', 'Programadas por fecha', 'Confirmadas manualmente en el período', 'Históricas con fecha, sin confirmar', 'Sin fecha real válida (históricas)', 'Históricas sin fecha de período', 'Estados de registros fechados en el rango'];
const quotaLabels = ['Cliente / feed', 'Cuota mensual de carruseles', 'Cuota mensual de reels', 'Carruseles confirmados en el período real', 'Reels confirmados en el período real'];
const personLabels = ['Persona', 'Tareas', 'Para revisar', 'Aprobadas', 'Finalizadas', 'No finalizadas', 'Vencidas'];
const range = { desde: '2026-10-01', hasta: '2026-11-01' };
const summary = [{ formato: 'reels', programadas: 0, publicadas: 2, historicalFechadas: 3, legacy: 4, legacySinFecha: 5, estados: [{ estado: 'lista', total: 6 }] }];
function harness(personId = null) {
  const updates = [], data = { usuarios: [], historias: [], publicaciones: [] };
  const states = ['mes_actual', { context: JSON.stringify(['mes_actual', '2026-10-24', range.desde, range.hasta]), data }, false, '', '2026-10-24', personId];
  let index = 0;
  const bindings = {
    React, useState: () => { const i = index++; return [states[i], value => updates.push([i, value])]; },
    useEffect() {}, getHoyLocalISO: () => '2026-10-24', getReportPeriodRange: () => range,
    ROL_LABELS: { edicion: 'Edición' }, uniqueReportTasks: () => [],
    buildEmployeeReport: () => ({ uniqueTasks: 8, unattributed: 0, rows: [{ id: 17, nombre: 'Alex <observado>', rol: 'edicion', total: 8, enRevision: 1, aprobadas: 2, finalizadas: 3, pendientes: 5, vencidas: 0 }] }),
    buildProductionRegistryReport: () => ({ available: true, visits: 0, videos: 0, recorded: 0, photos: 0, realizedPhotos: 0, clients: [], normalizedSourceIds: new Set() }),
    buildHistoricalProductionReport: () => [], historicalUnassignedEditingCount: () => 0,
    editorialRecords: () => [], summarizeEditorialRecords: () => summary,
    clientQuotaReport: () => [{ key: 'feed:9', shared: true, accounts: [{ id: 7, nombre: 'Cuenta extensa' }], conflict: true, carruseles: 0, reels: null, metrics: [{ formato: 'carruseles', publicadas: 0 }, { formato: 'reels', publicadas: 2 }] }],
    employeeTaskDetails: () => [{ id: 41, titulo: 'Tarea real', formato: 'reels', estado: 'finalizada', href: '/workspace/tareas?task=41', fecha_entrega: '2026-10-23', finalizada: '2026-10-24', actualizada: '2026-10-24' }],
    employeeFormatBreakdown: () => [], personalEditorialReport: () => ({ available: false, missing: 0 }),
  };
  const api = Function(...Object.keys(bindings), `${compiled}; return {ReportesContent,EditorialTable};`)(...Object.values(bindings));
  return { ...api, updates, page: () => api.ReportesContent({ session: {} }) };
}
function expand(node) {
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!React.isValidElement(node)) return node == null || typeof node === 'boolean' ? [] : [node];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (node.type === React.Fragment) return expand(node.props.children);
  return [{ type: node.type, props: node.props, children: expand(node.props.children) }];
}
function find(nodes, predicate) { return nodes.flatMap(n => typeof n === 'object' ? [...(predicate(n) ? [n] : []), ...find(n.children, predicate)] : []); }
const text = node => node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join('');
const values = table => find(table.children, n => n.props.className === 'rpr-cell-value').map(text);

test('actual page SSR has three semantic tables with exact headers and unchanged zero/null/count cells', () => {
  const h = harness(), page = h.page(), nodes = expand(page);
  const tables = find(nodes, n => n.type === 'table');
  assert.equal(tables.length, 3);
  for (const [i, labels] of [editorialLabels, quotaLabels, personLabels].entries()) {
    assert.deepEqual(find(tables[i].children, n => n.props.scope === 'col').map(text), labels);
    assert.equal(tables[i].props.role, 'table');
    for (const label of find(tables[i].children, n => n.props.className === 'rpr-cell-label')) assert.equal(label.props['aria-hidden'], 'true');
    assert.deepEqual(find(tables[i].children, n => n.props.className === 'rpr-cell-label').map(text), labels.slice(1));
  }
  assert.deepEqual(values(tables[0]), ['0', '2', '3', '4', '5', 'lista: 6']);
  assert.deepEqual(values(tables[1]), ['0', 'No disponible', '0 confirmadas', '2 confirmadas']);
  assert.deepEqual(values(tables[2]), ['8', '1', '2', '3', '5', '0']);
  const html = renderToStaticMarkup(page);
  assert.equal((html.match(/<table\b/g) || []).length, 3);
  assert.match(html, /Alex &lt;observado&gt;/);
  assert.match(html, /Cuotas en conflicto: no se infiere un valor\./);
  assert.match(html, /las columnas no se suman/);
  assert.match(html, /Finalizar una tarea no demuestra publicación real/);
  assert.match(html, /Confirmaciones manuales de todo el equipo en el rango real/);
  assert.doesNotMatch(html, /Solo incluye piezas visibles según tus permisos/);
});

test('one native person action retains exact ID, disclosure state and real toggle callback', () => {
  for (const selectedId of [null, 17]) {
    const h = harness(selectedId), page = h.page(), nodes = expand(page);
    const buttons = find(nodes, n => n.type === 'button' && n.props.className === 'rpr-person-button');
    assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-expanded'], selectedId === 17);
    assert.equal(button.props['aria-controls'], 'rpr-person-17');
    button.props.onClick();
    assert.deepEqual(h.updates, [[5, selectedId === 17 ? null : 17]]);
    const row = find(nodes, n => n.props.className === 'rpr-detail-row')[0];
    assert.equal(row.props.hidden, selectedId !== 17);
    assert.equal(row.children[0].props.id, 'rpr-person-17');
    assert.equal(row.children[0].props.colSpan, 7);
    const html = renderToStaticMarkup(page);
    if (selectedId === 17) {
      assert.match(html, /href="\/workspace\/tareas\?task=41"/);
      assert.match(html, /estado almacenado: finalizada/);
      assert.match(html, /Piezas vinculadas a esta persona/);
      assert.doesNotMatch(html, /Mis piezas asignadas/);
    } else assert.equal(find(row.children, n => n.type === 'section').length, 0);
  }
});

test('nested actual EditorialTable uses the same headers, empty-state text and responsive table contract', () => {
  const { EditorialTable } = harness();
  const html = renderToStaticMarkup(React.createElement(EditorialTable, { rows: [{ ...summary[0], estados: [] }] }));
  assert.match(html, /rpr-responsive-table/);
  assert.match(html, /Sin registros fechados/);
  for (const label of editorialLabels) assert.ok(html.includes(label));
});

test('CSS AST limits stacked rows to600, retains accessible headers and overrides hidden detail after display rules', () => {
  const css = postcss.parse(read('./ReportProductionRegistry.css'));
  const media = css.nodes.filter(n => n.type === 'atrule' && n.name === 'media' && n.params.replace(/\s/g, '') === '(max-width:600px)');
  assert.equal(media.length, 1);
  const rules = [];
  media[0].walkRules(rule => rules.push(rule));
  const decl = rule => Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value]));
  const rule = selector => { const found = rules.filter(r => postcss.list.comma(r.selector).includes(selector)); assert.equal(found.length, 1, selector); return found[0]; };
  const row = rule('.rpr-page .rpr-responsive-table>tbody>tr');
  assert.equal(decl(row).display, 'grid');
  const hidden = rule('.rpr-page .rpr-responsive-table>tbody>tr[hidden]');
  assert.equal(decl(hidden).display, 'none');
  assert.ok(rules.indexOf(hidden) > rules.indexOf(row));
  assert.ok(rules.indexOf(hidden) > rules.indexOf(rule('.rpr-page .rpr-responsive-table>tbody>tr.rpr-detail-row')));
  const head = rule('.rpr-page .rpr-responsive-table>thead');
  assert.notEqual(decl(head).display, 'none'); assert.notEqual(decl(head).visibility, 'hidden');
  assert.equal(decl(head).position, 'absolute');
  assert.equal(decl(rule('.rpr-page .rpr-responsive-table>tbody>tr>:is(th,td)'))['white-space'], 'normal');
  assert.equal(decl(rule('.rpr-page .rpr-responsive-table .rpr-cell-label')).display, 'block');
  const desktopLabels = css.nodes.filter(n => n.type === 'rule' && n.selector === '.rpr-page .rpr-cell-label');
  assert.equal(desktopLabels.length, 1); assert.equal(decl(desktopLabels[0]).display, 'none');
  css.walkRules(r => { if (r.selector.includes('thead')) { assert.notEqual(decl(r).display, 'none'); assert.notEqual(decl(r).visibility, 'hidden'); } });
});
