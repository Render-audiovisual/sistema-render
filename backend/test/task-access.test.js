import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskAccessClause, buildTaskReadAccessClause, canEmployeePatchTask, getTaskActor } from "../src/task-access.js";

test("el administrador conserva acceso global a tareas", () => {
  assert.deepEqual(buildTaskAccessClause({ rol: "admin", nombre: "Líder" }, "t", "$1"), { sql: "", value: null });
});

test("el empleado queda limitado a tareas propias o colaboraciones", () => {
  const access = buildTaskAccessClause({ rol: "produccion", nombre: "Germán" }, "t", "$3");
  assert.equal(access.value, "Germán");
  assert.match(access.sql, /t\.asignado_a/);
  assert.match(access.sql, /colaboradores/);
  assert.match(access.sql, /translate\(lower/);
});

test("todo usuario autenticado puede consultar el tablero compartido de RENDER OS", () => {
  assert.deepEqual(
    buildTaskReadAccessClause({ rol: "diseno", nombre: "Leo Aragon" }, "t", "$3", "render_os"),
    { sql: "", value: null },
  );
  const historicalAccess = buildTaskReadAccessClause(
    { rol: "diseno", nombre: "Leo Aragon" },
    "t",
    "$3",
    "historical",
  );
  assert.equal(historicalAccess.value, "Leo Aragon");
  assert.match(historicalAccess.sql, /t\.asignado_a/);
});

test("la identidad de tareas usa el nombre firmado y admite usuario como respaldo", () => {
  assert.equal(getTaskActor({ nombre: " Germán ", usuario: "German" }), "Germán");
  assert.equal(getTaskActor({ usuario: "Mariano" }), "Mariano");
});

test("un empleado solo puede cambiar estado con control de concurrencia", () => {
  assert.equal(canEmployeePatchTask({ estado: "en_progreso", expected_updated_at: "2026-08-04T10:00:00Z" }), true);
  assert.equal(canEmployeePatchTask({ titulo: "No autorizado" }), false);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { archivada_render_os: true } }), false);
});

test("producción conserva únicamente la coordinación de sus tareas históricas", () => {
  assert.equal(canEmployeePatchTask({ propiedades_extra: { horario: "10:00", coordinada: true } }, { workspace: "historical", role: "produccion" }), true);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { archivada_render_os: true } }, { workspace: "historical", role: "produccion" }), false);
  assert.equal(canEmployeePatchTask({ propiedades_extra: { horario: "10:00" } }, { workspace: "render_os", role: "produccion" }), false);
});
