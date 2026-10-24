import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { isConfirmedPublication, isHistoricalPublication } from '../shared/editorial/publication-evidence.js';
import { hasNoConfiguredMonthlyAgreement } from '../pages/clientCreate.js';
import { getResumenClientes, getPublicacionesDelMismoFeed, esDelMes } from '../clientesStats.js';

// Canonical modal JSX with inert hooks/Modal shell and real evidence helpers.
// This proves rendered content, not mounted focus, network or DB behavior.
const source = readFileSync(new URL('./ClienteModals.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClienteModals.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
const owner = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'DetalleClienteSession');
assert.ok(owner);
const compiled = ts.transpileModule(owner.getText(file), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const period = '2026-10';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const piece = (id, tipo, cliente_id = 7) => ({ id, tipo, cliente_id, estado: 'publicada', fecha_programada: '2026-10-15',
  metadata: { Idea: `Pieza ${id}` }, responsable: 'Autor observado',
  publicacion_evidencia: { classification: 'historica_sin_confirmacion', revision: 0, confirmation: null } });
function confirmed(row) {
  // Actual confirmation is deliberately in another month: these counters
  // describe the scheduled October cohort, not November's actual-date total.
  const instant = '2026-11-03T12:00:00.000Z';
  return { ...row, 'fecha_publicación_real': instant, publicacion_evidencia: {
    classification: 'confirmada_manualmente', revision: 2,
    confirmation: { id: `10000000-0000-4000-8000-${String(row.id).padStart(12, '0')}`, actor_id: 9,
      source: 'manual', occurred_at: instant, recorded_at: instant },
  } };
}
function fixture(shared, mode) {
  const base = { id: 7, nombre: 'Cuenta principal', activo: true, grupo_feed_id: shared ? 3 : null, grupo_feed_nombre: 'Feed observado',
    cuota_reels: 4, cuota_carruseles: 4, cuota_feed_reels: 6, cuota_feed_carruseles: 6,
    dias_historias: [1], abono_mensual: '12000.00', configuracion_completa: true, configuracion_vigente_desde: '2026-10-01' };
  const clients = [base, { ...base, id: 8, nombre: 'Cuenta hermana', grupo_feed_id: shared ? 3 : null }];
  let publications = [piece(1, 'reel'), piece(2, 'video', shared ? 8 : 7), piece(3, 'carrusel'), piece(4, 'carrusel', shared ? 8 : 7)];
  if (mode === 'fake-date') publications = publications.map(row => ({ ...row, 'fecha_publicación_real': '2026-10-15' }));
  if (mode === 'malformed-proof') publications = publications.map(row => ({ ...confirmed(row), publicacion_evidencia: {
    ...confirmed(row).publicacion_evidencia, confirmation: { ...confirmed(row).publicacion_evidencia.confirmation, source: 'metadata' },
  } }));
  if (mode === 'withdrawn') publications = publications.map(row => ({ ...confirmed(row), estado: 'lista', 'fecha_publicación_real': null,
    publicacion_evidencia: { classification: 'no_publicada', revision: 3, confirmation: null } }));
  if (mode === 'confirmed') publications.push(confirmed(piece(5, 'reel', shared ? 8 : 7)), confirmed(piece(6, 'carrusel', shared ? 8 : 7)));
  publications.push({ ...confirmed(piece(90, 'reel')), fecha_programada: '2026-11-03' }, confirmed(piece(91, 'carrusel', 99)));
  const stories = [piece(11, 'historia'), confirmed(piece(12, 'historia'))];
  const cliente = getResumenClientes(clients, stories, publications, { mes: period, avanceDelMes: 1 })[0];
  // Exactly the parent mount's ID/feed + scheduled-month projection.
  const selected = getPublicacionesDelMismoFeed(cliente, clients, publications).filter(row => esDelMes(row.fecha_programada, period));
  return freeze({ cliente, historias: stories.filter(row => row.cliente_id === cliente.id && esDelMes(row.fecha_programada, period)), publicaciones: selected });
}
function render(input) {
  const noWrite = () => assert.fail('Rendering a detail must not dispatch a request, navigation or mutation');
  const props = { ...input, periodo: period, capture: noWrite, onClose: noWrite, onCuotaActualizada: noWrite,
    onClienteActualizado: noWrite, onClienteEliminado: noWrite, onAccessDenied: noWrite };
  const deps = { React, isConfirmedPublication, isHistoricalPublication, hasNoConfiguredMonthlyAgreement,
    useState: initial => [initial, noWrite], useRef: current => ({ current }),
    Modal: ({ children, title }) => React.createElement('section', { role: 'dialog' }, title, children),
    getEstadoLabel: () => 'Sin clasificación', getTipoPublicacionLabel: tipo => tipo,
  };
  const tree = Function(...Object.keys(deps), `${compiled};return DetalleClienteSession;`)(...Object.values(deps))(props);
  return { tree, html: renderToStaticMarkup(tree) };
}
function nodes(root, predicate) {
  if (Array.isArray(root)) return root.flatMap(n => nodes(n, predicate));
  if (!React.isValidElement(root)) return [];
  return [...(predicate(root) ? [root] : []), ...nodes(root.props.children, predicate)];
}
const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
function metric(tree, label) {
  const metrics = nodes(tree, n => n.props.className === 'cliente-detail-metrics');
  assert.equal(metrics.length, 1);
  const found = React.Children.toArray(metrics[0].props.children).flatMap(n => n.type === React.Fragment ? React.Children.toArray(n.props.children) : [n])
    .find(n => React.Children.toArray(n.props.children).some(child => child.type === 'span' && text(child) === label));
  assert.ok(found, label);
  const value = React.Children.toArray(found.props.children).find(n => n.type === 'strong');
  return { value: React.Children.toArray(value.props.children)[0], text: text(found) };
}

for (const shared of [false, true]) for (const mode of ['legacy', 'fake-date', 'malformed-proof', 'withdrawn', 'confirmed']) {
  test(`${shared ? 'shared feed' : 'single account'}: ${mode} counts only genuine confirmation within the scheduled cohort`, () => {
    const input = fixture(shared, mode), before = structuredClone(input);
    assert.equal(input.publicaciones.length, mode === 'confirmed' ? 6 : 4);
    assert.equal(input.publicaciones.filter(isConfirmedPublication).length, mode === 'confirmed' ? 2 : 0);
    const { tree, html } = render(input), expected = mode === 'confirmed' ? 1 : 0;
    for (const label of shared ? ['Reels compartidos', 'Carruseles compartidos'] : ['Reels', 'Carruseles']) {
      const result = metric(tree, label);
      assert.equal(result.value, expected, `${label}: historical state/date/malformed proof must never count as manual confirmation`);
      assert.match(result.text, /confirmad[oa]s? manualmente/i);
    }
    assert.equal(metric(tree, 'Historias').value, 1, 'Stories retain the already-evidenced parent summary');
    assert.match(html, /Piezas programadas para 2026-10\./, 'Visible exact scheduled-month cohort, not actual-date month');
    assert.match(html, /La confirmación puede corresponder a otra fecha; no es verificación externa\./);
    assert.doesNotMatch(html, /Pieza 90|Pieza 91/, 'Other scheduled months and clients outside the feed stay excluded by the real parent projection');
    assert.doesNotMatch(html, /publicados este mes/);
    assert.deepEqual(input, before, 'Rendering cannot alter parent piece evidence or financial/operational fields');
  });
}

test('piece rows preserve historical records with an explicit non-confirmation label, and story metric makes confirmation semantics visible', () => {
  const { tree, html } = render(fixture(true, 'confirmed'));
  const rows = nodes(tree, n => n.type === 'tbody')[0];
  const rendered = nodes(rows, n => n.type === 'tr');
  assert.equal(rendered.length, 8, 'Two stories and all six publications remain listed');
  const historical = rendered.filter(row => /Pieza (1|2|3|4|11)$/.test(text(React.Children.toArray(row.props.children)[0])));
  assert.equal(historical.length, 5);
  for (const row of historical) assert.match(text(row), /históric[oa].*sin confirmación|sin confirmación manual/i);
  assert.match(metric(tree, 'Historias').text, /confirmad[oa]s? manualmente/i);
  assert.match(html, /Pieza 5/); assert.match(html, /Pieza 6/);
});

test('negative control reproduces the old state-only false count on the same genuine modal fixture', () => {
  const input = fixture(false, 'legacy');
  assert.equal(input.publicaciones.filter(row => row.estado === 'publicada' && ['reel', 'video'].includes(row.tipo)).length, 2);
  assert.equal(input.publicaciones.filter(row => row.estado === 'publicada' && row.tipo === 'carrusel').length, 2);
  assert.equal(input.publicaciones.filter(isConfirmedPublication).length, 0);
  const { tree } = render(input);
  assert.equal(metric(tree, 'Reels').value, 0);
  assert.equal(metric(tree, 'Carruseles').value, 0);
});
