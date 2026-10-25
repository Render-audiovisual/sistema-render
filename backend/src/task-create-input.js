import {resolveTaskAssignments} from './task-assignments.js';
import {assertTaskBusinessInput} from './task-integration-fields.js';
import {normalizeTaskState} from './workflow-contract.js';
import {isProductionVisitTask,isValidProductionDate} from './production-visits.js';
import {captureTaskCreateReceipt} from './task-create-receipts.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;

// Explicit UUID contract: closed fields, stable IDs and normalized defaults.
// Legacy callers keep their old contract and share the same builder below.
export function extractTaskCreateAttempt(body,policy){
  assertTaskBusinessInput(body);
  if(!Object.hasOwn(body,'request_id'))return null;
  const allowed=['request_id','workspace','titulo','asignado_a_id','colaborador_ids','cliente_id','estado',
    'requiere_aprobacion','escalada_a','motivo','fecha_vencimiento','historia_id','publicacion_id','tipo_tarea',
    'subtipo','prioridad','aclaraciones','material_referencia','tarea_padre_id','resumen','etiquetas','produccion_videos_previstos'];
  if(Object.keys(body).some(key=>!allowed.includes(key))||body.workspace!=='render_os'||!positive(body.asignado_a_id))
    throw fail('El intento requiere campos permitidos, RENDER OS y responsable por ID.');
  const text=(key,fallback=null,max=20000)=>{
    const value=body[key];if(value===undefined||value===null||value==='')return fallback;
    if(typeof value!=='string'||value.includes('\u0000')||value.length>max)throw fail(`El campo ${key} no es válido.`);
    return value;
  };
  const id=key=>{const value=body[key];if(value===undefined||value===null)return null;if(!positive(value))throw fail(`El campo ${key} requiere un ID válido.`);return value;};
  const titulo=text('titulo',null,1000);if(!titulo?.trim())throw fail('Falta el título de la tarea.');
  const colaborador_ids=body.colaborador_ids??[];
  if(!Array.isArray(colaborador_ids)||colaborador_ids.length>100||colaborador_ids.some(value=>!positive(value)))throw fail('Los colaboradores requieren IDs válidos.');
  if(body.estado!==undefined&&typeof body.estado!=='string')throw fail('El estado debe ser un texto válido.');
  const estado=normalizeTaskState(body.estado??'pendiente');
  if(!['pendiente','en_progreso','en_revision'].includes(estado))throw fail('La tarea debe iniciar en un estado de trabajo válido.');
  const tipo_tarea=text('tipo_tarea'),prioridad=text('prioridad','media');
  if((tipo_tarea&&!policy.types.includes(tipo_tarea))||!policy.priorities.includes(prioridad))throw fail('Sector o prioridad inválidos.');
  if(body.requiere_aprobacion!==undefined&&typeof body.requiere_aprobacion!=='boolean')throw fail('La aprobación debe ser verdadero o falso.');
  const fecha_vencimiento=text('fecha_vencimiento');
  if(fecha_vencimiento!==null&&!isValidProductionDate(fecha_vencimiento))throw fail('La fecha no es válida.');
  const etiquetas=body.etiquetas??[];
  if(!Array.isArray(etiquetas)||etiquetas.length>100||etiquetas.some(value=>typeof value!=='string'||value.length>1000||value.includes('\u0000')))throw fail('Las etiquetas no son válidas.');
  const planned=body.produccion_videos_previstos??null;
  if(planned!==null&&!positive(planned))throw fail('Los videos previstos requieren un entero positivo.');
  const input=Object.freeze({workspace:'render_os',titulo,asignado_a_id:body.asignado_a_id,
    colaborador_ids:Object.freeze([...new Set(colaborador_ids)].filter(id=>id!==body.asignado_a_id).sort((a,b)=>a-b)),
    cliente_id:id('cliente_id'),estado,requiere_aprobacion:body.requiere_aprobacion??false,
    escalada_a:text('escalada_a'),motivo:text('motivo'),fecha_vencimiento,
    historia_id:id('historia_id'),publicacion_id:id('publicacion_id'),tipo_tarea,subtipo:text('subtipo'),prioridad,
    aclaraciones:text('aclaraciones'),material_referencia:text('material_referencia'),tarea_padre_id:id('tarea_padre_id'),
    resumen:text('resumen')?.trim()||null,etiquetas:Object.freeze(etiquetas.map(value=>value.trim()).filter(Boolean)),
    produccion_videos_previstos:planned});
  if(planned!==null&&!isProductionVisitTask(input))throw fail('Los videos previstos corresponden a una visita de producción.');
  const receipt={requestId:body.request_id,intent:input};
  const captured=captureTaskCreateReceipt(receipt);
  return Object.freeze({input,receipt:Object.freeze({...receipt,requestId:captured.requestId})});
}
export const TASK_CREATE_SQL=`INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, revision, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id, created_at, updated_at`;
export async function prepareTaskCreation(db,input,actor,{states:ESTADOS_TAREA_VALIDOS,types:TIPOS_TAREA_VALIDOS,priorities:PRIORIDADES_TAREA_VALIDAS}){
  assertTaskBusinessInput(input);
    const {
      titulo,
      asignado_a,
      cliente_id,
      estado,
      requiere_aprobacion,
      escalada_a,
      motivo,
      fecha_vencimiento,
      historia_id,
      publicacion_id,
      tipo_tarea,
      subtipo,
      prioridad,
      aclaraciones,
      material_referencia,
      tarea_padre_id,
      resumen,
      etiquetas,
      colaboradores,
      workspace,
      produccion_videos_previstos,
    } = input;

    if (actor?.rol !== "admin" && workspace !== "render_os") {
      throw fail("Solo podés crear tareas dentro de RENDER OS.",403);
    }

    if (!titulo || (!asignado_a && !input.asignado_a_id)) {
      throw fail("Faltan título o asignado_a.",400);
    }
    const assignment = await resolveTaskAssignments(db, {
      ...input, colaboradores,
    });
    if (tipo_tarea && !TIPOS_TAREA_VALIDOS.includes(tipo_tarea)) {
      throw fail("Sector (tipo_tarea) inválido.",400);
    }
    if (prioridad && !PRIORIDADES_TAREA_VALIDAS.includes(prioridad)) {
      throw fail("Prioridad inválida.",400);
    }

    const estadoFinal = ESTADOS_TAREA_VALIDOS.includes(normalizeTaskState(estado))
      ? normalizeTaskState(estado)
      : "pendiente";
    if (workspace === "render_os" && estado === "programada") {
      throw fail("El estado Programada ya no forma parte del flujo de tareas.",400);
    }
    if (["aprobada", "finalizada"].includes(estadoFinal)) {
      throw fail("Creá la tarea pendiente; la aprobación y finalización requieren su recorrido de trabajo.",400);
    }

    if (workspace === "render_os" && tarea_padre_id) {
      const padreRenderOS = await db.query(
        `SELECT id FROM tareas
         WHERE id = $1
           AND propiedades_extra->>'workspace' = 'render_os' FOR SHARE`,
        [tarea_padre_id],
      );
      if (padreRenderOS.rows.length === 0) {
        throw fail("Tarea padre no encontrada.",404);
      }
    }

    const propiedadesExtra = { Origen: "Cargada desde la plataforma" };
    if (escalada_a) {
      propiedadesExtra.escalada_a = escalada_a;
    }
    if (motivo) {
      propiedadesExtra.motivo = motivo;
    }
    if (resumen) {
      propiedadesExtra.resumen = String(resumen).trim();
    }
    if (Array.isArray(etiquetas)) {
      propiedadesExtra.etiquetas = etiquetas.map(String).map((item) => item.trim()).filter(Boolean);
    }
    propiedadesExtra.colaboradores = assignment.collaboratorNames;
    if (workspace === "render_os") {
      propiedadesExtra.workspace = "render_os";
      if (estadoFinal === "publicada") propiedadesExtra.finalizada_at = new Date().toISOString();
    }
    const nuevaTarea = { titulo, subtipo, tipo_tarea, propiedades_extra: propiedadesExtra };
    if (isProductionVisitTask(nuevaTarea)) {
      const planned = Number(produccion_videos_previstos);
      if (produccion_videos_previstos != null && produccion_videos_previstos !== "" && (!Number.isInteger(planned) || planned <= 0)) {
        throw fail("Los videos previstos deben ser un entero mayor que cero, o dejarse sin definir.",400);
      }
      if (planned > 0) propiedadesExtra.produccion_videos_previstos = planned;
      propiedadesExtra.produccion_registros = [];
    }


  return {sql:TASK_CREATE_SQL,values:[
        titulo,
        assignment.ownerName,
        cliente_id || null,
        estadoFinal,
        Boolean(requiere_aprobacion),
        JSON.stringify(propiedadesExtra),
        fecha_vencimiento || null,
        historia_id || null,
        publicacion_id || null,
        tipo_tarea || null,
        subtipo || null,
        prioridad || "media",
        aclaraciones || null,
        material_referencia || null,
        tarea_padre_id || null,
      ],assignment};
}

