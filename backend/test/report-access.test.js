import test from "node:test";
import assert from "node:assert/strict";
import { filterReportDataForUser, summarizeRenderOsByDay } from "../src/report-access.js";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const data = {
  tareas: [
    { id: 1, asignado_a: "Augusto" },
    { id: 2, asignado_a: "Luciano" },
  ],
  tareasRenderOs: [
    { id: 3, asignado_a: "Germán" },
    { id: 4, asignado_a: "Augusto" },
  ],
  historias: [{ id: 5, estado: "publicada" }],
  publicaciones: [
    { id: 6, cliente_id: 10, tipo: "carrusel" },
    { id: 7, cliente_id: 11, tipo: "carrusel" },
    { id: 8, cliente_id: 10, tipo: "video" },
  ],
  clientes: [
    { id: 10, nombre: "Luzin" },
    { id: 11, nombre: "Moketa" },
  ],
  usuarios: [
    { id: 1, nombre: "Augusto", rol: "diseno" },
    { id: 2, nombre: "Germán", rol: "produccion" },
  ],
};

test("el reporte de un diseñador contiene solo sus carruseles", () => {
  const result = filterReportDataForUser(data, { nombre: "Augusto Aguirre", rol: "diseno" });
  assert.deepEqual(result.tareas.map((item) => item.id), [1]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [7]);
  assert.deepEqual(result.historias, []);
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [4]);
  assert.deepEqual(result.usuarios.map((item) => item.id), [1]);
});

test("producción recibe únicamente sus tareas RENDER OS", () => {
  const result = filterReportDataForUser(data, { nombre: "Germán Beltzer", rol: "produccion" });
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [3]);
  assert.deepEqual(result.publicaciones, []);
  assert.deepEqual(result.historias, []);
});

test("community conserva métricas globales de publicación sin usuarios ajenos", () => {
  const result = filterReportDataForUser(data, { nombre: "Oriana", rol: "community" });
  assert.deepEqual(result.historias.map((item) => item.id), [5]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [6, 7, 8]);
  assert.deepEqual(result.usuarios, []);
  assert.deepEqual(result.tareasRenderOs, []);
});

test("el administrador conserva el reporte completo", () => {
  const result = filterReportDataForUser(data, { rol: "admin" });
  assert.deepEqual(result.tareasRenderOs, data.tareasRenderOs);
});

test("el resumen compartido expone solo totales diarios y no detalles de tareas", () => {
  const result = summarizeRenderOsByDay([
    { titulo: "Carrusel 1", estado: "publicada", fecha_vencimiento: "2026-08-06", propiedades_extra: {} },
    { titulo: "Video 1", estado: "pendiente", fecha_vencimiento: "2026-08-07", propiedades_extra: {} },
    { titulo: "Editar video", tipo_tarea: "edicion", estado: "publicada", fecha_vencimiento: "2026-08-07", propiedades_extra: {} },
    { titulo: "Carrusel archivado", estado: "publicada", fecha_vencimiento: "2026-08-08", propiedades_extra: { archivada_render_os: true } },
  ]);
  assert.deepEqual(result, {
    "2026-08-06": { carruseles: { total: 1, publicadas: 1 } },
    "2026-08-07": {
      reels_planificados: { total: 1, publicadas: 0 },
      ediciones: { total: 1, publicadas: 1 },
    },
  });
  assert.equal(JSON.stringify(result).includes("Carrusel 1"), false);
});

test("el reporte obtiene la cuota compartida desde grupos_feed", () => {
  assert.match(serverSource, /gf\.cuota_carruseles AS cuota_feed_carruseles/);
  assert.match(serverSource, /LEFT JOIN grupos_feed gf ON gf\.id=c\.grupo_feed_id/);
  assert.doesNotMatch(serverSource, /SELECT id,nombre,cuota_carruseles,cuota_feed_carruseles,grupo_feed_id FROM clientes/);
});
