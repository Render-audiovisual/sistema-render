import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readInstagramLocation } from './instagramNavigation.js';
import { clientReportPanelLocation } from '../shared/navigation/client-report-navigation.js';
import { needsInstagramOverview } from './instagramLoading.js';
const source = readFileSync(new URL('./InstagramPanel.jsx', import.meta.url), 'utf8');

test('team bookmarks resolve to client cards with the original month and overview counts', () => {
  const location = clientReportPanelLocation(readInstagramLocation('?tab=equipo&periodo=2026-10', '2026-11'));
  assert.deepEqual(location, { tab: 'clientes', period: '2026-10', selected: null, error: '' });
  assert.equal(needsInstagramOverview(location), true);
  assert.match(source, /useState\(readPanelLocation\)/);
  assert.match(source, /setNavigation\(readPanelLocation\(\)\)/);
});

test('panel removes person reporting and preserves weekly client reports and format counts', () => {
  assert.match(source, /<h1>Reportes de clientes<\/h1>/);
  assert.doesNotMatch(source, /<h1>Instagram<\/h1>/);
  assert.doesNotMatch(source, /TeamView|data\.equipo|Rendimiento por persona|p\.responsables|ig-people|Equipo:/);
  assert.match(source, /<ReportsView sesion=\{sesion\}/);
  assert.match(source, /h\.clientes\.map/);
  assert.match(source, /cada sábado a las 9/);
  assert.match(source, /format=\{c\.fulfillment\?\.reels\}/);
  assert.match(source, /format=\{c\.fulfillment\?\.carruseles\}/);
  const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } });
  assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
});
