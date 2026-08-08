import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalTaskContentMetadata, getUnifiedTaskContent } from "../../frontend/src/features/render-os/utils/task-content.js";

test("une indicaciones, guion y copy una sola vez", () => {
  const task = {
    aclaraciones: "Objetivo de la tarea",
    propiedades_extra: { guiones: "Guion principal", copy_trabajo: "Copy final" },
  };
  assert.equal(getUnifiedTaskContent(task), "Objetivo de la tarea\n\nGuion principal\n\nCopy final");
});

test("no repite campos antiguos cuando ya están dentro del contenido canónico", () => {
  const task = {
    aclaraciones: "Guion principal\n\nCopy final\n\nNueva indicación",
    propiedades_extra: { guiones: "Guion principal", copy_trabajo: "Copy final" },
  };
  assert.equal(getUnifiedTaskContent(task), "Guion principal\n\nCopy final\n\nNueva indicación");
});

test("la canonicalización conserva otros metadatos y limpia copias antiguas", () => {
  assert.deepEqual(
    getCanonicalTaskContentMetadata({ resumen: "Entrega", guiones: "Viejo", copy_trabajo: "Viejo" }),
    { resumen: "Entrega", guiones: "", copy_trabajo: "" },
  );
});
