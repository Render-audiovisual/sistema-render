import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsInstagramOverview } from './instagramLoading.js';

test('only visible overview views load the monthly aggregate', () => {
  for (const tab of ['cuentas', 'reportes']) assert.equal(needsInstagramOverview({ tab }), false);
  assert.equal(needsInstagramOverview({ tab: 'clientes', selected: 'cliente-11' }), false);
  assert.equal(needsInstagramOverview({ tab: 'clientes', selected: null }), true);
  assert.equal(needsInstagramOverview({ tab: 'equipo' }), true);
  assert.equal(needsInstagramOverview({ tab: 'clientes', error: 'Invalid month' }), false);
});

test('saved report list is session-scoped independently of the selected report', () => {
  const source = readFileSync(new URL('./InstagramPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /capture: captureList.*useScopedRequest\(sesion, 'instagram-report-list'\)/);
  assert.match(source, /guard = captureList\(\)/);
  assert.match(source, /\}, \[captureList\]\)/);
  assert.match(source, /if\(!needsOverview\)return undefined/);
  assert.match(source, /instagram:\$\{period\}:\$\{version\}:\$\{needsOverview\}/);
});
