import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/039_baja_cristal_joyerias_octubre.sql", import.meta.url), "utf8");

test("la baja de Cristal Joyerías conserva el historial y corta la operación desde octubre", () => {
  assert.match(migration, /UPDATE clientes[\s\S]*activo = FALSE/);
  assert.match(migration, /fecha_fin = DATE '2026-09-30'/);
  assert.match(migration, /UPDATE contratos_financieros[\s\S]*finaliza_el = DATE '2026-09-30'/);
  assert.match(migration, /UPDATE tareas[\s\S]*'archivada_render_os', TRUE/);
  assert.match(migration, /UPDATE publicaciones[\s\S]*fecha_programada >= DATE '2026-10-01'/);
  assert.match(migration, /UPDATE historias[\s\S]*fecha_programada >= DATE '2026-10-01'/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
