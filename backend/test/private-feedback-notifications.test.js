import assert from "node:assert/strict";
import test from "node:test";
import { crearMensajePrivadoFeedback, encolarNotificacionPrivadaFeedback } from "../src/private-feedback-notifications.js";

test("builds a short private feedback message", () => {
  const result = crearMensajePrivadoFeedback({ nota: { id: 12, titulo: "Cambiar tono", feedback: { cliente: "Cristal", estado: "pendiente" } } });
  assert.match(result.text, /feedback nuevo/i);
  assert.match(result.text, /Cristal · Cambiar tono/);
  assert.match(result.url, /feedback\?section=clients&note=12/);
});

test("queues once per responsible and excludes the author", async () => {
  const inserts = [];
  const pool = { query: async (sql, params = []) => {
    if (sql.includes("SELECT usuario, nombre FROM usuarios")) return { rows: [
      { usuario: "oriana", nombre: "Oriana" }, { usuario: "ana", nombre: "Ana Mayerro" },
    ] };
    if (sql.includes("INSERT INTO mia_private_task_notifications")) { inserts.push(params); return { rows: [{ id: inserts.length }] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const result = await encolarNotificacionPrivadaFeedback({
    pool, actor: "Oriana",
    nota: { id: 12, titulo: "Cambiar tono", updated_at: "2026-09-27T10:00:00Z", feedback: { cliente: "Cristal", responsables: ["Oriana", "Ana Mayerro"] } },
  });
  assert.equal(result.encolado, true);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "Ana Mayerro");
});
