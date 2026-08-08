import assert from "node:assert/strict";
import test from "node:test";
import { DRIVE_ROOTS, normalizeDriveName, resolveDriveRoot } from "../src/google-drive.js";

test("normaliza nombres de clientes y carpetas sin depender de acentos", () => {
  assert.equal(normalizeDriveName("El Ángel Azul — Estudiantil"), "el angel azul estudiantil");
});

test("los carruseles de Augusto se dirigen exclusivamente a su Drive", () => {
  const result = resolveDriveRoot({ tipo_tarea: "diseño", subtipo: "carrusel", asignado_a: "Augusto Aguirre" });
  assert.equal(result.id, DRIVE_ROOTS.augusto);
  assert.equal(result.key, "augusto");
});

test("los diseños de Mariano se dirigen exclusivamente a su Drive", () => {
  const result = resolveDriveRoot({ titulo: "Flyer del mes", tipo_tarea: "diseño", asignado_a: "Mariano Mesa" });
  assert.equal(result.id, DRIVE_ROOTS.mariano);
  assert.equal(result.key, "mariano");
});

test("foto, video y destinos no inequívocos usan RENDER_UPLOADS", () => {
  const result = resolveDriveRoot({ tipo_tarea: "produccion", asignado_a: "Germán" });
  assert.equal(result.id, DRIVE_ROOTS.general);
  assert.equal(result.child, "RENDER_UPLOADS");
});

