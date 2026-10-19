import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canEmployeePatchTask } from "../src/task-access.js";

test("task revision increments for every update, not by lossy wall-clock comparison", () => {
  const sql = readFileSync(new URL("../migrations/057_task_revision.sql", import.meta.url), "utf8");
  assert.match(sql, /revision INTEGER NOT NULL DEFAULT 1 CHECK \(revision > 0\)/);
  assert.match(sql, /NEW.revision := OLD.revision \+ 1/);
  assert.match(sql, /BEFORE UPDATE ON tareas/);
  assert.doesNotMatch(sql, /UPDATE tareas SET|DELETE FROM|fecha_publicaci|estado\s*=/);
});

test("revision is a concurrency token, not an editable business field", () => {
  assert.equal(canEmployeePatchTask({ titulo: "Work", expected_revision: 7 }, { workspace: "render_os" }), true);
  assert.equal(canEmployeePatchTask({ revision: 999 }, { workspace: "render_os" }), false);
});
