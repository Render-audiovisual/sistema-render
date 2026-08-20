import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/026_corregir_mariano_meza.sql", import.meta.url), "utf8");

test("la migración unifica a Mariano Meza sin eliminar historial", () => {
  assert.match(migration, /UPDATE usuarios\s+SET nombre = 'Mariano Meza'/);
  assert.match(migration, /UPDATE tareas\s+SET asignado_a = 'Mariano Meza'/);
  assert.match(migration, /jsonb_array_elements_text\(propiedades_extra->'colaboradores'\)/);
  assert.match(migration, /UPDATE cliente_configuraciones\s+SET disenador_responsable = 'Mariano Meza'/);
  assert.match(migration, /UPDATE historias/);
  assert.match(migration, /UPDATE publicaciones/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
