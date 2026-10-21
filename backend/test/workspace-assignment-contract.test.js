import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTaskAssignmentInput } from "../../frontend/src/shared/task-assignment-input.js";
import { getCanonicalTaskContentMetadata, isLinkedProductionEditorialTask } from "../../frontend/src/features/render-os/utils/task-content.js";
import { canonicalTaskState } from "../../frontend/src/features/render-os/constants.js";
import { createCapturedRequest, isSessionFailure } from '../../frontend/src/shared/session/captured-request.js';
const displaySession = {token:'synthetic-session',usuario:{id:7,rol:'admin',activo:true}};
const currentGuard = () => createCapturedRequest({session:displaySession,readSession:()=>displaySession,request:()=>assert.fail('No request expected')});

const source = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
// Execute the actual pure selection/suggestion portions, without React, DOM, API or DB.
const picker = section("  const selected = [primaryId", "  return <div className={`wide ros-people-picker");
function select(users, primaryId, collaboratorIds, id) {
  let result;
  new Function("users", "primaryId", "collaboratorIds", "disabled", "onChange", "id", `${picker}\n toggle(id);`)(users, primaryId, collaboratorIds, false, (value) => { result = value; }, id);
  return result;
}

test("picker distinguishes duplicate names by ID and preserves IDs across renames", () => {
  const users = [{ id: 1, nombre: "Alex" }, { id: 2, nombre: "Alex" }, { id: 3, nombre: "Renamed" }];
  const result = select(users, 1, [], 2);
  assert.deepEqual(result, { ownerId: 1, collaboratorIds: [2], primary: "Alex", collaborators: ["Alex"] });
  assert.deepEqual(buildTaskAssignmentInput(result), { asignado_a_id: 1, colaborador_ids: [2] });
  assert.deepEqual(select(users, 3, [2], 2), { ownerId: 3, collaboratorIds: [], primary: "Renamed", collaborators: [] });
  assert.equal(select(users, null, [], 2).ownerId, 2);
  assert.equal(select(users, 1, [], 1).ownerId, null);
});

test("creation suggestions resolve only unique labels; ambiguous labels require manual choice", () => {
  const body = section("  const applySuggestions =", "  return <div className=\"ros-drawer-backdrop ros-modal-backdrop\"");
  const run = (users, suggestion) => {
    let message;
    const apply = new Function("users", "clients", "manuallyEdited", "getNewTaskSuggestions", "setSuggestionMessage", `${body}\nreturn applySuggestions;`)(
      users, [], { current: new Set() }, () => ({ tipo_tarea: "edicion", subtipo: "reel", ...suggestion }), (value) => { message = value; },
    );
    return { draft: apply({ titulo: "Editar reel", cliente_id: "" }), message };
  };
  const suggestion = { primary: "Alex", collaborators: ["Sam"] };
  const unique = run([{ id: 1, nombre: "Alex" }, { id: 2, nombre: "Sam" }], suggestion);
  assert.equal(unique.draft.asignado_a_id, 1);
  assert.deepEqual(unique.draft.colaborador_ids, [2]);
  const ambiguous = run([{ id: 1, nombre: "Alex" }, { id: 3, nombre: "Alex" }, { id: 2, nombre: "Sam" }], suggestion);
  assert.equal(ambiguous.draft.asignado_a_id, null);
  assert.deepEqual(ambiguous.draft.colaborador_ids, []);
  assert.match(ambiguous.message, /manualmente/);
});

test("saving content preserves collaborators without resending assignments or display-name writes", async () => {
  const body = section("  const save = async", "  const saveInlineField =");
  const task = { id: 5, titulo: "Original", asignado_a_id: 1, colaborador_ids: [2], propiedades_extra: { colaboradores: ["Alex"], resumen: "Keep", etiquetas: ["tag"] } };
  let changes;
  const noop = () => {};
  const save = new Function("task", "draft", "metadata", "tags", "collaborators", "canEditTask", "isProductionVisit", "productionProgress", "getCanonicalTaskContentMetadata", "setSaving", "setEditing", "onUpdate", "canonicalTaskState", "canEditVisitClient", "canEditVisitDate", "isLinkedProductionEditorialTask", "captureRequest", `${body}\nreturn save;`)(
    task, { ...task, aclaraciones: "New content" }, task.propiedades_extra, ["tag"], ["Alex"], true, false, {}, getCanonicalTaskContentMetadata, noop, noop, async (id, value) => { changes = value; }, canonicalTaskState, true, true, isLinkedProductionEditorialTask, currentGuard,
  );
  await save();
  assert.equal(changes.aclaraciones, "New content");
  assert.equal(Object.hasOwn(changes, "asignado_a"), false);
  assert.equal(Object.hasOwn(changes, "asignado_a_id"), false);
  assert.equal(Object.hasOwn(changes, "colaborador_ids"), false);
  assert.equal(Object.hasOwn(changes, "propiedades_extra"), false);
  assert.deepEqual(task.colaborador_ids, [2]);
});

test("inline people save uses the validated ID DTO and not legacy metadata names", async () => {
  const body = section("  const saveInlinePeople =", "  const cancelEditing =");
  let changes;
  const save = new Function("task", "canEditTask", "saving", "buildTaskAssignmentInput", "setDraft", "setSaving", "onUpdate", "collaborators", "captureRequest", `${body}\nreturn saveInlinePeople;`)(
    { id: 5, asignado_a_id: null, colaborador_ids: [] }, true, false, buildTaskAssignmentInput, () => {}, () => {}, async (id, value) => { changes = value; }, [], currentGuard,
  );
  await save({ primary: "Same", collaborators: ["Same"], ownerId: 1, collaboratorIds: [2] });
  assert.deepEqual(changes, { asignado_a_id: 1, colaborador_ids: [2] });
});

test("source contract: stable IDs, explicit history warning, admin leadership and production access", () => {
  assert.match(source, /primaryId=\{draft\.asignado_a_id \?\? task\.asignado_a_id/);
  assert.match(source, /collaboratorIds=\{draft\.colaborador_ids \?\? task\.colaborador_ids/);
  assert.match(source, /const isLeader = isAdmin;/);
  assert.doesNotMatch(source, /userIdentity|startsWith\("german"\)|includes\("franco"\)/);
  assert.match(source, /canUserEditTask\(task, sesion.usuario\) && \(isAdmin \|\| sesion.usuario.rol === "produccion"\)/);
  assert.match(source, /Asignación histórica sin vincular/);
  assert.match(source, /El nombre histórico no concede acceso/);
  assert.match(source, /body: JSON.stringify\(\{ responsable_publicacion_id, expected_revision: review\?\.revision \?\? task.revision, \.\.\.deliveryPrecondition \}\)/);
  assert.match(source, /value=\{user.id\}/);
  assert.match(source, /buildTaskAssignmentInput\(\{ ownerId: draft.asignado_a_id, collaboratorIds: draft.colaborador_ids \|\| \[\] \}\)/);
});

test("approval sends selected publisher ID, keeps display label; generic approval needs no publisher", async () => {
  const body = section("  const approveTask =", "  const bulkTaskAction =");
  const requests = [];
  const notices = [];
  const updates = [];
  const stale = [];
  const users = [{ id: 1, nombre: "Alex", rol: "community" }, { id: 2, nombre: "Alex", rol: "admin" }, { id: 3, nombre: "Other", rol: "diseno" }];
  const task = { id: 5, revision: 7, cliente_nombre: "Client" };
  const sesion = displaySession; let currentSession = sesion;
  const request = async (url, request) => { requests.push(JSON.parse(request.body)); return task; };
  const captureRequest = () => createCapturedRequest({session:sesion,readSession:()=>currentSession,request});
  const approve = new Function("users", "apiRequest", "tasksRef", "setTasks", "logActivity", "notify", "updateTask", "sesion", "getSesion", "captureRequest", "isSessionFailure", "markReviewQueueStale", `${body}\nreturn approveTask;`)(
    users, async (url, request) => { requests.push(JSON.parse(request.body)); return task; },
    { current: [task] }, () => {}, async () => {}, (message) => notices.push(message), async (id, changes) => updates.push({id,changes}), sesion, () => currentSession, captureRequest, isSessionFailure,
    (guard,uncertain=false)=>{guard.assertCurrent();stale.push(uncertain);},
  );
  await approve(task, 2);
  assert.deepEqual(requests, [{ responsable_publicacion_id: 2, expected_revision: 7 }]);
  assert.equal(notices.at(-1), "Tarea aprobada y enviada a Alex.");
  assert.deepEqual(stale,[false]);
  await approve(task);
  assert.deepEqual(updates, [{id:5,changes:{estado:"aprobada"}}]);
  assert.deepEqual(stale,[false], 'Generic approval delegates invalidation to updateTask, never double-counts it');
  for (const id of [null, "2", 0, -1, 1.5, 3, 999]) {
    await assert.rejects(approve(task, id), /responsable de publicación válido/);
  }
  assert.equal(requests.length, 1);
  assert.equal(stale.filter(uncertain=>!uncertain).length,1,'Invalid publishers must not claim confirmed approval');
  const beforeSessionChange=[...stale];
  currentSession = {token:'different-synthetic-session'};
  await assert.rejects(approve(task, 2), /sesión cambió/);
  assert.equal(requests.length, 1);
  assert.deepEqual(stale,beforeSessionChange);
});

test("source contract: existing unsaved, keyboard, focus and mobile behavior remains", () => {
  assert.match(source, /isNewTaskDraftDirty\(draft\) && !window.confirm/);
  assert.match(source, /<DiscardChangesDialog open=\{discardDialogOpen\} busy=\{taskWriteBusy\}/);
  assert.match(source, /previousFocus\?\.isConnected/);
  assert.match(source, /event.key === "Escape"/);
  assert.match(source, /useMediaQuery\(/);
});

test("PATCH sends the snapshot revision, retries use refreshed revision, creation has no revision guard", () => {
  const update = section("  const updateTask =", "  const createTask =");
  assert.match(update, /expected_revision: previous.revision, expected_updated_at: previous.updated_at/);
  assert.match(update, /expected_revision: currentTask.revision, expected_updated_at: currentTask.updated_at/);
  const create = section("  const createTask =", "  const registerProduction = async (task,");
  assert.doesNotMatch(create, /expected_revision/);
  const modal = section("function NewTaskModal", "function TaskCard");
  assert.doesNotMatch(modal, /expected_revision/);
});
