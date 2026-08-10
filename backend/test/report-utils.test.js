import assert from "node:assert/strict";
import test from "node:test";

import { belongsToPerson, filterItemsByPeriod, filterRenderOsTasksByPeriod, formatPeriodDeadline, getClientCarouselTarget, getDesignerCarouselSummary, getDesignerCarouselTaskSummary, groupFilmingTasksByClient, isCarouselTask, isEditingTask, isFilmingTask, isPlannedReelTask, summarizeTaskDeliveries } from "../../frontend/src/shared/reports/report-utils.js";

test("identifica filmaciones sin contar tareas de edición", () => {
  assert.equal(isFilmingTask({ tipo_tarea: "produccion", titulo: "Visita al local" }), true);
  assert.equal(isFilmingTask({ subtipo: "filmar", titulo: "Video Chevrolet" }), true);
  assert.equal(isFilmingTask({ tipo_tarea: "edicion", titulo: "Editar video Chevrolet" }), false);
});

test("agrupa los videos de Germán por cliente y separa grabados de pendientes", () => {
  const result = groupFilmingTasksByClient([
    { cliente_nombre: "Moketa", tipo_tarea: "produccion", estado: "publicada" },
    { cliente_nombre: "Moketa", subtipo: "filmar", estado: "pendiente" },
    { cliente_nombre: "Luzin", titulo: "Grabación en local", estado: "publicada" },
    { cliente_nombre: "Luzin", tipo_tarea: "edicion", titulo: "Editar video", estado: "publicada" },
  ]);

  assert.deepEqual(result, [
    { nombre: "Moketa", total: 2, grabados: 1, pendientes: 1 },
    { nombre: "Luzin", total: 1, grabados: 1, pendientes: 0 },
  ]);
});

test("reconoce a la misma persona aunque la tarea use nombre completo o no tenga acento", () => {
  assert.equal(belongsToPerson("Mariano Meza", "Mariano"), true);
  assert.equal(belongsToPerson("German", "Germán"), true);
  assert.equal(belongsToPerson("Luciano", "Augusto"), false);
});

test("los indicadores de piezas respetan el período elegido", () => {
  const result = filterItemsByPeriod(
    [
      { id: 1, fecha_programada: "2026-08-04" },
      { id: 2, fecha_programada: "2026-07-31" },
      { id: 3, fecha_programada: null },
    ],
    (fecha) => fecha >= "2026-08-01" && fecha < "2026-09-01",
  );
  assert.deepEqual(result.map((item) => item.id), [1]);
});

test("reparte la cuota compartida de Lavalle entre Mariano y Augusto", () => {
  const clients = [
    { id: 1, nombre: "Lavalle Market", grupo_feed_id: 7, cuota_feed_carruseles: 4 },
    { id: 2, nombre: "Lavalle Hortícola", grupo_feed_id: 7, cuota_feed_carruseles: 4 },
  ];
  assert.equal(getClientCarouselTarget(clients[0], clients), 2);
  assert.equal(getClientCarouselTarget(clients[1], clients), 2);
});

test("calcula los carruseles de cada diseñador desde clientes, cuotas y publicaciones", () => {
  const clients = [
    { id: 1, nombre: "iPhone Shop", cuota_carruseles: 3 },
    { id: 2, nombre: "RPM Chevrolet", cuota_carruseles: 2 },
    { id: 3, nombre: "Bendita", cuota_carruseles: 4 },
    { id: 4, nombre: "Lavalle Market", grupo_feed_id: 7, cuota_feed_carruseles: 4 },
    { id: 5, nombre: "Lavalle Hortícola", grupo_feed_id: 7, cuota_feed_carruseles: 4 },
  ];
  const publications = [
    { cliente_id: 1, tipo: "carrusel", estado: "publicada" },
    { cliente_id: 2, tipo: "carrusel", estado: "pendiente" },
    { cliente_id: 3, tipo: "carrusel", estado: "publicada" },
    { cliente_id: 4, tipo: "carrusel", estado: "publicada" },
    { cliente_id: 5, tipo: "carrusel", estado: "publicada" },
    { cliente_id: 1, tipo: "video", estado: "publicada" },
  ];
  assert.deepEqual(getDesignerCarouselSummary("Mariano", clients, publications), {
    realizados: 2,
    pendientes: 5,
    total: 7,
  });
  assert.deepEqual(getDesignerCarouselSummary("Augusto", clients, publications), {
    realizados: 2,
    pendientes: 4,
    total: 6,
  });
});

test("reconoce Cristal Joyerias como cliente de Mariano y calcula el cierre mensual", () => {
  const clients = [{ id: 9, nombre: "Cristal Joyerias", cuota_carruseles: 4 }];
  assert.deepEqual(getDesignerCarouselSummary("Mariano", clients, []), {
    realizados: 0,
    pendientes: 4,
    total: 4,
  });
  assert.equal(formatPeriodDeadline("2026-09-01"), "31 de agosto");
});

test("clasifica las tareas operativas de RENDER OS sin mezclar planificación y edición", () => {
  assert.equal(isCarouselTask({ titulo: "Carrusel 1", tipo_tarea: "diseno" }), true);
  assert.equal(isEditingTask({ titulo: "Luzin | Edición reel", tipo_tarea: "edicion" }), true);
  assert.equal(isPlannedReelTask({ titulo: "Video 1" }), true);
  assert.equal(isPlannedReelTask({ titulo: "Editar video", tipo_tarea: "edicion" }), false);
});

test("el reporte mensual usa tareas RENDER OS activas del período", () => {
  const inAugust = (date) => date >= "2026-08-01" && date < "2026-09-01";
  const result = filterRenderOsTasksByPeriod([
    { id: 1, fecha_vencimiento: "2026-08-06", propiedades_extra: {} },
    { id: 2, fecha_vencimiento: "2026-07-31", propiedades_extra: {} },
    { id: 3, fecha_vencimiento: "2026-08-07", propiedades_extra: { archivada_render_os: true } },
  ], inAugust);
  assert.deepEqual(result.map((task) => task.id), [1]);
});

test("cuenta carruseles publicados desde RENDER OS para cada diseñador", () => {
  const clients = [
    { id: 1, nombre: "RPM Chevrolet", cuota_carruseles: 2 },
    { id: 2, nombre: "Bendita", cuota_carruseles: 3 },
  ];
  const tasks = [
    { titulo: "Carrusel 1", cliente_nombre: "RPM Chevrolet", asignado_a: "Mariano Meza", estado: "publicada" },
    { titulo: "Carrusel 1", cliente_nombre: "Bendita", asignado_a: "Augusto", estado: "publicada" },
    { titulo: "Carrusel 2", cliente_nombre: "Bendita", asignado_a: "Augusto", estado: "pendiente" },
  ];
  assert.deepEqual(getDesignerCarouselTaskSummary("Mariano", clients, tasks), { realizados: 1, pendientes: 1, total: 2 });
  assert.deepEqual(getDesignerCarouselTaskSummary("Augusto", clients, tasks), { realizados: 1, pendientes: 2, total: 3 });
  assert.deepEqual(summarizeTaskDeliveries(tasks), { realizados: 2, pendientes: 1, total: 3 });
});
