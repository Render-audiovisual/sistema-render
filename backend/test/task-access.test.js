import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskAccessClause, buildTaskReadAccessClause, canEmployeePatchTask, getTaskActor, getTaskActorAliases } from "../src/task-access.js";

test("el administrador conserva acceso global a tareas", () => {
  assert.deepEqual(buildTaskAccessClause({ rol: "admin", nombre: "Líder" }, "t", "$1"), { sql: "", value: null });
});

test("el empleado queda limitado a tareas propias o colaboraciones", () => {
  const access = buildTaskAccessClause({ id: 7, rol: "produccion", nombre: "Germán" }, "t", "$3");
  assert.equal(access.value, 7);
  assert.match(access.sql, /tarea_asignaciones/);
  assert.match(access.sql, /ta\.usuario_id = \$3::integer/);
  assert.doesNotMatch(access.sql, /nombre|asignado_a|colaboradores|translate/);
});

test("todo usuario autenticado puede consultar el tablero compartido de RENDER OS", () => {
  assert.deepEqual(
    buildTaskReadAccessClause({ rol: "diseno", nombre: "Leo Aragon" }, "t", "$3", "render_os"),
    { sql: "", value: null },
  );
  const historicalAccess = buildTaskReadAccessClause(
    { id: 8, rol: "diseno", nombre: "Leo Aragon" },
    "t",
    "$3",
    "historical",
  );
  assert.equal(historicalAccess.value, 8);
  assert.match(historicalAccess.sql, /ta\.tarea_id = t\.id/);
});

test("la identidad de tareas usa el nombre firmado y admite usuario como respaldo", () => {
  assert.equal(getTaskActor({ nombre: " Germán ", usuario: "German" }), "Germán");
  assert.equal(getTaskActor({ usuario: "Mariano" }), "Mariano");
  assert.deepEqual(getTaskActorAliases({ nombre: "Mariano Meza", usuario: "Mariano" }), ["Mariano Meza", "Mariano"]);
});

test("cambiar el nombre no cambia la autoridad y carecer de ID nunca autoriza", () => {
  const access = buildTaskAccessClause({ id: 8, rol: "diseno", nombre: "Mariano Meza", usuario: "Mariano" }, "t", "$2");
  assert.deepEqual(access, buildTaskAccessClause({ id: 8, rol: "diseno", nombre: "Otro nombre" }, "t", "$2"));
  assert.deepEqual(buildTaskAccessClause({ rol: "diseno", nombre: "Mariano Meza" }, "t", "$2"), { sql: " AND FALSE", value: null });
});

test("un empleado puede editar los datos laborales de sus tareas de RENDER OS", () => {
  assert.equal(canEmployeePatchTask({ estado: "en_progreso", expected_updated_at: "2026-08-04T10:00:00Z" }, { workspace: "render_os", role: "diseno" }), true);
  assert.equal(canEmployeePatchTask({ titulo: "Título corregido", cliente_id: 12, prioridad: "alta" }, { workspace: "render_os", role: "diseno" }), true);
  assert.equal(canEmployeePatchTask({ asignado_a: "Augusto", propiedades_extra: { colaboradores: ["Oriana"] } }, { workspace: "render_os", role: "diseno" }), true);
  assert.equal(canEmployeePatchTask({ aclaraciones: "Nueva descripción", material_referencia: "https://drive.google.com/folder" }, { workspace: "render_os", role: "produccion" }), true);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { archivada_render_os: true } }, { workspace: "render_os", role: "diseno" }), false);
  assert.equal(canEmployeePatchTask({ publicacion_id: 20 }, { workspace: "render_os", role: "diseno" }), false);
});

test("producción conserva únicamente la coordinación de sus tareas históricas", () => {
  assert.equal(canEmployeePatchTask({ propiedades_extra: { horario: "10:00", coordinada: true } }, { workspace: "historical", role: "produccion" }), true);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { archivada_render_os: true } }, { workspace: "historical", role: "produccion" }), false);
  assert.equal(canEmployeePatchTask({ material_referencia: "https://drive.google.com/folder" }, { workspace: "render_os", role: "produccion" }), true);
  assert.equal(canEmployeePatchTask({ titulo: "Permitido" }, { workspace: "render_os", role: "produccion" }), true);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { horario: "10:00" }, expected_revision: 2 }, { workspace: "render_os", role: "produccion" }), true);
});

test('coordinación mantiene permisos por rol y admite revisión histórica sin ampliar otros campos', () => {
  const patch = { propiedades_extra: { horario: 'El martes por la tarde', coordinada: true }, expected_revision: 3 };
  assert.equal(canEmployeePatchTask(patch, { workspace: 'historical', role: 'produccion' }), true);
  for (const workspace of ['render_os', 'historical']) {
    for (const role of ['diseno', 'edicion', 'community', undefined]) {
      assert.equal(canEmployeePatchTask(patch, { workspace, role }), false);
    }
    assert.equal(canEmployeePatchTask({ ...patch, propiedades_extra: { ...patch.propiedades_extra, revision_aprobada: true } }, { workspace, role: 'produccion' }), false);
  }
  assert.equal(canEmployeePatchTask({ ...patch, titulo: 'No permitido' }, { workspace: 'historical', role: 'produccion' }), false);
});
