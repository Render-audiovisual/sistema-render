import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const backend = fs.readFileSync(new URL("../src/wilson-chat.js", import.meta.url), "utf8");
const frontend = fs.readFileSync(new URL("../../frontend/src/features/render-os/WilsonAssistant.jsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/028_wilson_mensajes_leidos.sql", import.meta.url), "utf8");

test("Wilson cuenta únicamente sus mensajes posteriores a la última lectura del usuario", () => {
  assert.match(backend, /m\.remitente='wilson'/);
  assert.match(backend, /m\.created_at>COALESCE\(c\.last_read_at/);
  assert.match(backend, /usuario_id=\$1 AND c\.periodo=\$2/);
});

test("abrir Wilson permite marcar la conversación individual como leída", () => {
  assert.match(backend, /router\.post\("\/conversacion\/leida"/);
  assert.match(backend, /UPDATE wilson_conversaciones SET last_read_at=NOW\(\)/);
  assert.match(frontend, /setUnread\(0\)/);
  assert.match(frontend, /\/api\/wilson\/conversacion\/leida/);
});

test("la interfaz muestra campanita, contador y hora sin usar notificaciones globales", () => {
  assert.match(frontend, /function BellIcon/);
  assert.match(frontend, /wilson-unread-badge/);
  assert.match(frontend, /messageTime/);
  assert.doesNotMatch(backend, /UPDATE usuarios SET.+no_leidos/s);
});

test("la migración es compatible con conversaciones ya existentes", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_wilson_mensajes_no_leidos/);
});
