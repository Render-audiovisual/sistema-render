import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/015_tareas_flujo_notificaciones.sql", import.meta.url), "utf8");

test("el backend expone la aprobación y crea la edición vinculada a Luciano", () => {
  assert.match(server, /\/tareas\/:id\/aprobar-publicacion/);
  assert.match(server, /asignado_a = 'Oriana'/);
  assert.match(server, /VALUES \(\$1, 'Luciano'/);
  assert.match(server, /origen_visita_id/);
});

test("la migración evita duplicar tareas de edición por visita", () => {
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.match(migration, /origen_visita_id/);
  assert.match(migration, /workspace.*render_os/s);
});
