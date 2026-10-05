import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../migrations/051_progreso_edicion_auditable.sql", import.meta.url), "utf8");
const reports = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");

test("el progreso se persiste por tarea real y cuenta revisión o publicación", () => {
  assert.match(migration, /tarea_id BIGINT NOT NULL UNIQUE/);
  assert.match(migration, /NEW\.estado IN \('en_revision', 'publicada'\)/);
  assert.match(migration, /CREATE TRIGGER progreso_edicion_tarea_cambio/);
});

test("la baja se registra sin borrar el historial y la purga no descuenta", () => {
  assert.match(migration, /activa = FALSE/);
  assert.match(migration, /baja_at = COALESCE\(baja_at, NOW\(\)\)/);
  assert.doesNotMatch(migration, /AFTER DELETE/);
});

test("el lote conversacional de 67 se revierte de forma acotada", () => {
  assert.match(migration, /DELETE FROM entregas_edicion[\s\S]*fuente = 'whatsapp-franco-2026-10-05-septiembre'/);
});

test("la barra usa el registro operativo y no el módulo de sueldos", () => {
  assert.match(reports, /const entregasLucianoDelPeriodo = progresoEdicion\.filter/);
  assert.doesNotMatch(reports, /const entregasLucianoDelPeriodo = entregasEdicion\.filter/);
});
