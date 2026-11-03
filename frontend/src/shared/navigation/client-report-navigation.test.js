import test from 'node:test';
import assert from 'node:assert/strict';
import { clientReportDestination, clientReportPanelLocation, replaceClientReportRoute } from './client-report-navigation.js';

test('only retired team routes redirect to client reports, dropping person filters', () => {
  for (const path of ['/reportes-historias', '/equipo']) {
    assert.equal(clientReportDestination(path), '/instagram');
    assert.equal(clientReportDestination(`${path}?persona=7&periodo=2026-10#equipo`), '/instagram');
  }
  for (const route of [null, '', '/instagram', '/instagram/reporte?cliente=cliente-1', '/equipo-extra', '/equipo/extra', '//equipo', '/%65quipo', '/equipo\\foo', 'https://other.test/equipo']) {
    assert.equal(clientReportDestination(route), null);
  }
});

test('team statistics retain their own tab and chosen month', () => {
  const old = { tab: 'equipo', period: '2026-10', selected: null, error: '' };
  assert.equal(clientReportPanelLocation(old),old);
  assert.equal(old.tab, 'equipo');
  for (const tab of ['clientes', 'reportes', 'cuentas']) {
    const location = { ...old, tab };
    assert.equal(clientReportPanelLocation(location), location);
  }
});

test('redirect replaces history and dispatches routing notification without erasing history state', () => {
  const calls = [], state = { navigation: 3 };
  const win = { location: { pathname: '/reportes-historias' }, history: { state, replaceState: (...args) => calls.push(args) }, PopStateEvent: class { constructor(type, init) { this.type = type; this.state = init.state; } }, dispatchEvent: event => calls.push(event) };
  assert.equal(replaceClientReportRoute(win), true);
  assert.deepEqual(calls[0], [state, '', '/instagram']);
  assert.equal(calls[1].type, 'popstate');
  assert.equal(calls[1].state, state);
  win.location.pathname = '/instagram';
  assert.equal(replaceClientReportRoute(win), false);
  assert.equal(calls.length, 2);
});
