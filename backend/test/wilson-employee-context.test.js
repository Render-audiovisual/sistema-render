import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEmployeeReminder,
  buildEmployeeSnapshot,
  buildEmployeeStatusReply,
  shouldUsePreviousTarget,
} from "../src/wilson-chat.js";

test("Wilson responde cuánto registró Germán y en qué clientes", () => {
  const snapshot = buildEmployeeSnapshot([
    { id: 1, titulo: "Visita Bohle", cliente_nombre: "Bohle", tipo_tarea: "produccion", estado: "en_progreso", fecha_vencimiento: "2026-08-10", propiedades_extra: { produccion_registros: [{ cantidad: 4, fecha: "2026-08-10" }] } },
    { id: 2, titulo: "Visita Luzin", cliente_nombre: "Luzin", tipo_tarea: "produccion", estado: "en_revision", fecha_vencimiento: "2026-08-12", propiedades_extra: { produccion_registros: [{ cantidad: 3, periodo_objetivo: "2026-08" }] } },
  ], { id: 2, nombre: "Germán", usuario: "German", rol: "produccion" }, "2026-08");
  const reply = buildEmployeeStatusReply(snapshot, "¿Germán registró los videos?");
  assert.match(reply.text, /registró 7 videos/i);
  assert.match(reply.text, /Bohle: 4/);
  assert.match(reply.text, /Luzin: 3/);
});

test("Wilson informa claramente cuando Germán no registró nada", () => {
  const snapshot = buildEmployeeSnapshot([
    { id: 1, titulo: "Visita Bohle", tipo_tarea: "produccion", estado: "pendiente", fecha_vencimiento: "2026-08-10", propiedades_extra: {} },
  ], { id: 2, nombre: "Germán", rol: "produccion" }, "2026-08");
  assert.match(buildEmployeeStatusReply(snapshot, "¿registró algo?").text, /todavía no registró videos/i);
});

test("cada especialidad recibe métricas propias", () => {
  const tasks = [
    { titulo: "Carrusel 1", tipo_tarea: "diseno", estado: "pendiente", fecha_vencimiento: "2026-08-10", propiedades_extra: {} },
    { titulo: "Carrusel 2", tipo_tarea: "diseno", estado: "en_revision", fecha_vencimiento: "2026-08-12", propiedades_extra: {} },
    { titulo: "Flyer", tipo_tarea: "diseno", estado: "pendiente", fecha_vencimiento: "2026-08-12", propiedades_extra: {} },
  ];
  const snapshot = buildEmployeeSnapshot(tasks, { nombre: "Augusto", rol: "diseno" }, "2026-08");
  const reply = buildEmployeeStatusReply(snapshot, "¿cómo viene?");
  assert.match(reply.text, /1 carrusel pendiente/i);
  assert.match(reply.text, /1 en revisión/i);
});

test("Wilson conserva el empleado cuando el Líder da una orden de seguimiento", () => {
  assert.equal(shouldUsePreviousTarget("Mandale un mensaje y pedile que reporte cuántos videos grabó"), true);
  assert.equal(shouldUsePreviousTarget("¿Qué hago ahora?"), false);
});

test("Wilson prepara para Germán un pedido específico de producción", () => {
  const reminder = buildEmployeeReminder({ nombre: "Germán", rol: "produccion" });
  assert.match(reminder, /Germán/i);
  assert.match(reminder, /cuántos videos grabaste/i);
  assert.match(reminder, /en qué clientes/i);
  assert.match(reminder, /reporte en el sistema/i);
});

for (const role of ["edicion", "diseno", "community", "admin", "produccion", "personal"]) {
  test(`Wilson distingue aprobación booleana de revisión sin completar ni mutar tareas: ${role}`, () => {
    const user = Object.freeze({ id: 77, nombre: "Persona QA", usuario: "qa_persona", rol: role });
    const type = role === "produccion" ? "produccion" : role === "diseno" ? "diseno" : "edicion";
    const states = [
      ["en_revision", { revision_aprobada: true }],
      ["en_revision", { revision_aprobada: "true" }],
      ["en_revision", { revision_aprobada: false }],
      ["en_revision", {}],
      ["en_revision", { revision_aprobada: "false" }],
      ["aprobada", {}],
      ["finalizada", { revision_aprobada: true }],
      ["publicada", { revision_aprobada: true }],
      ["pendiente", { revision_aprobada: true }],
    ];
    const tasks = Object.freeze(states.map(([estado, metadata], index) => Object.freeze({
      id: index + 1, revision: 4, titulo: `${role === "produccion" ? "Visita" : "Carrusel"} QA ${index + 1}`, tipo_tarea: type,
      estado, fecha_vencimiento: "2026-08-12", cliente_id: 88, cliente_nombre: "Cliente QA",
      propiedades_extra: Object.freeze({ workspace: "render_os", ...metadata }),
    })));
    const before = JSON.stringify({ tasks, user });
    const snapshot = buildEmployeeSnapshot(tasks, user, "2026-08");
    assert.strictEqual(snapshot.user, user);
    assert.deepEqual(snapshot.review.map(task => task.id), [2, 3, 4, 5]);
    assert.deepEqual(snapshot.approved.map(task => task.id), [1, 6]);
    assert.deepEqual(snapshot.completed.map(task => task.id), [7, 8]);
    assert.deepEqual(snapshot.pending.map(task => task.id), role === "community" ? [] : [9]);
    for (const collection of [snapshot.tasks, snapshot.review, snapshot.approved, snapshot.completed, snapshot.pending]) {
      for (const task of collection) assert.strictEqual(task, tasks[task.id - 1]);
    }
    assert.equal(snapshot.videosRecorded, 0);
    assert.deepEqual(snapshot.productionRecords, []);

    const reply = buildEmployeeStatusReply(snapshot, "¿Cómo viene?");
    if (role === "community") assert.match(reply.text, /6 tareas para revisar o finalizar y 2 finalizadas/);
    else {
      assert.match(reply.text, /4 (?:siguen )?en revisión/);
      assert.match(reply.text, /2 aprobad[ao]s/);
      if (role === "produccion") assert.match(reply.text, /0 videos registrados/);
      else assert.match(reply.text, /2 finalizad[ao]s/);
      if (role === "edicion") assert.match(reply.text, /8 entregadas/);
    }
    const expectedReplyIds = role === "produccion" ? [9]
      : role === "diseno" ? [2, 3, 4, 5, 9]
        : role === "community" ? [2, 3, 4, 5, 1, 6] : [2, 3, 4, 5, 1, 6, 9];
    assert.deepEqual(reply.tasks.map(task => task.id), expectedReplyIds);
    assert.equal(new Set(reply.tasks.map(task => task.id)).size, reply.tasks.length,
      "La misma aprobación histórica no debe figurar también en revisión");
    for (const task of reply.tasks) assert.strictEqual(task, tasks[task.id - 1]);

    const approvedOnly = buildEmployeeSnapshot(Object.freeze([tasks[0]]), user, "2026-08");
    assert.deepEqual(approvedOnly.completed, []);
    assert.equal(approvedOnly.videosRecorded, 0);
    assert.deepEqual(approvedOnly.productionRecords, []);
    assert.equal(JSON.stringify({ tasks, user }), before);
  });
}
