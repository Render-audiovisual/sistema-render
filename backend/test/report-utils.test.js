import assert from "node:assert/strict";
import test from "node:test";

import { belongsToPerson, filterItemsByPeriod, formatPeriodDeadline, getClientCarouselTarget, getDesignerCarouselSummary, groupFilmingTasksByClient, isFilmingTask } from "../../frontend/src/shared/reports/report-utils.js";

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
