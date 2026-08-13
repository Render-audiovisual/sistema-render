import assert from "node:assert/strict";
import test from "node:test";

import { canRecordProduction, getProductionPhase, getProductionProgress, isProductionVisitTask, isValidProductionDate, nextProductionPeriod } from "../src/production-visits.js";
import { getProductionPhase as getFrontendProductionPhase, getProductionVisitProgress, groupProductionByClient } from "../../frontend/src/features/render-os/utils/production-visits.js";

test("limita el seguimiento a tareas de visitas de producción", () => {
  assert.equal(isProductionVisitTask({ titulo: "Luzin | Visita producción", tipo_tarea: "produccion" }), true);
  assert.equal(isProductionVisitTask({ titulo: "Grabar reel", tipo_tarea: "produccion" }), false);
  assert.equal(isProductionVisitTask({ titulo: "Visita producción", tipo_tarea: "edicion" }), false);
});

test("calcula el avance parcial sin dar por finalizada la visita", () => {
  const task = {
    titulo: "Visita producción",
    tipo_tarea: "produccion",
    propiedades_extra: {
      produccion_videos_previstos: 7,
      produccion_registros: [{ cantidad: 3, fecha: "2026-08-05" }],
    },
  };
  assert.deepEqual(getProductionProgress(task), { planned: 7, recorded: 3, remaining: 4 });
  assert.deepEqual(getProductionVisitProgress(task), { planned: 7, recorded: 3, remaining: 4, complete: false });
});

test("separa los videos por mes y normaliza los nombres de clientes", () => {
  const tasks = [
    {
      titulo: "Visita Luzin",
      tipo_tarea: "produccion",
      cliente_nombre: "Lucin",
      propiedades_extra: {
        produccion_videos_previstos: 4,
        produccion_registros: [
          { cantidad: 3, fecha: "2026-08-30" },
          { cantidad: 1, fecha: "2026-09-02" },
        ],
      },
    },
    {
      titulo: "Editar video",
      tipo_tarea: "edicion",
      cliente_nombre: "Luzin",
      propiedades_extra: { produccion_registros: [{ cantidad: 20, fecha: "2026-08-10" }] },
    },
  ];
  const august = groupProductionByClient(tasks, "2026-08-01", "2026-09-01");
  const september = groupProductionByClient(tasks, "2026-09-01", "2026-10-01");
  assert.deepEqual(august.find((item) => item.nombre === "Luzin"), { nombre: "Luzin", objetivo: 8, grabados: 3, pendientes: 5 });
  assert.deepEqual(september.find((item) => item.nombre === "Luzin"), { nombre: "Luzin", objetivo: 8, grabados: 1, pendientes: 7 });
  assert.equal(august.reduce((total, item) => total + item.objetivo, 0), 40);
});

test("solo Germán y el rol Líder pueden registrar grabaciones", () => {
  assert.equal(canRecordProduction({ rol: "admin", nombre: "Agustín" }), true);
  assert.equal(canRecordProduction({ rol: "produccion", nombre: "Germán Beltzer" }), true);
  assert.equal(canRecordProduction({ rol: "produccion", nombre: "Otra persona" }), false);
  assert.equal(isValidProductionDate("2026-08-05"), true);
  assert.equal(isValidProductionDate("05/08/2026"), false);
  assert.equal(isValidProductionDate("2026-02-31"), false);
});

test("expone la fase operativa sin crear nuevos estados de base", () => {
  const visit = { titulo: "Visita producción", tipo_tarea: "produccion", estado: "en_progreso", propiedades_extra: { produccion_videos_previstos: 4, produccion_registros: [{ cantidad: 4 }] } };
  assert.equal(getProductionPhase(visit), "grabacion_completa");
  assert.deepEqual(getFrontendProductionPhase(visit), { id: "grabacion_completa", label: "Grabación completa" });
  assert.equal(getProductionPhase({ tipo_tarea: "edicion", estado: "pendiente" }), "edicion");
  assert.equal(nextProductionPeriod("2026-12-10"), "2027-01");
});

test("el adelanto se acredita solo al mes siguiente del mismo cliente", () => {
  const tasks = [{
    titulo: "Visita Luzin", tipo_tarea: "produccion", cliente_nombre: "Luzin",
    propiedades_extra: { produccion_videos_previstos: 7, produccion_registros: [{ cantidad: 8, fecha: "2026-08-20", periodo_objetivo: "2026-08", cantidad_mes_actual: 7, cantidad_adelanto: 1, periodo_adelanto: "2026-09" }] },
  }];
  assert.equal(groupProductionByClient(tasks, "2026-08-01", "2026-09-01").find((item) => item.nombre === "Luzin").grabados, 7);
  assert.equal(groupProductionByClient(tasks, "2026-09-01", "2026-10-01").find((item) => item.nombre === "Luzin").grabados, 1);
});
