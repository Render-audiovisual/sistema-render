import assert from "node:assert/strict";
import test from "node:test";
import { getTaskSearchTerms } from "../src/task-search.js";

test("divide una búsqueda combinada en términos independientes", () => {
  assert.deepEqual(getTaskSearchTerms("  Video 1   RPM Chevrolet "), ["Video", "1", "RPM", "Chevrolet"]);
});

test("limita búsquedas excesivamente largas", () => {
  assert.equal(getTaskSearchTerms("uno dos tres cuatro", 2).length, 2);
});
