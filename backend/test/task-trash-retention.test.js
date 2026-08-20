import assert from "node:assert/strict";
import test from "node:test";
import { purgeExpiredRenderOsTrash, TASK_TRASH_RETENTION_DAYS } from "../src/task-trash-retention.js";

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
