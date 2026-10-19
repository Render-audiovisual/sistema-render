import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUSES, BOARD_COLUMNS, canonicalTaskState, isTaskCompleted } from "../../frontend/src/features/render-os/constants.js";
import { canUserMoveTaskToState, canRetryTaskUpdate } from "../../frontend/src/features/render-os/utils/task-state.js";
import { getProductionPhase } from "../../frontend/src/features/render-os/utils/production-visits.js";
import { getCanonicalTaskContentMetadata, isLinkedProductionEditorialTask } from "../../frontend/src/features/render-os/utils/task-content.js";

const source = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
const admin = {id:1,rol:"admin"};
const community = {id:2,rol:"community"};
const owner = {id:3,rol:"diseno"};
const task = {id:10,estado:"en_revision",tipo_tarea:"diseno",asignado_a_id:3,colaborador_ids:[]};

test("five canonical states; legacy alias projects into final column without changing the DTO", () => {
  assert.deepEqual(STATUSES.map(s=>s.id),["pendiente","en_progreso","en_revision","aprobada","finalizada"]);
  assert.equal(BOARD_COLUMNS.length,5);
  for (const estado of [...STATUSES.map(s=>s.id),"publicada"]) {
    const dto = Object.freeze({...task,estado});
    const projected = canonicalTaskState(dto.estado);
    assert.equal(BOARD_COLUMNS.filter(column=>column.states.includes(projected)).length,1);
    assert.equal(dto.estado,estado);
    assert.equal(isTaskCompleted(dto),["publicada","finalizada"].includes(estado));
  }
  assert.equal(BOARD_COLUMNS.at(-1).dropState,"finalizada");
  assert.equal(canonicalTaskState("publicada"),"finalizada");
});

test("approval is admin-only from review across all work types; IDs cannot be replaced with names", () => {
  for (const tipo_tarea of ["diseno","edicion","produccion","community","administracion"]) {
    assert.equal(canUserMoveTaskToState({...task,tipo_tarea},admin,"aprobada"),true);
    for (const user of [community,owner,{id:4,nombre:"Franco",rol:"programacion"},{rol:"admin"}]) {
      assert.equal(canUserMoveTaskToState({...task,tipo_tarea},user,"aprobada"),false);
    }
  }
  for (const estado of ["pendiente","en_progreso","aprobada","finalizada","publicada"]) {
    assert.equal(canUserMoveTaskToState({...task,estado},admin,"aprobada"),false);
  }
});

test("finalization requires approval, preserves finalizer role limits, and never writes old states", () => {
  for (const user of [admin,community]) {
    for (const estado of ["pendiente","en_progreso","en_revision"]) {
      assert.equal(canUserMoveTaskToState({...task,estado},user,"finalizada"),false);
    }
    assert.equal(canUserMoveTaskToState({...task,estado:"aprobada"},user,"finalizada"),true);
  }
  assert.equal(canUserMoveTaskToState({...task,estado:"aprobada"},owner,"finalizada"),false);
  for (const requested of ["publicada","programada","en_proceso","revision","unknown"]) {
    assert.equal(canUserMoveTaskToState(task,admin,requested),false);
  }
  for (const estado of ["finalizada","publicada"]) {
    assert.equal(canUserMoveTaskToState({...task,estado},admin,"en_revision"),true);
    assert.equal(canUserMoveTaskToState({...task,estado},owner,"en_revision"),false);
  }
});

test("documented direct-completion exception only applies to a completed production visit and authorized ID", () => {
  const producer = {id:3,rol:"produccion"};
  const visit = {...task,titulo:"Visita al local",tipo_tarea:"produccion",propiedades_extra:{
    produccion_videos_previstos:1,produccion_registros:[{cantidad:1}],
  }};
  assert.equal(canUserMoveTaskToState(visit,producer,"finalizada"),true);
  assert.equal(canUserMoveTaskToState({...visit,asignado_a_id:4},producer,"finalizada"),false);
  assert.equal(canUserMoveTaskToState({...visit,titulo:"Otra producción"},producer,"finalizada"),false);
  assert.equal(canUserMoveTaskToState({...visit,propiedades_extra:{}},producer,"finalizada"),false);
});

test("production badges and objective linking recognize canonical and historical completion", () => {
  assert.deepEqual(getProductionPhase({estado:"aprobada"}),{id:"aprobada",label:"Aprobada"});
  for (const estado of ["finalizada","publicada"]) {
    assert.deepEqual(getProductionPhase({estado}),{id:"finalizada",label:"Finalizada"});
  }
  const goal = readFileSync(new URL("../../frontend/src/features/render-os/GoalTaskLink.jsx",import.meta.url),"utf8");
  assert.match(goal,/isTaskCompleted\(data.tarea\)/);
  assert.match(goal,/isTaskCompleted\(data\?\.tarea\)/);
  assert.doesNotMatch(goal,/estado === 'publicada'/);
});

test("saving content on historical task does not emit a state change or mutate assignments", async () => {
  const body = source.slice(source.indexOf("  const save = async"),source.indexOf("  const saveInlineField ="));
  for (const draftState of ["publicada","finalizada"]) {
    const original = {...task,titulo:"Historical",estado:"publicada",propiedades_extra:{}};
    let changes;
    const context = {task:original,draft:{...original,estado:draftState,aclaraciones:"Updated text"},
      metadata:{},tags:[],collaborators:[],canEditTask:true,canEditVisitClient:true,canEditVisitDate:true,isProductionVisit:false,productionProgress:{},
      getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask,canonicalTaskState,canUserMoveTaskToState,sesion:{usuario:admin},
      setSaving:()=>{},setEditing:()=>{},onUpdate:async(id,value)=>{changes=value;},onApprove:()=>assert.fail("no approval during content edit")};
    const save = new Function(...Object.keys(context),`${body}\nreturn save;`)(...Object.values(context));
    await save();
    assert.deepEqual(changes,{aclaraciones:"Updated text"});
    assert.equal(original.estado,"publicada");
    assert.equal(canRetryTaskUpdate(original,{...original,titulo:"Other title"},changes),true);
  }
});

test("source wiring covers all views, state filter, generic approval PATCH and safe creation defaults", () => {
  assert.match(source,/column.states.includes\(canonicalTaskState\(task.estado\)\)/);
  assert.match(source,/taskStatus === "all" \|\| canonicalTaskState\(task.estado\) === taskStatus/);
  assert.match(source,/aria-label="Filtrar por estado"/);
  assert.match(source,/item.id === canonicalTaskState\(task.estado\)/);
  assert.match(source,/repeat\(5, minmax\(220px, 1fr\)\)/);
  assert.match(source,/const canApproveForOriana = isLeader && task.estado === "en_revision";/);
  assert.match(source,/Aprobar revisión/);
  assert.match(source,/updateTask\(task.id, \{ estado: "aprobada", \.\.\.deliveryPrecondition \}/);
  assert.match(source,/observedRevision === null && canRetryTaskUpdate/);
  assert.match(source,/estado: \["pendiente", "en_progreso", "en_revision"\].includes\(initialStatus\) \? initialStatus : "pendiente"/);
  assert.doesNotMatch(source,/estado:\s*["']publicada["']|ESTADO_FINAL_TAREA/);
});
