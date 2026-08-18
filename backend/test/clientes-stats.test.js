import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularPorcentajeCuota,
  getEstadoCuota,
  getResumenClientes,
  getTotalesCartera,
} from "../../frontend/src/clientesStats.js";

test("la cuota limita el porcentaje visual a 100", () => {
  assert.equal(calcularPorcentajeCuota(6, 4), 100);
  assert.equal(calcularPorcentajeCuota(2, 0), 0);
});

test("sin historias planificadas se informa como planificación faltante", () => {
  assert.deepEqual(
    getEstadoCuota({ cuota: 12, realizadas: 0, planificadas: 0, avanceDelMes: 0.5 }),
    { color: "rojo", label: "Sin planificación", tipo: "sin_planificacion" },
  );
});

test("el resumen usa la cuota contractual de historias y el mes elegido", () => {
  const clientes = [{ id: 1, nombre: "Cliente", cuota_historias: 4, cuota_reels: 2, cuota_carruseles: 1, estado_cliente: "activo" }];
  const historias = [
    { cliente_id: 1, fecha_programada: "2026-08-02", estado: "publicada" },
    { cliente_id: 1, fecha_programada: "2026-08-04", estado: "pendiente" },
    { cliente_id: 1, fecha_programada: "2026-07-04", estado: "publicada" },
  ];
  const publicaciones = [
    { cliente_id: 1, fecha_programada: "2026-08-05", estado: "publicada", tipo: "reel" },
  ];
  const [fila] = getResumenClientes(clientes, historias, publicaciones, { mes: "2026-08", avanceDelMes: 0.5 });
  assert.equal(fila.historiasMes, 2);
  assert.equal(fila.historiasPublicadas, 1);
  assert.equal(fila.porcentajePlanificacionHistorias, 50);
  assert.equal(fila.porcentajeHistorias, 25);
});

test("los totales excluyen pausados y no duplican un feed compartido", () => {
  const filas = [
    { id: 1, activo: true, grupo_feed_id: 7, cuota_historias: 4, cuota_feed_reels: 8, cuota_feed_carruseles: 2, historiasMes: 4, historiasPublicadas: 2, reelsPublicados: 3, carruselesPublicados: 1 },
    { id: 2, activo: true, grupo_feed_id: 7, cuota_historias: 4, cuota_feed_reels: 8, cuota_feed_carruseles: 2, historiasMes: 4, historiasPublicadas: 4, reelsPublicados: 3, carruselesPublicados: 1 },
    { id: 3, activo: false, cuota_historias: 20, cuota_reels: 10, cuota_carruseles: 5, historiasMes: 20, historiasPublicadas: 20, reelsPublicados: 10, carruselesPublicados: 5 },
  ];
  const totales = getTotalesCartera(filas);
  assert.equal(totales.clientesActivos, 2);
  assert.equal(totales.cuotaHistorias, 8);
  assert.equal(totales.cuotaReels, 8);
  assert.equal(totales.reelsPublicados, 3);
  assert.equal(totales.piezasContratadas, 18);
});
