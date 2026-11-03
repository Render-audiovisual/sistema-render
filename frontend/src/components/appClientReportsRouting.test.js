import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientReportDestination } from '../shared/navigation/client-report-navigation.js';
import { canonicalLegacyRoute } from '../shared/navigation/legacy-routes.js';
import { getNavigationGroups } from './navigation.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../App.jsx');

test('App prioritizes direct client-report compatibility over old team aliases', () => {
  assert.match(app, /legacyDestination\s*=\s*clientReportDestination\(route\)\s*\|\|\s*canonicalLegacyRoute\(route\)/);
  assert.match(app, /if\s*\(sessionKey\s*&&\s*legacyDestination\s*&&\s*!replaceClientReportRoute\(window\)\)\s*replaceLegacyRoute\(window,\s*legacyDestination\)/);
  for (const route of ['/equipo', '/equipo?persona=7', '/reportes-historias', '/reportes-historias?periodo=mes_actual']) {
    assert.equal(clientReportDestination(route) || canonicalLegacyRoute(route), '/instagram');
  }
  assert.doesNotMatch(app, /ReportesEquipoPage|import\(["']\.\/pages\/Reportes\.jsx["']\)/);
  assert.match(app, /if\s*\(path === "\/instagram"\)[\s\S]*?<InstagramPanelPage/);
  assert.match(app, /if\s*\(path === "\/instagram\/reporte"\)[\s\S]*?<InstagramClientReportPage/);
});

test('every role has exactly one client report navigation entry and no Instagram duplicate', () => {
  for (const role of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const links = getNavigationGroups(role).flatMap(group => group.links);
    assert.deepEqual(links.filter(link => /report|instagram|equipo/.test(link.href) || /Reportes|Instagram/.test(link.label)), [
      { href: '/instagram', label: 'Reportes', icon: 'reports' },
    ]);
  }
});

test('live home and prefetch do not expose or load historical person reports', () => {
  const home = read('../pages/QuickHome.jsx');
  const prefetch = read('../shared/navigation/route-prefetch.js');
  assert.doesNotMatch(home + prefetch, /reportes-historias|Reportes\.jsx|["']\/equipo["']/);
  assert.doesNotMatch(app, /import\(["']\.\/pages\/dashboards\/Lider\.jsx["']\)/);
});
