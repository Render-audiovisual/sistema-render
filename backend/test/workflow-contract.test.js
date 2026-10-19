import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_STATES, EDITORIAL_STATES, LEGACY_TASK_STATE_ALIASES,
  LEGACY_TASK_FINALIZED_STATE, normalizeTaskState, isTaskFinalized,
  isTaskApproved, isPieceActuallyPublished, canFinalizeTaskOnPiecePublication,
} from "../src/workflow-contract.js";

test("task legacy alias is domain-specific and does not imply actual publication", () => {
  assert.equal(normalizeTaskState("publicada"), TASK_STATES.FINALIZED);
  assert.equal(LEGACY_TASK_FINALIZED_STATE, "publicada");
  assert.equal(isTaskFinalized({ estado: "publicada" }), true);
  assert.equal(isTaskFinalized({ estado: "finalizada" }), true);
  assert.equal(isTaskFinalized({ estado: "aprobada" }), false);
  assert.equal(isPieceActuallyPublished({ estado: EDITORIAL_STATES.READY }), false);
  assert.equal(isPieceActuallyPublished({ estado: "aprobada" }), false);
  assert.equal(isPieceActuallyPublished({ estado: "finalizada" }), false);
  assert.equal(isPieceActuallyPublished({ estado: EDITORIAL_STATES.PUBLISHED }), true);
});

test("approval requires explicit state or boolean approval, not readiness or finalization", () => {
  assert.equal(isTaskApproved({ estado: "aprobada" }), true);
  assert.equal(isTaskApproved({ estado: "en_revision", propiedades_extra: { revision_aprobada: true } }), true);
  for (const estado of [undefined, "pendiente", "en_progreso", "en_revision", "lista", "publicada", "finalizada"]) {
    assert.equal(isTaskApproved({ estado }), false);
  }
  for (const revision_aprobada of [undefined, null, false, "true", 1]) {
    assert.equal(isTaskApproved({ propiedades_extra: { revision_aprobada } }), false);
  }
});

test("publication may finalize approved work only; existing finalization remains untouched", () => {
  const published = { estado: "publicada" };
  for (const estado of ["pendiente", "en_progreso", "en_revision", "lista"]) {
    assert.equal(canFinalizeTaskOnPiecePublication({ estado }, published), false);
  }
  assert.equal(canFinalizeTaskOnPiecePublication({ estado: "aprobada" }, published), true);
  assert.equal(canFinalizeTaskOnPiecePublication({ estado: "en_revision", propiedades_extra: { revision_aprobada: true } }, published), true);
  for (const estado of ["finalizada", "publicada"]) {
    assert.equal(canFinalizeTaskOnPiecePublication({ estado, propiedades_extra: { revision_aprobada: true } }, published), false);
  }
  for (const estado of ["lista", "aprobada", "finalizada", undefined]) {
    assert.equal(canFinalizeTaskOnPiecePublication({ estado: "aprobada" }, { estado }), false);
  }
  assert.equal(canFinalizeTaskOnPiecePublication(), false);
});

test("contract is additive, immutable, and does not rewrite source records", () => {
  for (const value of [TASK_STATES, EDITORIAL_STATES, LEGACY_TASK_STATE_ALIASES]) assert.ok(Object.isFrozen(value));
  for (const state of [undefined, "custom_state", "toString", "en_revision"]) assert.equal(normalizeTaskState(state), state);
  const task = Object.freeze({ estado: "publicada", propiedades_extra: Object.freeze({ finalizada_at: "historical" }) });
  assert.equal(isTaskFinalized(task), true);
  assert.equal(task.estado, "publicada");
  assert.equal(task.propiedades_extra.finalizada_at, "historical");
  assert.equal(isTaskApproved(), false);
  assert.equal(isTaskFinalized(), false);
  assert.equal(isPieceActuallyPublished(), false);
});
