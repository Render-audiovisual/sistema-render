import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { verifyHistoricalClosures } from './historical-closures.js';
import { buildEmployeeReport, employeeFormatBreakdown } from './production-registry-report.js';

const row = (fields = {}) => ({ periodo: '2026-09-01', usuario_id: 12,
  nombre_snapshot: 'Nombre histórico', porcentaje: 100, registrado_at: '2026-10-13T12:00:00.000Z', ...fields });
const dto = registros => ({ disponible: true, registros });

test('closed archive retains all periods, exact IDs, zero percentages and null timestamps without mutation', () => {
  const input = dto([row(), row({ periodo: '2025-01-01', porcentaje: 0, registrado_at: null }),
    row({ usuario_id: 13, nombre_snapshot: 'Nombre histórico', porcentaje: 37 })]);
  const before = structuredClone(input);
  Object.freeze(input); Object.freeze(input.registros); input.registros.forEach(Object.freeze);
  const actual = verifyHistoricalClosures(input);
  assert.deepEqual(actual, before);
  assert.notEqual(actual, input); assert.notEqual(actual.registros[0], input.registros[0]);
  assert.ok(Object.isFrozen(actual)); assert.ok(Object.isFrozen(actual.registros));
  assert.ok(actual.registros.every(Object.isFrozen)); assert.deepEqual(input, before);
});

test('unavailable, available-empty and malformed/missing archive remain distinct', () => {
  assert.deepEqual(verifyHistoricalClosures({ disponible: false, registros: [] }), { disponible: false, registros: [] });
  assert.deepEqual(verifyHistoricalClosures(dto([])), dto([]));
  for (const value of [undefined, null, [], {}, { disponible: 'true', registros: [] },
    { disponible: false, registros: [row()] }, { disponible: true, registros: null }]) {
    assert.equal(verifyHistoricalClosures(value), null);
  }
});

test('invalid IDs, months, percentages and timestamps reject the whole observation without coercion', () => {
  const bad = [
    ...[0, -1, 1.2, '12', 2147483648, null].map(usuario_id => ({ usuario_id })),
    ...['2026-09', '2026-09-02', '2026-13-01', '0000-01-01', '2026-09-01\n'].map(periodo => ({ periodo })),
    ...[-1, 101, 2.5, '100', true, NaN, Infinity, null].map(porcentaje => ({ porcentaje })),
    ...['', '2026-02-30T12:00:00Z', '2026-10-01', '2026-10-01T24:00:00Z', '2026-10-01T12:00:00Z\n', 0].map(registrado_at => ({ registrado_at })),
    { nombre_snapshot: {} },
  ];
  for (const fields of bad) assert.equal(verifyHistoricalClosures(dto([row({ usuario_id: 99 }), row(fields)])), null);
  assert.ok(verifyHistoricalClosures(dto([row({ registrado_at: '2024-02-29T12:00:00-03:00' })])));
});

test('duplicates, unknown/private fields and accessors are not silently accepted or executed', () => {
  assert.equal(verifyHistoricalClosures(dto([row(), row({ porcentaje: 0 })])), null);
  for (const field of ['importe', 'motivo', 'autorizado_por', 'metadata']) {
    assert.equal(verifyHistoricalClosures(dto([row({ [field]: 'PRIVATE' })])), null);
    assert.equal(verifyHistoricalClosures({ ...dto([]), [field]: 'PRIVATE' }), null);
  }
  const accessor = row(); Object.defineProperty(accessor, 'nombre_snapshot', { get() { throw Error('Do not execute getters'); } });
  assert.equal(verifyHistoricalClosures(dto([accessor])), null);
  assert.equal(verifyHistoricalClosures(Object.create(dto([]))), null);
});

// Compile the actual new JSX section with real shared responsive primitives.
const source = readFileSync(new URL('../../pages/Reportes.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Reportes.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length, 0);
let section, binding;
function walk(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'section'
    && node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p)
      && p.name.getText(ast) === 'aria-labelledby' && p.initializer?.text === 'rpr-closures')) section = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'closures') binding = node.initializer;
  ts.forEachChild(node, walk);
}
walk(ast); assert.ok(section); assert.ok(binding);
assert.match(binding.getText(ast), /verifyHistoricalClosures\(data\.cierresMensuales\)/);
assert.doesNotMatch(section.getText(ast), /range|period ===|usuarios|buildEmployeeReport|progress|applyMonthlyClosure/);
const sharedSource = readFileSync(new URL('../../components/ReportTable.jsx', import.meta.url), 'utf8');
const sharedAst = ts.createSourceFile('ReportTable.jsx', sharedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const declarations = sharedAst.statements.filter(ts.isFunctionDeclaration)
  .map(n => n.getText(sharedAst).replace(/^export /, '')).join('\n');
const code = ts.transpileModule(`${declarations}\nfunction View({data}){const closures=${binding.getText(ast)};return (${section.getText(ast)});}`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const View = new Function('React', 'verifyHistoricalClosures', `${code};return View;`)(React, verifyHistoricalClosures);
const render = data => renderToStaticMarkup(React.createElement(View, { data }));

test('actual report JSX uses responsive table and historical snapshot/ID independently of roster and range', () => {
  const data = { cierresMensuales: dto([row({ nombre_snapshot: '<Histórico>', porcentaje: 0 }),
    row({ usuario_id: 13, periodo: '2025-01-01', registrado_at: null })]),
    usuarios: [{ id: 12, nombre: 'Nombre nuevo' }, { id: 99, nombre: '<Histórico>' }] };
  const html = render(data);
  assert.match(html, /Cierres mensuales históricos/);
  assert.match(html, /rpr-responsive-table/); assert.match(html, /role="table"/);
  assert.match(html, /scope="col"/); assert.match(html, /scope="row"/);
  assert.match(html, /&lt;Histórico&gt; · #12/); assert.match(html, /#13/);
  assert.doesNotMatch(html, /Nombre nuevo|#99|<Histórico>/);
  assert.match(html, /2026-09/); assert.match(html, /2025-01/); assert.match(html, /0%/);
  assert.match(html, /Sin fecha registrada/); assert.match(html, /dateTime="2026-10-13T12:00:00.000Z"/);
  assert.match(html, /No acreditan tareas finalizadas ni publicaciones verificadas/);
  assert.match(html, /no modifican las métricas operativas/);
});

test('actual JSX does not confuse unavailable/empty/malformed with a verified zero closure', () => {
  assert.match(render({ cierresMensuales: { disponible: false, registros: [] } }), /no está disponible/);
  assert.match(render({ cierresMensuales: dto([]) }), /No hay cierres mensuales históricos registrados/);
  for (const cierresMensuales of [undefined, dto([row({ importe: 500 })])]) {
    const html = render({ cierresMensuales });
    assert.match(html, /No se pudo verificar/); assert.doesNotMatch(html, /<table|500|100%/);
  }
});

test('reading/rendering a closure never changes actual task metrics or source task/publication observations', () => {
  const users = [{ id: 12, nombre: 'Actual', rol: 'edicion' }];
  const tasks = [{ id: 1, titulo: 'Real', tipo_tarea: 'edicion', estado: 'en_revision',
    asignado_a_id: 12, colaborador_ids: [], fecha_vencimiento: '2026-10-01', propiedades_extra: { workspace: 'render_os' } }];
  const range = { desde: '2026-10-01', hasta: '2026-11-01' };
  const data = { usuarios: users, tareasRenderOs: tasks, publicaciones: [{ id: 8, estado: 'pendiente' }], cierresMensuales: dto([row()]) };
  const before = structuredClone(data);
  const employee = buildEmployeeReport(users, tasks, range, '2026-10-20');
  const formats = employeeFormatBreakdown(tasks, 12, range);
  render(data);
  assert.deepEqual(data, before);
  assert.deepEqual(buildEmployeeReport(users, tasks, range, '2026-10-20'), employee);
  assert.deepEqual(employeeFormatBreakdown(tasks, 12, range), formats);
  assert.equal(employee.rows[0].finalizadas, 0); assert.equal(employee.rows[0].enRevision, 1);
});
