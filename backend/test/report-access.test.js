import test from "node:test";
import assert from "node:assert/strict";
import { filterReportDataForUser } from "../src/report-access.js";

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
});

test("el administrador conserva el reporte completo", () => {
  assert.equal(filterReportDataForUser(data, { rol: "admin" }), data);
});
