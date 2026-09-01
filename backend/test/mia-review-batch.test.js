import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  normalizeReviewBatchIds,
  resolveReviewTaskReferences,
  reviewBatchSnapshotChanged,
  reviewHandoffError,
  reviewTaskOwnedBy,
  validateWilsonConfirmation,
} from "../src/wilson-integration.js";

const task = (id, overrides = {}) => ({
  id, titulo: "Carrusel 1", cliente_nombre: "Luzin", asignado_a: "Mariano Meza",
  estado: "pendiente", fecha_vencimiento: "2026-09-03", updated_at: "2026-09-01T12:00:00.000Z",
  propiedades_extra: { workspace: "render_os" }, ...overrides,
});

test("el lote acepta hasta veinte IDs válidos, únicos y ordenados", () => {
  assert.deepEqual(normalizeReviewBatchIds([3, "2", 3, 0, "x", 1]), [3, 2, 1]);
  assert.equal(normalizeReviewBatchIds(Array.from({ length: 30 }, (_, index) => index + 1)).length, 20);
});

test("Mia no elige cuando encuentra dos tareas parecidas", () => {
  const result = resolveReviewTaskReferences(["Luzin Carrusel 1"], [
    task(1), task(2, { fecha_vencimiento: "2026-09-17" }),
  ]);
  assert.equal(result.can_preview, false);
  assert.equal(result.results[0].status, "ambiguous");
  assert.equal(result.results[0].matches.length, 2);
});

test("la fecha permite desambiguar y preparar una única tarea", () => {
  const result = resolveReviewTaskReferences(["Luzin Carrusel 1 2026-09-17"], [
    task(1), task(2, { fecha_vencimiento: "2026-09-17" }),
  ]);
  assert.equal(result.can_preview, true);
  assert.deepEqual(result.task_ids, [2]);
});

test("un empleado solo puede informar tareas propias o donde colabora", () => {
  assert.equal(reviewTaskOwnedBy(task(1), "Mariano"), true);
  assert.equal(reviewTaskOwnedBy(task(1), "Augusto"), false);
  assert.equal(reviewTaskOwnedBy(task(1, { propiedades_extra: { colaboradores: ["Augusto"] } }), "Augusto"), true);
});

test("cualquier cambio de estado, responsable o versión invalida el lote", () => {
  const snapshot = task(1);
  assert.equal(reviewBatchSnapshotChanged(task(1), snapshot), false);
  assert.equal(reviewBatchSnapshotChanged(task(1, { estado: "en_revision" }), snapshot), true);
  assert.equal(reviewBatchSnapshotChanged(task(1, { asignado_a: "Augusto" }), snapshot), true);
  assert.equal(reviewBatchSnapshotChanged(task(1, { updated_at: "2026-09-01T12:01:00.000Z" }), snapshot), true);
});

test("una visita incompleta o sin confirmación no puede saltear el flujo normal", () => {
  const visit = task(7, {
    titulo: "Bohle | Visita producción",
    tipo_tarea: "produccion",
    subtipo: "visita_produccion",
    material_referencia: "https://drive.google.com/folder/example",
    propiedades_extra: {
      workspace: "render_os",
      produccion_videos_previstos: 4,
      produccion_registros: [{ cantidad: 3 }],
    },
  });
  assert.match(reviewHandoffError(visit), /falta/i);
  assert.match(reviewHandoffError({
    ...visit,
    propiedades_extra: { ...visit.propiedades_extra, produccion_registros: [{ cantidad: 4 }] },
  }), /confirmada/i);
  assert.equal(reviewHandoffError({
    ...visit,
    propiedades_extra: {
      ...visit.propiedades_extra,
      produccion_registros: [{ cantidad: 4 }],
      produccion_confirmada_at: "2026-09-01T12:00:00.000Z",
    },
  }), null);
});

test("las confirmaciones vencen después de quince minutos", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  assert.equal(validateWilsonConfirmation({ confirmed: true, confirmedAt: "2026-09-01T11:45:00.000Z", now }), null);
  assert.match(validateWilsonConfirmation({ confirmed: true, confirmedAt: "2026-09-01T11:44:59.000Z", now }), /venció/);
});

test("el contrato ejecuta el lote en transacción y conserva auditoría", () => {
  const source = fs.readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../migrations/030_mia_review_batches.sql", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/lotes\/revision\/previsualizar"/);
  assert.match(source, /router\.post\("\/lotes\/revision\/confirmar"/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /pasar_a_revision_desde_mia/);
  assert.match(source, /No modifiqué ninguna tarea/);
  assert.match(migration, /informante_actor_id/);
  assert.match(migration, /payload JSONB/);
});
