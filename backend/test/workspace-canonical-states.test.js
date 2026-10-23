import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUSES, BOARD_COLUMNS, canonicalTaskState, isTaskCompleted } from "../../frontend/src/features/render-os/constants.js";
import { canUserMoveTaskToState, canRetryTaskUpdate } from "../../frontend/src/features/render-os/utils/task-state.js";
import { getProductionPhase } from "../../frontend/src/features/render-os/utils/production-visits.js";
import { getCanonicalTaskContentMetadata, isLinkedProductionEditorialTask } from "../../frontend/src/features/render-os/utils/task-content.js";
import { createCapturedRequest, isSessionFailure } from '../../frontend/src/shared/session/captured-request.js';
import { effectiveTaskFilterState } from '../../frontend/src/features/render-os/utils/task-view-state.js';

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
    const session={token:'synthetic-canonical',usuario:admin};
    const context = {task:original,draft:{...original,estado:draftState,aclaraciones:"Updated text"},
      captureRequest:request=>createCapturedRequest({session,readSession:()=>session,request}),isSessionFailure,
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

test("effective approval display never replaces the raw business state or grants finalization", () => {
  for (const flag of [true, false, 'true', null, undefined]) {
    const dto = Object.freeze({ ...task, propiedades_extra: Object.freeze({ revision_aprobada: flag }) });
    assert.equal(effectiveTaskFilterState(dto), flag === true ? 'aprobada' : 'en_revision');
    assert.equal(BOARD_COLUMNS.filter(column => column.states.includes(effectiveTaskFilterState(dto))).length, 1);
    assert.equal(dto.estado, 'en_revision');
    assert.equal(canonicalTaskState(dto.estado), 'en_revision');
    assert.equal(isTaskCompleted(dto), false);
    assert.equal(canUserMoveTaskToState(dto, admin, 'finalizada'), false);
    assert.equal(canUserMoveTaskToState(dto, community, 'finalizada'), false);
    assert.equal(canUserMoveTaskToState(dto, admin, 'aprobada'), true);
    assert.equal(canUserMoveTaskToState(dto, owner, 'aprobada'), false);
  }
  const historical = Object.freeze({ ...task, estado: 'publicada' });
  assert.equal(effectiveTaskFilterState(historical), 'finalizada');
  assert.equal(historical.estado, 'publicada');
});

test("actual move callback keeps historical approval display out of generic business writes", () => {
  const body = source.slice(source.indexOf('  const move = useCallback((task, status) =>'), source.indexOf('  const openFeedback = useCallback'));
  assert.ok(body.startsWith('  const move = useCallback'));
  const writes = [], approvals = [], errors = [], openings = [];
  const context = { useCallback: callback => callback, orderState: { busy: false, locked: false },
    canonicalTaskState, canUserMoveTaskToState, STATUSES, sesion: { usuario: admin },
    onUpdate: (...args) => { writes.push(args); return Promise.resolve(); },
    onApprove: dto => { approvals.push(dto); return Promise.resolve(); }, onError: message => errors.push(message),
    openTask: (id, review) => { openings.push([id, review]); return Promise.resolve(); } };
  const move = new Function(...Object.keys(context), `${body}\nreturn move;`)(...Object.values(context));
  const dto = Object.freeze({ ...task, propiedades_extra: Object.freeze({ revision_aprobada: true }) });
  assert.equal(effectiveTaskFilterState(dto), 'aprobada');
  move(dto, 'en_revision');
  assert.deepEqual(writes, []); assert.deepEqual(approvals, []); assert.deepEqual(errors, []);
  move(dto, 'finalizada');
  assert.equal(errors.length, 1); assert.deepEqual(writes, []); assert.deepEqual(approvals, []);
  move(dto, 'aprobada');
  assert.deepEqual(approvals, [dto]); assert.deepEqual(writes, []);
  assert.equal(dto.estado, 'en_revision');
  assert.deepEqual(openings, []);
  const editing = Object.freeze({ ...dto, tipo_tarea: 'edicion', propiedades_extra: Object.freeze({ workspace: 'render_os' }) });
  assert.equal(move(editing, 'aprobada'), 'review');
  assert.deepEqual(openings, [[editing.id, true]]);
  assert.deepEqual(approvals, [dto]); assert.deepEqual(writes, []);
  assert.equal(editing.estado, 'en_revision', 'Opening a delivery review does not approve the work');
});

test("source wiring covers all views, effective state filter, generic approval PATCH and safe creation defaults", () => {
  assert.match(source,/column.states.includes\(effectiveTaskFilterState\(task\)\)/);
  assert.match(source,/taskStatus === "all" \|\| effectiveTaskFilterState\(task\) === taskStatus/);
  assert.match(source,/aria-label="Filtrar por estado"/);
  assert.match(source,/item.id === canonicalTaskState\(task.estado\)/);
  assert.match(source,/value=\{canonicalTaskState\(task.estado\)\}/);
  assert.match(source,/if \(status === canonicalTaskState\(task.estado\)\) return/);
  assert.match(source,/if \(!canUserMoveTaskToState\(task, sesion\?\.usuario, status\)\)/);
  assert.match(source,/Aprobada \(registro histórico; sin evidencia de entrega\)/);
  assert.match(source,/repeat\(5, minmax\(220px, 1fr\)\)/);
  assert.match(source,/const canApproveForOriana = isLeader && task.estado === "en_revision";/);
  assert.match(source,/Aprobar revisión/);
  assert.match(source,/updateTask\(task.id, \{ estado: "aprobada", \.\.\.deliveryPrecondition \}/);
  assert.match(source,/observedRevision === null && canRetryTaskUpdate/);
  assert.match(source,/estado: \["pendiente", "en_progreso", "en_revision"\].includes\(initialStatus\) \? initialStatus : "pendiente"/);
  assert.doesNotMatch(source,/estado:\s*["']publicada["']|ESTADO_FINAL_TAREA/);
});
