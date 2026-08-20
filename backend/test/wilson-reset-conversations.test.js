import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canResetWilsonConversations } from "../src/wilson-chat.js";

test("solo Líder puede restablecer todas las conversaciones de Wilson", () => {
  assert.equal(canResetWilsonConversations({ rol: "admin" }), true);
  for (const rol of ["diseno", "edicion", "produccion", "community", "programacion", undefined]) {
    assert.equal(canResetWilsonConversations({ rol }), false);
  }
});

test("el restablecimiento elimina conversaciones en cascada y conserva auditoría", () => {
  const source = fs.readFileSync(new URL("../src/wilson-chat.js", import.meta.url), "utf8");
  assert.match(source, /router\.delete\("\/conversaciones"/);
  assert.match(source, /DELETE FROM wilson_conversaciones RETURNING id/);
  assert.match(source, /restablecer_conversaciones/);
  assert.doesNotMatch(source, /DELETE FROM tareas/);
  assert.doesNotMatch(source, /DELETE FROM usuarios/);
});

test("la vista de Líder exige confirmación antes del borrado global", () => {
  const source = fs.readFileSync(new URL("../../frontend/src/pages/WilsonConversations.jsx", import.meta.url), "utf8");
  assert.match(source, /Restablecer conversaciones/);
  assert.match(source, /¿Restablecer todas las conversaciones\?/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /Las tareas, reportes y usuarios no cambiarán/);
});
