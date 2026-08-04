import assert from "node:assert/strict";
import test from "node:test";
import { areaForTask, formatDate, initials, personForTask } from "../../frontend/src/features/render-os/utils/task-formatters.js";

test("los formateadores puros de RENDER OS conservan sus resultados", () => {
  assert.equal(areaForTask({ titulo: "Landing institucional" }), "web");
  assert.equal(areaForTask({ titulo: "Pieza", tipo_tarea: "diseno" }), "carruseles");
  assert.equal(formatDate("2026-08-03"), "03/08/2026");
  assert.equal(formatDate(null), "Sin fecha");
  assert.equal(initials("Render Audiovisual"), "RA");
  assert.deepEqual(
    personForTask({ asignado_a: "AGUSTÍN" }, [{ id: 7, nombre: "Agustín", usuario: "agus" }]),
    { id: 7, nombre: "Agustín", usuario: "agus" },
  );
});
