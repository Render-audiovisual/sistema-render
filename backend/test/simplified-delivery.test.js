import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductionComplete, getProductionTaskState } from '../src/production-visits.js';
import { validateProductionHandoff } from '../src/task-workflow.js';
import { getProductionVisitProgress, groupProductionByClient } from '../../frontend/src/features/render-os/utils/production-visits.js';
import { getEditingResponsible, summarizeTaskDeliveries } from '../../frontend/src/shared/reports/report-utils.js';
import { filterReportDataForUser } from '../src/report-access.js';
import { canEmployeePatchTask } from '../src/task-access.js';

const visit = (metadata = {}) => ({ titulo: 'Moketa | Visita producción | 16/09', tipo_tarea: 'produccion', cliente_nombre: 'Moketa', material_referencia: 'https://drive.google.com/drive/folders/example', propiedades_extra: metadata });
test('a visit with no plan can be finished with its actual recorded count', () => {
  const task = visit({ produccion_registros: [{ cantidad: 3, fecha: '2026-09-16' }], produccion_finalizada_at: '2026-09-16T20:00:00Z' });
  assert.equal(isProductionComplete(task), true);
  assert.equal(getProductionVisitProgress(task).complete, true);
  assert.equal(validateProductionHandoff(task), null);
  assert.equal(getProductionTaskState({ recorded: 3, finished: true }), 'en_revision');
  assert.equal(groupProductionByClient([task], '2026-09-01', '2026-10-01').find(c => c.nombre === 'Moketa').grabados, 3);
  assert.equal(groupProductionByClient([task], '2026-10-01', '2026-11-01').find(c => c.nombre === 'Moketa').grabados, 0);
});
test('actual completion may be below plan but still requires real recordings and material', () => {
  const task = visit({ produccion_videos_previstos: 8, produccion_registros: [{ cantidad: 5 }], produccion_finalizada_at: '2026-09-16' });
  assert.equal(validateProductionHandoff(task), null);
  assert.match(validateProductionHandoff({ ...task, material_referencia: '' }), /Google Drive/);
  assert.equal(isProductionComplete(visit({ produccion_finalizada_at: '2026-09-16' })), false);
  assert.equal(isProductionComplete(visit({ produccion_registros: [{ cantidad: 3 }] })), false);
});
test('handing publication to another person retains editing credit without marking the video published', () => {
  const task = { id: 1, asignado_a: 'Oriana', asignado_a_id: 2, colaborador_ids: [], tipo_tarea: 'edicion', estado: 'en_revision', propiedades_extra: { edicion_responsable: 'Luciano', edicion_responsable_id: 7, revision_aprobada: true } };
  assert.equal(getEditingResponsible(task), 'Luciano');
  assert.deepEqual(summarizeTaskDeliveries([task]), { realizados: 1, pendientes: 0, total: 1 });
  const data = { tareas: [], tareasRenderOs: [task], usuarios: [], clientes: [], historias: [], publicaciones: [] };
  const credited = filterReportDataForUser(data, { id: 7, rol: 'edicion', nombre: 'Luciano' });
  assert.equal(credited.tareasRenderOs.length, 1);
  assert.equal(credited.tareasRenderOs[0].propiedades_extra.edicion_responsable_id, 7);
  assert.equal(filterReportDataForUser(data, { id: 8, rol: 'edicion', nombre: 'Luciano' }).tareasRenderOs.length, 0);
  assert.equal(filterReportDataForUser(data, { id: 7, rol: 'edicion', nombre: 'Editor renombrado' }).tareasRenderOs.length, 1);
  assert.equal(filterReportDataForUser(data, { id: 7, rol: 'diseno', nombre: 'Luciano' }).tareasRenderOs.length, 0);
  for (const id of [undefined, null, '7', 0, -1, 7.1, {}, true]) {
    const legacy = { ...data, tareasRenderOs: [{ ...task, propiedades_extra: { ...task.propiedades_extra, edicion_responsable_id: id } }] };
    assert.equal(filterReportDataForUser(legacy, { id: 7, rol: 'edicion', nombre: 'Luciano' }).tareasRenderOs.length, 0);
  }
  assert.equal(task.estado, 'en_revision');
});

test('employee request metadata cannot forge stable editing credit', () => {
  for (const role of ['edicion', 'diseno', 'produccion', 'community', 'programacion']) {
    assert.equal(canEmployeePatchTask({ propiedades_extra: { edicion_responsable_id: 7 } }, { workspace: 'render_os', role }), false);
    assert.equal(canEmployeePatchTask({ propiedades_extra: { edicion_responsable: 'Luciano' } }, { workspace: 'render_os', role }), false);
  }
});
