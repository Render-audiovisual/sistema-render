import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/017_integracion_auditoria.sql", import.meta.url), "utf8");

test("Mia consulta exclusivamente tareas activas de RENDER OS", () => {
  assert.match(source, /router\.get\("\/tareas"/);
  assert.match(source, /propiedades_extra->>'workspace'='render_os'/);
  assert.match(source, /archivada_render_os' IS DISTINCT FROM 'true'/);
});

test("crear y editar desde Mia dejan auditoría privada, no comentarios visibles", () => {
  assert.match(source, /writeWilsonAudit\(client, req, \{ action: "crear_tarea"/);
  assert.match(source, /writeWilsonAudit\(client, req, \{ action: "editar_tarea"/);
  assert.doesNotMatch(source, /Creó esta tarea desde Telegram/);
  assert.doesNotMatch(source, /Actualizó esta tarea desde Telegram/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS integracion_auditoria/);
});

test("Mia archiva solo RENDER OS y elimina definitivamente solo desde Papelera", () => {
  assert.match(source, /router\.post\("\/tareas\/:id\/archivar"/);
  assert.match(source, /router\.delete\("\/tareas\/:id"/);
  assert.match(source, /Solo Agustín o Franco pueden eliminar definitivamente/);
  assert.match(source, /archivada_render_os'='true'/);
});

test("Mia reserva los resúmenes de forma atómica antes de enviarlos", () => {
  assert.match(source, /const claimed = \[\]/);
  assert.match(source, /ON CONFLICT\(fingerprint\) DO UPDATE/);
  assert.match(source, /status'='sending'/);
  assert.match(source, /if \(reservation\.rows\[0\]\) claimed\.push\(digest\)/);
  assert.match(source, /status: "delivered"/);
});

test("la auditoría de edición cruza el registro histórico con revisiones activas", () => {
  assert.match(source, /router\.get\("\/auditoria-edicion"/);
  assert.match(source, /Esta auditoría es exclusiva de líderes por chat privado/);
  assert.match(source, /FROM entregas_edicion/);
  assert.match(source, /editor_clave='luciano'/);
  assert.match(source, /t\.tipo_tarea='edicion' AND t\.estado='en_revision'/);
  assert.match(source, /total_operativo: deliveries\.rows\.length \+ reviews\.rows\.length/);
});
