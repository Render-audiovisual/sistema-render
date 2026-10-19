import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskAssignmentInput } from "../../frontend/src/shared/task-assignment-input.js";

test("construye exclusivamente el DTO de IDs sin resolver nombres", () => {
  assert.deepEqual(buildTaskAssignmentInput({ ownerId: 1, collaboratorIds: [2, 3], nombre: "Franco" }), {
    asignado_a_id: 1, colaborador_ids: [2, 3],
  });
  assert.deepEqual(buildTaskAssignmentInput({ ownerId: null, collaboratorIds: [] }), {
    asignado_a_id: null, colaborador_ids: [],
  });
});

test("no muta ni comparte el array de colaboradores", () => {
  const collaboratorIds = Object.freeze([2, 3]);
  const input = Object.freeze({ ownerId: 1, collaboratorIds });
  const result = buildTaskAssignmentInput(input);
  result.colaborador_ids.pop();
  assert.deepEqual(collaboratorIds, [2, 3]);
  assert.deepEqual(buildTaskAssignmentInput(input).colaborador_ids, [2, 3]);
});

test("rechaza IDs inválidos sin coerción ni resolución por nombre", () => {
  for (const value of [undefined, "1", "Franco", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, {}, []]) {
    assert.throws(() => buildTaskAssignmentInput({ ownerId: value, collaboratorIds: [] }), TypeError);
    assert.throws(() => buildTaskAssignmentInput({ ownerId: null, collaboratorIds: [value] }), TypeError);
  }
  assert.throws(() => buildTaskAssignmentInput({ ownerId: null, collaboratorIds: [null] }), TypeError);
  for (const collaboratorIds of [undefined, null, "2", 2, {}, Array(1)]) {
    assert.throws(() => buildTaskAssignmentInput({ ownerId: null, collaboratorIds }), TypeError);
  }
});
