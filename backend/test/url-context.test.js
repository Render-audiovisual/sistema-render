import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextUrl,
  formatMonthContext,
  readMonthContext,
  readUrlContext,
} from "../../frontend/src/shared/navigation/url-context.js";

test("el contexto conserva ruta, filtros existentes y enlace directo", () => {
  assert.equal(
    buildContextUrl("https://render.local/planificacion-publicaciones?task=8&tab=lista", {
      tab: "planilla",
      cliente: 4,
    }),
    "/planificacion-publicaciones?task=8&tab=planilla&cliente=4",
  );
});

test("el contexto admite valores por defecto y elimina parámetros vacíos", () => {
  assert.deepEqual(readUrlContext("?periodo=ultimos_30", { periodo: "mes_actual", cliente: "" }), {
    periodo: "ultimos_30",
    cliente: "",
  });
  assert.equal(buildContextUrl("/clientes?cliente=9", { cliente: null }), "/clientes");
});

test("el mes de contexto se valida antes de restaurarse", () => {
  assert.deepEqual(readMonthContext("2026-08", 2025, 0), { year: 2026, month: 7 });
  assert.deepEqual(readMonthContext("2026-19", 2025, 0), { year: 2025, month: 0 });
  assert.equal(formatMonthContext(2026, 7), "2026-08");
});
