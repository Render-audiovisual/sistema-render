import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTaskDraftDirty, keepsTaskOpen } from './taskNavigationGuard.js';
import { getUnifiedTaskContent } from '../features/render-os/utils/task-content.js';
const task = { id: 1, titulo: 'Video', estado: 'pendiente', cliente_id: 3, propiedades_extra: { guiones: 'Guion', resumen: 'Idea', etiquetas: ['Reel'] } };
const draft = () => ({ ...task, aclaraciones: getUnifiedTaskContent(task) });
test('unchanged task with legacy merged scripts and read-only revision is clean', () => {
  assert.equal(isTaskDraftDirty(task, { ...draft(), revision: 99 }), false);
});
test('editable task fields protect pending text, dates and metadata', () => {
  for (const [field, value] of Object.entries({ titulo: 'Otro', cliente_id: 4, fecha_vencimiento: '2026-10-20', prioridad: 'alta', tipo_tarea: 'diseno', subtipo: 'Reel', material_referencia: 'https://drive.google.com/a', estado: 'en_progreso', aclaraciones: 'Otro guion', resumen: 'Otra idea', etiquetas: 'Otro', produccion_videos_previstos: 3 })) {
    assert.equal(isTaskDraftDirty(task, { ...draft(), [field]: value }), true, field);
  }
  assert.equal(isTaskDraftDirty(task, { ...draft(), resumen: 'Idea', etiquetas: ' Reel ' }), false);
});
test('only the same task route preserves open draft context; other resources and unload do not', () => {
  assert.equal(keepsTaskOpen('/workspace/tareas?task=1&view=list#info', 1), true);
  for (const target of [null, '/workspace/tareas', '/workspace/tareas?task=2', '/moodboards?task=1', '/tareas?task=1']) assert.equal(keepsTaskOpen(target, 1), false);
});
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
test('task detail protects content/comment/delivery and all current writes without duplicate listeners', () => {
  assert.match(source, /isTaskDraftDirty\(task, draft\) \|\| Boolean\(comment.trim\(\)\) \|\| deliveryDirty/);
  assert.match(source, /const taskWriteBusy = saving \|\| commenting \|\| archiving \|\| registeringProduction \|\| savingProductionDrive \|\| approving \|\| confirmingProduction \|\| deliveryBusy/);
  assert.doesNotMatch(source, /addEventListener\("(?:beforeunload|render:before-navigation)"/);
});
test('task switches gate before selection/history and feedback gates before history', () => {
  assert.match(source, /if \(!requestAppNavigation\(window, url.href\)\) return false;\s+setSelectedId\(id\);\s+window.history.pushState/);
  assert.match(source, /if \(!requestAppNavigation\(window, "\/feedback"\)\) return;\s+window.history.pushState/);
  assert.match(source, /navigateWithinApp\(window, `\/moodboards\?/);
});
test('new task clears guard only after creation success, before post-create navigation', () => {
  assert.match(source, /const created = await onCreate\(/);
  assert.match(source, /completedRef.current = true;\s+onCreated\(created\)/);
  assert.match(source, /busy: !completedRef.current && saving/);
  assert.match(source, /const closeModal = \(\) => \{\s+if \(saving\) return;/);
});
