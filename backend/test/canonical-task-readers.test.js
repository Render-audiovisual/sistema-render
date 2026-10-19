import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateSalaryDashboard } from '../src/salary-calculation.js';
import { summarizeRenderOsByDay } from '../src/report-access.js';
import { rankTaskPriorities } from '../src/task-priority.js';
import { classifyMiaTask } from '../src/mia-task-digest.js';
import { buildMiaGroupDigests, buildMiaWeeklyCarruselDigest } from '../src/mia-group-digest.js';
import { buildEmployeeSnapshot, buildEmployeeStatusReply } from '../src/wilson-chat.js';
import { getProductionPhase } from '../src/production-visits.js';
import { groupFilmingTasksByClient, isCompletedForEmployeeReport } from '../../frontend/src/shared/reports/report-utils.js';
import { getResumenClientes } from '../../frontend/src/clientesStats.js';
import { isTaskAssignedToPerson } from '../../frontend/src/shared/dashboard-stats.js';

const states = ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada'];
const tasks = states.map((estado, index) => ({ id: index + 1, estado, titulo: 'Carrusel',
  tipo_tarea: 'diseno', asignado_a: 'Augusto', cliente_id: 1, cliente_nombre: 'Cliente',
  fecha_vencimiento: '2026-10-19', propiedades_extra: { workspace: 'render_os' } }));

test('salary and operational summaries count final tasks, not approvals or editorial aliases', () => {
  const salary = calculateSalaryDashboard({ period: '2026-10', tasks,
    publications: [{ id: 1, estado: 'finalizada', fecha_programada: '2026-10-19' },
      { id: 2, estado: 'aprobada', fecha_programada: '2026-10-19' },
      { id: 3, estado: 'publicada', fecha_programada: '2026-10-19' }] });
  assert.equal(salary.employees.find(row => row.name === 'Augusto').completed, 2);
  assert.equal(salary.employees.find(row => row.name === 'Oriana').completed, 1);
  const summary = summarizeRenderOsByDay(tasks);
  assert.equal(summary['2026-10-19'].carruseles.publicadas, 2);
});

test('priority and individual digest keep approvals actionable and exclude both final spellings', () => {
  const ranked = rankTaskPriorities(tasks, { today: '2026-10-19', limit: 20 });
  assert.ok(ranked.recommendations.some(task => task.estado === 'aprobada'));
  assert.ok(ranked.recommendations.every(task => !['finalizada', 'publicada'].includes(task.estado)));
  for (const task of tasks) {
    assert.equal(Boolean(classifyMiaTask(task, '2026-10-19')), !['finalizada', 'publicada'].includes(task.estado));
  }
});

test('group delivery remains monotonic through review, approval and completion', () => {
  const digests = buildMiaGroupDigests(tasks, { today: '2026-10-19' });
  assert.equal(digests.length, 1);
  assert.match(digests[0].text, /4\/6 carruseles listos/);
  assert.deepEqual(buildMiaWeeklyCarruselDigest(tasks.slice(2), { today: '2026-10-19' }), []);
  for (const task of tasks) assert.equal(isCompletedForEmployeeReport(task), task.id >= 3);
  const filming = groupFilmingTasksByClient(tasks.map(task => ({ ...task, tipo_tarea: 'produccion' })));
  assert.equal(filming[0].grabados, 2);
});

test('Wilson separates approval from completion without claiming publication', () => {
  const snapshot = buildEmployeeSnapshot(tasks.map(task => ({ ...task, tipo_tarea: 'edicion' })),
    { nombre: 'Editor', rol: 'edicion' }, '2026-10');
  assert.equal(snapshot.approved.length, 1);
  assert.equal(snapshot.completed.length, 2);
  const reply = buildEmployeeStatusReply(snapshot);
  assert.match(reply.text, /4 entregadas/);
  assert.doesNotMatch(reply.text, /están publicadas/);
  const community = buildEmployeeSnapshot(tasks, { rol: 'community' }, '2026-10');
  assert.equal(community.approved.length, 1);
  assert.equal(community.completed.length, 2);
  assert.equal(buildEmployeeSnapshot(tasks.slice(4).map(task => ({ ...task, fecha_vencimiento: '2026-09-19' })), {}, '2026-10').tasks.length, 0);
});

test('production phase handles canonical approval and final states before work phases', () => {
  for (const estado of ['finalizada', 'publicada']) assert.equal(getProductionPhase({ estado, tipo_tarea: 'edicion' }), 'finalizada');
  assert.equal(getProductionPhase({ estado: 'aprobada', tipo_tarea: 'edicion' }), 'aprobada');
});

test('client publication totals rely on pieces, never linked or unlinked completed tasks', () => {
  const clients = [{ id: 1, cuota_carruseles: 6 }];
  const publications = [{ id: 1, cliente_id: 1, tipo: 'carrusel', estado: 'pendiente', fecha_programada: '2026-10-19' }];
  const options = { mes: '2026-10', avanceDelMes: 0.5, tareas: tasks.map(task => ({ ...task, publicacion_id: 1 })) };
  assert.equal(getResumenClientes(clients, [], publications, options)[0].piezasPublicadas, 0);
  publications[0].fecha_publicación_real = '2026-10-19T10:00:00Z';
  assert.equal(getResumenClientes(clients, [], publications, options)[0].piezasPublicadas, 0);
  publications[0].estado = 'publicada';
  assert.equal(getResumenClientes(clients, [], publications, options)[0].piezasPublicadas, 0);
  publications[0].publicacion_evidencia = { classification: 'confirmada_manualmente', revision: 1,
    confirmation: { id: '34349ff1-15c7-4d7b-9c14-000000000001', actor_id: 1, source: 'manual',
      occurred_at: '2026-10-19T10:00:00Z', recorded_at: '2026-10-19T10:00:00Z' } };
  assert.equal(getResumenClientes(clients, [], publications, options)[0].piezasPublicadas, 1);
  assert.equal(getResumenClientes(clients, [], [], options)[0].piezasPlanificadas, 0);
});

test('task UI writes canonical final state and passes revision concurrency token', () => {
  const goal = readFileSync(new URL('../../frontend/src/pages/ClientesObjetivos.jsx', import.meta.url), 'utf8');
  assert.match(goal, /estado: done\(piece\) \? 'pendiente' : 'finalizada'/);
  assert.match(goal, /expected_revision: task.revision/);
  const generic = readFileSync(new URL('../../frontend/src/components/TareasAsignadasGenericas.jsx', import.meta.url), 'utf8');
  assert.match(generic, /option value="finalizada"/);
  assert.doesNotMatch(generic, /option value="publicada"/);
  assert.match(generic, /expected_revision: tarea\?\.revision/);
});

// Exercise pure helpers embedded in the JSX module without loading React or a browser.
function utilsFunction(name, dependencies = {}) {
  const source = readFileSync(new URL('../../frontend/src/utils.jsx', import.meta.url), 'utf8');
  const start = source.indexOf(`export function ${name}(`);
  const end = source.indexOf('\nexport function ', start + 1);
  return new Function(...Object.keys(dependencies), `${source.slice(start, end < 0 ? undefined : end).replace(/^export /, '')}; return ${name};`)(...Object.values(dependencies));
}

test('mixed dashboard counts final tasks without treating approved pieces as published', () => {
  const summarize = utilsFunction('getResumenEquipo', {
    getHoyLocalISO: () => '2026-10-20', isTaskAssignedToPerson,
    esDelMesActual: value => value?.startsWith('2026-10'),
    calcularPorcentajePublicadas: items => items.length ? Math.round(items.filter(item => item.estado === 'publicada').length * 100 / items.length) : 0,
  });
  const augusto = summarize([], [], tasks).find(row => row.nombre === 'Augusto');
  assert.equal(augusto.atrasadas, 4);
  assert.equal(augusto.cumplimiento, 33);
  const pieceOnly = summarize([], [{ responsable: 'Augusto', estado: 'finalizada', fecha_programada: '2026-10-19' }], [])
    .find(row => row.nombre === 'Augusto');
  assert.equal(pieceOnly.atrasadas, 1);
  assert.equal(pieceOnly.cumplimiento, 0);
});

test('completed legacy and canonical parents release material dependency, approval does not', () => {
  const waiting = utilsFunction('esperandoMaterial');
  for (const estado of states) assert.equal(waiting({ tarea_padre_id: 1, tarea_padre_estado: estado }), !['finalizada', 'publicada'].includes(estado));
});
