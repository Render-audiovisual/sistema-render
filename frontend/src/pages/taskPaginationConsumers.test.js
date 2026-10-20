import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('all preserved full-array readers use the bounded all-pages adapter before aggregating', () => {
  for (const path of ['./dashboards/German.jsx', './dashboards/Lider.jsx', './dashboards/Augusto.jsx',
    './dashboards/Luciano.jsx', './TareasTablero.jsx', '../components/TareasAsignadasGenericas.jsx']) {
    const source = read(path);
    assert.match(source, /import \{ fetchAllTaskPages \} from ["'][^"']*shared\/tasks\/fetch-all-task-pages\.js["']/);
    assert.match(source, /fetchAllTaskPages\(/);
    assert.doesNotMatch(source, /fetch\(["']\/api\/tareas(?:\?[^"']*)?["']\)\s*\.then\(/);
  }
  const leader = read('./dashboards/Lider.jsx');
  assert.equal((leader.match(/fetchAllTaskPages\(/g) || []).length, 2, 'Both current and historical leader readers are migrated');
});

test('principal task board stays page-based; feedback separates its dedicated paginated inventory', () => {
  const source = read('../features/render-os/services/render-os-api.js');
  assert.match(source, /const limit = settings.limit === undefined \? 50 : settings.limit/);
  assert.match(source, /limit > 500/);
  assert.match(source, /offset > 1000000/);
  assert.doesNotMatch(source, /fetchAllTaskPages/);
  assert.match(read('./Feedback.jsx'), /<FeedbackTaskInventory/);
  assert.doesNotMatch(read('./Feedback.jsx'), /q=feedback/);
});
