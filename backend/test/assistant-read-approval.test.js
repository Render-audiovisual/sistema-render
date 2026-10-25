import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTaskPriority, rankTaskPriorities } from '../src/task-priority.js';
import { classifyMiaTask, buildMiaDigest } from '../src/mia-task-digest.js';
import { buildMiaFastContext } from '../src/wilson-integration.js';

const today = '2026-10-25';
function task(id, extra = {}, estado = 'en_revision') {
  return Object.freeze({ id, titulo: `QA ${id}`, tipo_tarea: 'edicion', estado,
    fecha_vencimiento: '2026-11-20', created_at: '2026-10-10', updated_at: '2026-10-10',
    propiedades_extra: Object.freeze({ workspace: 'render_os', ...extra }) });
}
const tasks = Object.freeze([task(1, { revision_aprobada: true }), task(2, { revision_aprobada: 'true' }),
  task(3, { revision_aprobada: false }), task(4), task(5, {}, 'aprobada'),
  task(6, {}, 'finalizada'), task(7, {}, 'publicada')]);

test('priority treats historical boolean approval like explicit approval without rewriting raw state', () => {
  const history = scoreTaskPriority(tasks[0], { today }), approved = scoreTaskPriority(tasks[4], { today });
  assert.equal(history.waiting_review, false);
  for (const key of ['priority_score', 'priority_reasons', 'dynamic_priority', 'risk_tomorrow'])
    assert.deepEqual(history[key], approved[key], key);
  assert.equal(history.estado, 'en_revision');
  assert.equal(history.propiedades_extra, tasks[0].propiedades_extra);
  const ranked = rankTaskPriorities(tasks, { today, limit: 20 });
  assert.equal(ranked.summary.waiting_review, 3);
  assert.equal(ranked.summary.total, 5);
  assert.ok(!ranked.recommendations.some(row => [6, 7].includes(row.id)));
});

test('digest keeps date precedence but never calls effective approval pending review', () => {
  assert.deepEqual(classifyMiaTask(tasks[0], today), { rank: 4, category: 'Aprobadas' });
  for (const item of tasks.slice(1, 4)) assert.deepEqual(classifyMiaTask(item, today), { rank: 3, category: 'Para revisar' });
  assert.deepEqual(classifyMiaTask({ ...tasks[0], fecha_vencimiento: '2026-10-24' }, today), { rank: 0, category: 'Vencidas' });
  const digest = buildMiaDigest(tasks, { today, maxItems: 20 });
  assert.deepEqual(digest.items.filter(row => row.category === 'Aprobadas').map(row => row.id), [1, 5]);
  assert.deepEqual(digest.items.filter(row => row.category === 'Para revisar').map(row => row.id), [2, 3, 4]);
  assert.equal(digest.items.length, 5);
  assert.equal(digest.items.find(row => row.id === 1).estado, 'en_revision');
});

test('fast context projects approval consistently while preserving frozen source tasks and completion counts', () => {
  const before = JSON.stringify(tasks);
  const context = buildMiaFastContext(tasks, { name: 'QA editor', role: 'edicion' }, { today, limit: 20 });
  assert.equal(context.resumen.waiting_review, 3);
  assert.equal(context.resumen.en_revision, 3);
  assert.equal(context.resumen.finalizadas_mes, 0);
  assert.equal(context.resumen.total, 5);
  assert.equal(context.hacer_ahora.find(row => row.id === 1).estado, 'aprobada');
  for (const id of [2, 3, 4]) assert.equal(context.hacer_ahora.find(row => row.id === id).estado, 'en_revision');
  assert.equal(JSON.stringify(tasks), before);
});
