import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoTaskProperties, completeLinkedAutoTasks, publishPieceLinkedToCompletedTask } from "../src/piece-task-linking.js";

test("las tareas automáticas de piezas pertenecen a RENDER OS", () => {
  assert.deepEqual(buildAutoTaskProperties(), {
    Origen: "Generada automáticamente al crear la pieza",
    workspace: "render_os",
    origen_pieza: true,
  });
});

test("finalizar una tarea publica la pieza vinculada", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };

  assert.equal(await publishPieceLinkedToCompletedTask(pool, { estado: "en_revision", publicacion_id: 9 }), 0);
  assert.equal(await publishPieceLinkedToCompletedTask(pool, { estado: "publicada", publicacion_id: 9 }), 1);
  assert.deepEqual(calls[0].params, [9]);
  assert.match(calls[0].sql, /UPDATE publicaciones/);
  assert.match(calls[0].sql, /estado = 'publicada'/);
});

test("publicar una pieza completa únicamente sus tareas automáticas vinculadas", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 2 };
    },
  };

  assert.equal(await completeLinkedAutoTasks(pool, { estado: "lista", publicacionId: 8 }), 0);
  assert.equal(calls.length, 0);

  assert.equal(await completeLinkedAutoTasks(pool, { estado: "publicada", publicacionId: 8 }), 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [null, 8]);
  assert.match(calls[0].sql, /workspace' = 'render_os'/);
  assert.match(calls[0].sql, /origen_pieza' = 'true'/);
});
