import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularCuotaHistoriasPorDias,
  getResumenClientes,
  getTotalesCartera,
} from "../../frontend/src/clientesStats.js";
import { isConfirmedPublication, isHistoricalPublication, confirmationDate, evidenceFromStatus,
  historicalPublicationDate } from '../../frontend/src/shared/editorial/publication-evidence.js';

function confirmed(item, occurred = '2026-08-03T12:00:00.000Z') {
  return { ...item, estado: 'publicada', 'fecha_publicación_real': occurred,
    publicacion_evidencia: { classification: 'confirmada_manualmente', revision: 1, confirmation: {
      id: '00000000-0000-4000-8000-000000000001', actor_id: 22, occurred_at: occurred,
      recorded_at: '2026-10-22T15:00:00.000Z', source: 'manual' } } };
}

test("calcula la cuota mensual según los días semanales contratados", () => {
  assert.equal(calcularCuotaHistoriasPorDias([1, 3, 5], "2026-08"), 13);
  assert.equal(calcularCuotaHistoriasPorDias([], "2026-08"), 0);
});

test("separa planificación de publicación para el mes elegido", () => {
  const clientes = [{ id: 1, activo: true, dias_historias: [1], cuota_reels: 2, cuota_carruseles: 1 }];
  const historias = [
    confirmed({ id: 1, cliente_id: 1, fecha_programada: "2026-08-03" }),
    { id: 2, cliente_id: 1, fecha_programada: "2026-08-10", estado: "pendiente" },
    confirmed({ id: 3, cliente_id: 1, fecha_programada: "2026-07-06" }, '2026-07-06T12:00:00.000Z'),
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
    confirmed({ id: 1, cliente_id: 1, fecha_programada: "2026-08-03", tipo: "reel" }),
    { id: 2, cliente_id: 1, fecha_programada: "2026-08-10", estado: "pendiente", tipo: "carrusel" },
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

test("las tareas finalizadas no acreditan publicación editorial vinculada ni independiente", () => {
  const clientes = [{ id: 1, activo: true, dias_historias: [], cuota_reels: 0, cuota_carruseles: 4 }];
  const publicaciones = [
    { id: 20, cliente_id: 1, fecha_programada: "2026-08-04", estado: "pendiente", tipo: "carrusel" },
  ];
  const tareas = [
    { id: 1, cliente_id: 1, fecha_vencimiento: "2026-08-04", estado: "publicada", titulo: "Carrusel uno", publicacion_id: 20 },
    { id: 2, cliente_id: 1, fecha_vencimiento: "2026-08-11", estado: "publicada", titulo: "Carrusel dos" },
  ];
  const [fila] = getResumenClientes(clientes, [], publicaciones, {
    mes: "2026-08",
    avanceDelMes: 0.5,
    tareas,
  });

  assert.equal(fila.carruselesPublicados, 0);
  assert.equal(fila.piezasPublicadas, 0);
  assert.equal(fila.piezasPlanificadas, 1);
  assert.equal(fila.porcentajeGeneral, 0);
});

test('strict evidence accepts only current manual proof with positive IDs and matching root ISO instant', () => {
  const item = confirmed({ id: 1, cliente_id: 1 });
  assert.equal(isConfirmedPublication(item), true);
  const event = item.publicacion_evidencia.confirmation;
  for (const change of [{ id: 0 }, { id: '1' }, { cliente_id: 0 }, { estado: 'aprobada' }, { estado: 'pendiente' },
    { fecha_publicación_real: '2026-08-03' }, { fecha_publicación_real: '2026-08-03 12:00' },
    { fecha_publicación_real: '2026-08-03T12:00:00.001Z' }, { publicacion_evidencia: null },
    { publicacion_evidencia: { ...item.publicacion_evidencia, revision: 0 } },
    { publicacion_evidencia: { ...item.publicacion_evidencia, classification: 'historica_sin_confirmacion' } }])
    assert.equal(isConfirmedPublication({ ...item, ...change }), false);
  for (const change of [{ id: 'not-uuid' }, { actor_id: '22' }, { actor_id: 0 }, { source: 'externa' },
    { occurred_at: '2026-02-30T12:00:00Z' }, { occurred_at: '2026-08-03T09:00:00-03:00' },
    { recorded_at: 'invalid' }, { recorded_at: '2026-10-22T15:00:00' }])
    assert.equal(isConfirmedPublication({ ...item, publicacion_evidencia: { ...item.publicacion_evidencia, confirmation: { ...event, ...change } } }), false);
  const inherited = Object.create(item);
  assert.equal(isConfirmedPublication(inherited), false);
  assert.equal(isConfirmedPublication({ id: 1, cliente_id: 1, estado: 'publicada', metadata: { publicacion_evidencia: item.publicacion_evidencia } }), false);
  assert.equal(isConfirmedPublication({ ...item, publicacion_evidencia: { ...item.publicacion_evidencia, confirmation: Object.create(event) } }), false);
});

test('legacy state/date/malformed evidence earns historical coverage but never confirmed publication', () => {
  const clients = [{ id: 1, activo: true, cuota_reels: 5, cuota_carruseles: 5, dias_historias: [] }];
  const stories = [{ id: 1, cliente_id: 1, fecha_programada: '2026-08-03', estado: 'publicada' }];
  const publications = [
    { id: 1, cliente_id: 1, fecha_programada: '2026-08-03', tipo: 'reel', estado: 'publicada', 'fecha_publicación_real': 'malformed' },
    { id: 2, cliente_id: 1, fecha_programada: '2026-08-03', tipo: 'carrusel', estado: 'pendiente', 'fecha_publicación_real': '2026-08-03T12:00:00Z' },
    { id: 3, cliente_id: 1, fecha_programada: '2026-08-03', tipo: 'reel', estado: 'pendiente', metadata: { publicada: true } },
  ];
  const [row] = getResumenClientes(clients, stories, publications, { mes: '2026-08', avanceDelMes: .5 });
  assert.equal(row.piezasPublicadas, 0); assert.equal(row.porcentajeGeneral, 0);
  assert.equal(row.historiasSinConfirmacion, 1); assert.equal(row.reelsSinConfirmacion, 1);
  assert.equal(row.carruselesSinConfirmacion, 1); assert.equal(row.totalSinConfirmacion, 3);
  assert.equal(row.piezasPublicadasEnMesReal, 0);
  assert.equal(isHistoricalPublication(publications[0]), true);
  assert.equal(isHistoricalPublication(publications[1]), true);
  assert.equal(isHistoricalPublication(publications[2]), false);
  assert.equal(confirmationDate(publications[1]), null);
});

test('confirmation calendar uses Córdoba boundary, not UTC month or scheduled cohort', () => {
  const client = { id: 1, activo: true, dias_historias: [], cuota_reels: 2 };
  const cross = confirmed({ id: 1, cliente_id: 1, tipo: 'reel', fecha_programada: '2026-09-01' }, '2026-09-01T02:59:59.999Z');
  const next = confirmed({ id: 2, cliente_id: 1, tipo: 'reel', fecha_programada: '2026-08-01' }, '2026-09-01T03:00:00.000Z');
  assert.equal(confirmationDate(cross), '2026-08-31'); assert.equal(confirmationDate(next), '2026-09-01');
  assert.equal(isConfirmedPublication({ ...cross, 'fecha_publicación_real': '2026-08-31T23:59:59.999-03:00' }), true);
  const [august] = getResumenClientes([client], [], [cross, next], { mes: '2026-08', avanceDelMes: .5 });
  assert.equal(august.reelsPublicados, 1, 'quota remains scheduled-month cohort');
  assert.equal(august.piezasPublicadasEnMesReal, 1, 'actual month independently credits the other piece');
  const [september] = getResumenClientes([client], [], [cross, next], { mes: '2026-09', avanceDelMes: .5 });
  assert.equal(september.reelsPublicados, 1); assert.equal(september.piezasPublicadasEnMesReal, 1);
});

test('stable piece/domain IDs and shared feeds deduplicate confirmed and historical coverage totals', () => {
  const clients = [1, 2].map(id => ({ id, activo: true, grupo_feed_id: 7, dias_historias: [], cuota_feed_reels: 4, cuota_feed_carruseles: 2 }));
  const story = confirmed({ id: 1, cliente_id: 1, fecha_programada: '2026-08-03' });
  const reel = confirmed({ id: 1, cliente_id: 2, tipo: 'reel', fecha_programada: '2026-08-03' });
  const legacy = { id: 2, cliente_id: 2, tipo: 'carrusel', fecha_programada: '2026-08-03', estado: 'publicada' };
  const rows = getResumenClientes(clients, [story, story], [reel, reel, legacy, legacy], { mes: '2026-08', avanceDelMes: .5 });
  assert.equal(rows[0].historiasPublicadas, 1); assert.equal(rows[1].historiasPublicadas, 0);
  assert.equal(rows[0].reelsPublicados, 1); assert.equal(rows[1].reelsPublicados, 1);
  const totals = getTotalesCartera(rows);
  assert.equal(totals.piezasPublicadas, 2); assert.equal(totals.piezasPublicadasEnMesReal, 2);
  assert.equal(totals.carruselesSinConfirmacion, 1); assert.equal(totals.totalSinConfirmacion, 1);
  const empty = getTotalesCartera([]);
  for (const key of ['historiasSinConfirmacion', 'reelsSinConfirmacion', 'carruselesSinConfirmacion', 'totalSinConfirmacion', 'piezasPublicadasEnMesReal']) assert.equal(empty[key], 0);
});

test('status adapter projects only the exact shared evidence field and rejects inconsistent proof', () => {
  const item = confirmed({ id: 1, cliente_id: 1 });
  const status = { piece: { id: 1, cliente_id: 1, dominio: 'historia', revision: 1, estado: 'publicada', fecha_publicacion_real: item['fecha_publicación_real'] },
    classification: 'confirmada_manualmente', current_confirmation: { ...item.publicacion_evidencia.confirmation, financial_sentinel: 999 } };
  assert.deepEqual(evidenceFromStatus(status), item.publicacion_evidencia);
  assert.equal(evidenceFromStatus({ ...status, piece: { ...status.piece, estado: 'lista' } }), null);
  assert.equal(evidenceFromStatus({ ...status, piece: { ...status.piece, id: '1' } }), null);
  assert.equal(evidenceFromStatus(null), null);
  assert.deepEqual(evidenceFromStatus({ ...status, classification: 'historica_sin_confirmacion', current_confirmation: null }),
    { classification: 'historica_sin_confirmacion', revision: 1, confirmation: null });
  assert.equal(historicalPublicationDate({ id: 1, estado: 'publicada', 'fecha_publicación_real': '2026-09-01T02:00:00Z' }), '2026-08-31');
  assert.equal(historicalPublicationDate({ id: 1, estado: 'publicada', 'fecha_publicación_real': '2026-02-30' }), null);
  assert.equal(historicalPublicationDate({ id: 1, estado: 'publicada', 'fecha_publicación_real': '2026-08-03 12:00' }), null);
});
