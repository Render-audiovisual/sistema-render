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

test("finalizar una tarea nunca publica piezas ni escribe fechas reales", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };

  for (const estado of ["pendiente", "en_revision", "aprobada", "finalizada", "publicada"]) {
    for (const links of [{ publicacion_id: 9 }, { historia_id: 7 }, { publicacion_id: 9, historia_id: 7 }, {}]) {
      assert.equal(await publishPieceLinkedToCompletedTask(pool, { estado, ...links }), 0);
    }
  }
  assert.equal(await publishPieceLinkedToCompletedTask(pool), 0);
  assert.equal(calls.length, 0);
});

test("publicar una pieza completa únicamente sus tareas automáticas vinculadas y aprobadas", async () => {
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
  assert.match(calls[0].sql, /estado NOT IN \('publicada', 'finalizada'\)/);
  assert.match(calls[0].sql, /AND \(estado = 'aprobada' OR propiedades_extra->'revision_aprobada' = 'true'::jsonb\)/);
  assert.match(calls[0].sql, /SET estado = 'publicada'/); // Legacy storage until server migration.
  assert.match(calls[0].sql, /jsonb_build_object\('finalizada_at', now\(\)\)/);
  assert.doesNotMatch(calls[0].sql, /UPDATE (publicaciones|historias)|fecha_publicación_real/);
});

test("sin publicación real o vínculo no consulta la base", async () => {
  const pool = { query: async () => assert.fail("unexpected query") };
  for (const estado of [undefined, "lista", "aprobada", "finalizada", "en_revision"]) {
    assert.equal(await completeLinkedAutoTasks(pool, { estado, historiaId: 7 }), 0);
  }
  assert.equal(await completeLinkedAutoTasks(pool, { estado: "publicada" }), 0);
  assert.equal(await completeLinkedAutoTasks(pool), 0);
});

test("conserva parámetros de historias y ambos vínculos y tolera cero filas", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 0 }; } };
  assert.equal(await completeLinkedAutoTasks(pool, { estado: "publicada", historiaId: 7 }), 0);
  assert.equal(await completeLinkedAutoTasks(pool, { estado: "publicada", historiaId: 7, publicacionId: 8 }), 0);
  assert.deepEqual(calls.map(({ params }) => params), [[7, null], [7, 8]]);
  assert.match(calls[0].sql, /historia_id = \$1/);
  assert.match(calls[0].sql, /publicacion_id = \$2/);
});

test("propaga errores de persistencia sin afirmar finalización", async () => {
  const pool = { query: async () => { throw new Error("mock DB unavailable"); } };
  await assert.rejects(completeLinkedAutoTasks(pool, { estado: "publicada", publicacionId: 8 }), /mock DB unavailable/);
});
