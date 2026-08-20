import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployeeSnapshot, buildEmployeeStatusReply } from "../src/wilson-chat.js";

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
