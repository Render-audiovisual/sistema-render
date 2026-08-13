import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMiaDigest,
  buildMiaStatePendingMarker,
  classifyMiaTask,
  isMiaReportWindow,
  shouldSendImmediateMiaNotice,
} from "../src/mia-task-digest.js";

const task = (id, overrides = {}) => ({
  id, titulo: `Tarea ${id}`, estado: "pendiente", prioridad: "media",
  fecha_vencimiento: "2026-08-10", propiedades_extra: { workspace: "render_os" },
  ...overrides,
});

test("Mia excluye tareas históricas, publicadas y archivadas del resumen", () => {
  const result = buildMiaDigest([
    task(1, { propiedades_extra: {} }),
    task(2, { estado: "publicada" }),
    task(3, { estado: "archivada" }),
  ], { today: "2026-08-10" });
  assert.equal(result.text, "Todo está al día.");
});

test("Mia ordena el resumen por urgencia y limita el ruido", () => {
  const tasks = [
    task(4, { titulo: "Revisar", estado: "en_revision", fecha_vencimiento: "2026-08-20" }),
    task(2, { titulo: "Alta", prioridad: "alta", fecha_vencimiento: "2026-08-20" }),
    task(1, { titulo: "Vencida", fecha_vencimiento: "2026-08-09" }),
    task(3, { titulo: "Hoy" }),
  ];
  const result = buildMiaDigest(tasks, { today: "2026-08-10", maxItems: 3 });
  assert.deepEqual(result.items.map((item) => item.id), [1, 2, 3]);
  assert.equal(result.omitted, 1);
  assert.match(result.text, /Y 1 tarea más/);
});

test("Mia elimina duplicados incluso bajo carga", () => {
  const tasks = Array.from({ length: 10_000 }, (_, index) => task((index % 100) + 1));
  const result = buildMiaDigest(tasks, { today: "2026-08-10", maxItems: 20 });
  assert.equal(new Set(result.items.map((item) => item.id)).size, result.items.length);
  assert.equal(result.items.length, 20);
  assert.equal(result.omitted, 80);
});

test("Mia solo envía avisos inmediatos por alta prioridad o entrega próxima", () => {
  assert.equal(shouldSendImmediateMiaNotice(task(1, { prioridad: "alta", fecha_vencimiento: "2026-09-01" }), "2026-08-10"), true);
  assert.equal(shouldSendImmediateMiaNotice(task(2, { fecha_vencimiento: "2026-08-11" }), "2026-08-10"), true);
  assert.equal(shouldSendImmediateMiaNotice(task(3, { fecha_vencimiento: "2026-08-12" }), "2026-08-10"), false);
  assert.equal(shouldSendImmediateMiaNotice(task(4, { propiedades_extra: {} }), "2026-08-10"), false);
});

test("la ventana automática es lunes a sábado de 08:00 a 11:59 en Argentina", () => {
  assert.equal(isMiaReportWindow(new Date("2026-08-10T11:00:00Z")), true); // lunes 08:00
  assert.equal(isMiaReportWindow(new Date("2026-08-10T15:00:00Z")), false); // lunes 12:00
  assert.equal(isMiaReportWindow(new Date("2026-08-09T14:00:00Z")), false); // domingo
});

test("clasifica revisión sin depender de datos de otros módulos", () => {
  assert.deepEqual(classifyMiaTask(task(7, { estado: "en_revision", fecha_vencimiento: "2026-08-20" }), "2026-08-10"), { rank: 3, category: "Para revisar" });
});

test("Mia avisa solo inicio, revisión y publicación en el grupo correcto", () => {
  const base = task(8, { tipo_tarea: "produccion" });
  assert.equal(buildMiaStatePendingMarker({ ...base, estado: "pendiente" }, "en_progreso"), null);
  assert.equal(buildMiaStatePendingMarker({ ...base, estado: "programada" }, "en_revision"), null);
  assert.equal(buildMiaStatePendingMarker({ ...base, estado: "en_progreso" }, "pendiente")?.destino, "visitas");
  assert.equal(buildMiaStatePendingMarker({ ...base, estado: "en_revision" }, "en_progreso")?.destino, "render_brain");
  assert.equal(buildMiaStatePendingMarker({ ...base, estado: "publicada" }, "programada")?.destino, "comunicacion");
});
