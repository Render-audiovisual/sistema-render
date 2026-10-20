import { isValidProductionDate } from './production-visits.js';

const fail=message=>Object.assign(new Error(message),{status:409});
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;

export async function findProductionAdoptedEditingTask(db,visitId) {
  const row=(await db.query(`SELECT a.tarea_edicion_id FROM produccion_edicion_adopciones a
    JOIN produccion_reconciliaciones r ON r.id=a.reconciliacion_id WHERE r.visita_id=$1`,[visitId])).rows[0];
  return positive(row?.tarea_edicion_id)?row.tarea_edicion_id:null;
}

// Caller holds the objective-link advisory and both task locks in ID order.
// Evidence remains live on the original task, not a copied approval snapshot.
export async function prepareProductionEditingAdoption(db,source,input) {
  const children=(await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 ORDER BY id LIMIT 2",[String(source.id)])).rows;
  if(children.length!==1||children[0].id!==input.task_id)throw fail('La correspondencia requiere una única tarea de edición original. Revisá el expediente.');
  const task=(await db.query(`SELECT id,revision,cliente_id,tipo_tarea,historia_id,publicacion_id,
    to_char(fecha_vencimiento,'YYYY-MM-DD') AS deadline,
    propiedades_extra->>'workspace' AS workspace,
    propiedades_extra->>'archivada_render_os' AS archived,
    propiedades_extra->>'papelera_render_os' AS trashed,
    propiedades_extra->>'origen_produccion_video_id' AS video_source,
    propiedades_extra->>'produccion_visita_id' AS registry_source,
    propiedades_extra->>'origen_visita_id' AS source_id
    FROM tareas WHERE id=$1`,[input.task_id])).rows[0];
  if(!task||task.id===source.id||task.revision!==input.expected_revision||task.cliente_id!==source.cliente_id
    ||task.tipo_tarea!=='edicion'||task.workspace!=='render_os'||task.archived==='true'||task.trashed==='true'
    ||task.source_id!==String(source.id)||task.historia_id||task.publicacion_id||task.video_source||task.registry_source)throw fail('La edición original cambió o no es compatible con esta visita.');
  if(!isValidProductionDate(task.deadline))throw fail('Registrá explícitamente la fecha de entrega en la tarea original antes de vincularla.');
  if((await db.query('SELECT tarea_id FROM proyecto_tareas WHERE tarea_id=ANY($1::int[]) LIMIT 1',[[source.id,task.id]])).rows.length)
    throw fail('Una tarea de proyecto no puede adoptarse como producción audiovisual.');
  if((await db.query('SELECT id FROM cliente_objetivo_piezas WHERE tarea_id=$1 LIMIT 1',[task.id])).rows.length
    ||(await db.query('SELECT id FROM produccion_videos WHERE tarea_edicion_id=$1 OR tarea_entrega_id=$1 LIMIT 1',[task.id])).rows.length)
    throw fail('La edición ya tiene vínculos de contenido o producción. Requiere revisión específica.');
  const owners=(await db.query(`SELECT u.id,u.rol,u.activo FROM tarea_asignaciones a JOIN usuarios u ON u.id=a.usuario_id
    WHERE a.tarea_id=$1 AND a.tipo='responsable' ORDER BY u.id FOR SHARE OF u`,[task.id])).rows;
  if(owners.length!==1||!positive(owners[0].id)||owners[0].activo!==true||!['admin','edicion'].includes(owners[0].rol))
    throw fail('Asigná explícitamente un editor activo por ID en la tarea original antes de vincularla.');
  return {taskId:task.id,revision:task.revision,editorId:owners[0].id,deadline:task.deadline,ordinal:input.video_ordinal};
}

export async function persistProductionEditingAdoption(db,adoption,reviewId,videoId) {
  await db.query(`UPDATE produccion_videos SET tarea_edicion_id=$2,editor_id=$3,fecha_entrega=$4 WHERE id=$1`,
    [videoId,adoption.taskId,adoption.editorId,adoption.deadline]);
  await db.query(`INSERT INTO produccion_edicion_adopciones(reconciliacion_id,video_id,tarea_edicion_id,task_revision)
    VALUES($1,$2,$3,$4)`,[reviewId,videoId,adoption.taskId,adoption.revision]);
}
