import assert from "node:assert/strict";
import test from "node:test";
import {
  purgeExpiredCompletedRenderOsTasks,
  purgeExpiredRenderOsTrash,
  scheduleRenderOsTrashCleanup,
  TASK_COMPLETED_RETENTION_DAYS,
  TASK_TRASH_RETENTION_DAYS,
} from "../src/task-trash-retention.js";

test("el arranque conserva todas las tareas sin activar explícitamente el borrado automático", () => {
  let queries = 0;
  const pool = { query() { queries += 1; throw new Error("No debe borrar tareas"); } };
  for (const env of [{}, { TASK_COMPLETED_CLEANUP_ENABLED: "true" }, { TASK_AUTOMATIC_DELETION_ENABLED: "false" }]) {
    assert.equal(scheduleRenderOsTrashCleanup(pool, 1000, env), null);
  }
  assert.equal(queries, 0);
});

test("la Papelera elimina definitivamente las tareas de RENDER OS después de 10 días", async () => {
  let query = "";
  let params = [];
  const pool = {
    async query(nextQuery, nextParams) {
      query = nextQuery;
      params = nextParams;
      return { rowCount: 2, rows: [{ id: 10 }, { id: 11 }] };
    },
  };

  const result = await purgeExpiredRenderOsTrash(pool);

  assert.equal(TASK_TRASH_RETENTION_DAYS, 10);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(params, [10]);
  assert.match(query, /DELETE FROM tareas/);
  assert.match(query, /propiedades_extra->>'workspace' = 'render_os'/);
  assert.match(query, /propiedades_extra->>'papelera_render_os' = 'true'/);
  assert.match(query, /papelera_at/);
  assert.match(query, /updated_at/);
  assert.match(query, /RETURNING id/);
});

test("las tareas finalizadas se eliminan definitivamente después de 15 días", async () => {
  let query = "";
  let params = [];
  const pool = {
    async query(nextQuery, nextParams) {
      query = nextQuery;
      params = nextParams;
      return { rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    },
  };

  const result = await purgeExpiredCompletedRenderOsTasks(pool);

  assert.equal(TASK_COMPLETED_RETENTION_DAYS, 15);
  assert.equal(result.rowCount, 3);
  assert.deepEqual(params, [15]);
  assert.match(query, /estado = 'publicada'/);
  assert.match(query, /finalizada_at/);
  assert.match(query, /DELETE FROM mia_private_task_notifications/);
  assert.match(query, /DELETE FROM tareas/);
});
