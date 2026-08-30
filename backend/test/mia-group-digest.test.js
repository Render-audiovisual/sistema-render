import assert from "node:assert/strict";
import test from "node:test";
import { buildMiaGroupDigests, miaGroupDigestWindow } from "../src/mia-group-digest.js";

const task = (id, overrides = {}) => ({
  id, titulo: `Carrusel ${id}`, estado: "pendiente", asignado_a: "Mariano Meza",
  prioridad: "media", tipo_tarea: "diseno", subtipo: "carrusel",
  fecha_vencimiento: "2026-08-31", cliente_nombre: "Luzin",
  propiedades_extra: { workspace: "render_os" }, ...overrides,
});

test("Mia informa el objetivo de carruseles de Luzin solo en Comunicación", () => {
  const digests = buildMiaGroupDigests([task(1), task(2), task(3), task(4)], { today: "2026-08-30" });
  assert.equal(digests.length, 1);
  assert.equal(digests[0].destination, "comunicacion");
  assert.match(digests[0].text, /Luzin · Mariano Meza: 0\/4 carruseles listos/);
  assert.equal(new Set(digests[0].task_ids).size, 4);
});

test("Mia cuenta Revisar como avance del diseñador", () => {
  const digests = buildMiaGroupDigests([
    task(1, { estado: "en_revision" }), task(2), task(3), task(4),
  ], { today: "2026-08-30" });
  assert.match(digests[0].text, /1\/4 carruseles listos/);
});

test("Mia separa Edición y calcula Visitas por videos registrados", () => {
  const digests = buildMiaGroupDigests([
    task(10, { titulo: "Editar reel", tipo_tarea: "edicion", subtipo: "video", asignado_a: "Luciano", cliente_nombre: "Búnker", estado: "en_revision" }),
    task(11, { titulo: "Editar video", tipo_tarea: "edicion", subtipo: "video", asignado_a: "Luciano", cliente_nombre: "Búnker" }),
    task(20, { titulo: "Visita producción", tipo_tarea: "produccion", subtipo: "visita", asignado_a: "Germán", cliente_nombre: "RPM Chevrolet", propiedades_extra: { workspace: "render_os", produccion_videos_previstos: 6, produccion_registros: [{ cantidad: 2 }] } }),
  ], { today: "2026-08-30" });
  assert.deepEqual(digests.map((digest) => digest.destination).sort(), ["edicion", "visitas"]);
  assert.match(digests.find((digest) => digest.destination === "edicion").text, /1\/2 ediciones listas/);
  assert.match(digests.find((digest) => digest.destination === "visitas").text, /2\/6 videos registrados/);
});

test("un problema transversal se informa una sola vez en Render Brain", () => {
  const digests = buildMiaGroupDigests([
    task(1, { cliente_nombre: "Luzin" }),
    task(2, { titulo: "Editar reel", tipo_tarea: "edicion", subtipo: "video", asignado_a: "Luciano", cliente_nombre: "Luzin" }),
  ], { today: "2026-08-30" });
  assert.equal(digests.length, 1);
  assert.equal(digests[0].destination, "render_brain");
  assert.equal(digests[0].clients.length, 1);
});

test("Mia no envía nada cuando los objetivos están al día", () => {
  const digests = buildMiaGroupDigests([
    task(1, { estado: "en_revision" }), task(2, { estado: "publicada" }),
  ], { today: "2026-08-30" });
  assert.deepEqual(digests, []);
});

test("Mia usa mañana, cierre semanal/mensual y tarde solo para críticos", () => {
  assert.deepEqual(miaGroupDigestWindow(new Date("2026-08-24T12:00:00Z")), { type: "diario", criticalOnly: false }); // 09:00 Argentina
  assert.deepEqual(miaGroupDigestWindow(new Date("2026-08-28T13:00:00Z")), { type: "semanal_mensual", criticalOnly: false }); // viernes 28, 10:00
  assert.deepEqual(miaGroupDigestWindow(new Date("2026-08-24T21:00:00Z")), { type: "control_tarde", criticalOnly: true }); // 18:00
  assert.equal(miaGroupDigestWindow(new Date("2026-08-24T19:00:00Z")), null);
});
