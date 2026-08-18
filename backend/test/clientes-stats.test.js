import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularCuotaHistoriasPorDias,
  getResumenClientes,
  getTotalesCartera,
} from "../../frontend/src/clientesStats.js";

test("calcula la cuota mensual según los días semanales contratados", () => {
  assert.equal(calcularCuotaHistoriasPorDias([1, 3, 5], "2026-08"), 13);
  assert.equal(calcularCuotaHistoriasPorDias([], "2026-08"), 0);
});

test("separa planificación de publicación para el mes elegido", () => {
  const clientes = [{ id: 1, activo: true, dias_historias: [1], cuota_reels: 2, cuota_carruseles: 1 }];
  const historias = [
    { cliente_id: 1, fecha_programada: "2026-08-03", estado: "publicada" },
    { cliente_id: 1, fecha_programada: "2026-08-10", estado: "pendiente" },
    { cliente_id: 1, fecha_programada: "2026-07-06", estado: "publicada" },
  ];
  const [fila] = getResumenClientes(clientes, historias, [], { mes: "2026-08", avanceDelMes: 0.5 });
  assert.equal(fila.cuotaHistorias, 5);
  assert.equal(fila.historiasMes, 2);
  assert.equal(fila.historiasPublicadas, 1);
  assert.equal(fila.porcentajePlanificacionHistorias, 40);
  assert.equal(fila.porcentajeHistorias, 20);
});

test("excluye inactivos y no duplica un feed compartido", () => {
  const totales = getTotalesCartera([
    { id: 1, activo: true, grupo_feed_id: 7, cuotaHistorias: 5, cuota_feed_reels: 8, cuota_feed_carruseles: 2, historiasMes: 5, historiasPublicadas: 3, reelsPublicados: 4, carruselesPublicados: 1 },
    { id: 2, activo: true, grupo_feed_id: 7, cuotaHistorias: 4, cuota_feed_reels: 8, cuota_feed_carruseles: 2, historiasMes: 4, historiasPublicadas: 2, reelsPublicados: 4, carruselesPublicados: 1 },
    { id: 3, activo: false, cuotaHistorias: 20, cuota_reels: 10, cuota_carruseles: 5, historiasMes: 20, historiasPublicadas: 20, reelsPublicados: 10, carruselesPublicados: 5 },
  ]);
  assert.equal(totales.clientesActivos, 2);
  assert.equal(totales.cuotaHistorias, 9);
  assert.equal(totales.cuotaReels, 8);
  assert.equal(totales.reelsPublicados, 4);
  assert.equal(totales.piezasContratadas, 19);
});

test("el estado general considera reels y carruseles aunque no haya historias", () => {
  const clientes = [{
    id: 1,
    activo: true,
    dias_historias: [],
    cuota_reels: 4,
    cuota_carruseles: 4,
  }];
  const publicaciones = [
    { cliente_id: 1, fecha_programada: "2026-08-03", estado: "publicada", tipo: "reel" },
    { cliente_id: 1, fecha_programada: "2026-08-10", estado: "pendiente", tipo: "carrusel" },
  ];
  const [fila] = getResumenClientes(clientes, [], publicaciones, {
    mes: "2026-08",
    avanceDelMes: 0.5,
  });

  assert.equal(fila.estadoHistorias.label, "No incluido");
  assert.equal(fila.estadoGeneral.label, "Necesita seguimiento");
  assert.equal(fila.cuotaTotal, 8);
  assert.equal(fila.piezasPlanificadas, 2);
  assert.equal(fila.piezasPublicadas, 1);
  assert.equal(fila.porcentajeGeneral, 13);
});
