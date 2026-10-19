import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectDomainConflict } from '../src/project-errors.js';
import { PERSONAL_HOME_SQL } from '../src/personal-home.js';
import { canonicalTaskOperationIntent } from '../src/task-operation-receipts.js';
import { areaForTask, emojiForTaskCard } from '../../frontend/src/features/render-os/utils/task-formatters.js';

test('only named project SQL domain errors become conflicts, never arbitrary database failures', () => {
  for (const code of ['23503','23505','23514']) {
    for (const constraint of ['proyecto_tareas_tarea_id_fkey','proyectos_responsable_id_fkey','proyecto_task_domain'])
      assert.equal(projectDomainConflict({code,constraint}), true);
    assert.equal(projectDomainConflict({code,constraint:'some_unrelated_constraint'}), false);
  }
  assert.equal(projectDomainConflict({code:'XX000',constraint:'proyecto_activity_failure'}), false);
  assert.equal(projectDomainConflict({code:'23503'}), false);
});

test('personal home project assignment is ID-scoped even for admin, with live bounded nonfinancial projection', () => {
  const scope = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf('my_projects AS MATERIALIZED'), PERSONAL_HOME_SQL.indexOf('SELECT jsonb_build_object'));
  assert.match(scope, /p.responsable_id=\$1/);
  assert.match(scope, /m.proyecto_id=p.id AND m.usuario_id=\$1/);
  assert.match(scope, /NOT p.archivado/);
  assert.match(scope, /NOT IN \('finalizado','cancelado'\)/);
  assert.doesNotMatch(scope, /\$2|lower\(|nombre\s*=/i);
  assert.match(PERSONAL_HOME_SQL, /FROM my_projects ORDER BY fecha_entrega ASC NULLS LAST,id LIMIT 8/);
  assert.match(PERSONAL_HOME_SQL, /'projects',\(SELECT count\(\*\)::int FROM my_projects\)/);
});

test('development uses the same task intent and principal API sector without changing publication semantics', () => {
  const intent = canonicalTaskOperationIntent({titulo:'Implementar formulario',sector:'Desarrollo',cliente_id:1,asignado_a_id:2}, {operation:'crear'});
  assert.equal(intent.business.sector,'desarrollo');
  assert.equal(Object.hasOwn(intent.business,'estado'),false);
  const server = readFileSync(new URL('../src/server.js', import.meta.url),'utf8');
  const types = server.slice(server.indexOf('const TIPOS_TAREA_VALIDOS'),server.indexOf('const PRIORIDADES_TAREA_VALIDAS'));
  assert.match(types, /"desarrollo"/);
  assert.equal(areaForTask({tipo_tarea:'desarrollo',titulo:'Implementar formulario'}),'desarrollo');
  assert.equal(areaForTask({tipo_tarea:'desarrollo',titulo:'Revisar video del reproductor'}),'desarrollo');
  assert.equal(areaForTask({tipo_tarea:'desarrollo',titulo:'Crear landing web'}),'web');
  assert.equal(emojiForTaskCard({tipo_tarea:'desarrollo',titulo:'Arreglar API'}),'💻');
});
