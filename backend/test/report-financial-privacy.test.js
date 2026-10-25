import test from "node:test";
import assert from "node:assert/strict";
import { filterReportDataForUser } from "../src/report-access.js";

const secret = "PRIVATE_FINANCIAL_SENTINEL";
function fixture() {
  const privateFields = { importe: secret, sueldo_base: secret, tarifa_facil: secret, costo: secret, future_finance: { amount: secret } };
  const task = {
    id: 1, titulo: "Carrusel", asignado_a: "Augusto", asignado_a_id: 6, colaborador_ids: [], cliente_id: 5, publicacion_id: 4, estado: "publicada",
    fecha_vencimiento: "2026-10-19", tipo_tarea: "edicion", ...privateFields,
    propiedades_extra: {
      ...privateFields, edicion_responsable: "Augusto", colaboradores: ["Augusto", { importe: secret }],
      reporte_periodo: "2026-10", revision_aprobada: true,
      produccion_registros: [{ cantidad: 3, fecha: "2026-10-19", ...privateFields }],
      produccion_videos_previstos: 4,
      // Even approved scalar names must not carry arbitrary JSON.
      clickup_lista: { importe: secret },
    },
  };
  return {
    tareas: [task, { ...task, id: 2, asignado_a: "Otro", asignado_a_id: 9, propiedades_extra: {} }],
    tareasRenderOs: [task],
    historias: [{ id: 3, estado: "publicada", ...privateFields }],
    publicaciones: [{ id: 4, cliente_id: 5, tipo: "carrusel", ...privateFields }],
    clientes: [{ id: 5, nombre: "Moketa", cuota_carruseles: 4, ...privateFields }],
    usuarios: [{ id: 6, nombre: "Augusto", ...privateFields }],
    entregasEdicion: [
      { id: 7, editor_clave: "Augusto", editor_id: 6, fecha_entrega: "2026-10-19", categoria: "facil", ...privateFields },
      { id: 8, editor_clave: "Otro", editor_id: 9, ...privateFields },
    ],
    finanzas: privateFields,
    resumenRenderOsPorDia: { importe: secret },
  };
}

for (const rol of ["admin","community", "diseno", "produccion", "edicion", "programacion", "unknown", undefined]) {
  test(`report role ${rol}: safe DTOs remove financial data without changing row visibility`, () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = filterReportDataForUser(input, { id: 6, rol, nombre: "Augusto" });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.deepEqual(Object.keys(result).sort(), ["tareas", "tareasRenderOs", "historias", "publicaciones", "clientes", "usuarios", "entregasEdicion", "resumenRenderOsPorDia"].sort());
    if (["unknown", undefined].includes(rol)) {
      for (const key of Object.keys(result)) assert.deepEqual(result[key], key === 'resumenRenderOsPorDia' ? {} : key === 'usuarios' ? [{ id: 6, nombre: 'Augusto' }] : []);
      assert.deepEqual(input, before);
      return;
    }
    assert.deepEqual(result.tareas.map((item) => item.id), [1,2]);
    assert.deepEqual(result.usuarios.map((item) => item.id), [6]);
    assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [1]);
    assert.deepEqual(result.historias.map((item) => item.id), [3]);
    assert.deepEqual(result.publicaciones.map((item) => item.id), [4]);
    assert.deepEqual(result.clientes.map((item) => item.id), [5]);
    assert.deepEqual(result.entregasEdicion.map((item) => item.id), [7,8]);
    assert.equal(result.entregasEdicion[0].categoria, "facil");
    assert.equal(Object.hasOwn(result.entregasEdicion[0], "importe"), false);
    assert.deepEqual(result.tareas[0].propiedades_extra, {
      edicion_responsable: "Augusto", reporte_periodo: "2026-10", revision_aprobada: true,
      colaboradores: ["Augusto"], produccion_videos_previstos: 4,
      produccion_registros: [{ cantidad: 3, fecha: "2026-10-19" }],
    });
    assert.deepEqual(result.resumenRenderOsPorDia, { "2026-10-19": { carruseles: { total: 1, publicadas: 1 } } });
    assert.deepEqual(input, before);
    result.tareas[0].propiedades_extra.produccion_registros[0].cantidad = 99;
    assert.deepEqual(input, before);
  });
}

test("owner report shares operational rows without private fields or raw nested JSON", () => {
  const input = fixture();
  const result = filterReportDataForUser(input, { id:6,rol: "admin" });
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual(result.tareas.map(row=>row.id),[1,2]);
  assert.equal(result.entregasEdicion.length,2);
});

test("missing identity does not gain personal rows or financial fields", () => {
  const result = filterReportDataForUser(fixture());
  assert.deepEqual(result.tareas, []);
  assert.deepEqual(result.tareasRenderOs, []);
  assert.deepEqual(result.entregasEdicion, []);
  assert.deepEqual(result.usuarios, []);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
