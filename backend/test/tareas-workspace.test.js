import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../src/db.js";

const qaDisponible = Boolean(process.env.DATABASE_URL) && process.env.RENDER_OS_TEST_DATABASE === "true";
const skipReason = "requiere DATABASE_URL de QA y RENDER_OS_TEST_DATABASE=true";

test(
  "API RENDER OS: aislamiento, CRUD, comentarios, paginación y concurrencia",
  { skip: qaDisponible ? false : skipReason, timeout: 30_000 },
  async () => {
    process.env.RENDER_DISABLE_SERVER_START = "true";
    process.env.SETUP_DEMO_DATA = "false";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const { app } = await import("../src/server.js");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const marker = `[TEST RENDER OS ${Date.now()}]`;
    const ids = [];
    let historicalId = null;

    const request = async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, options);
      const body = await response.json().catch(() => ({}));
      return { response, body };
    };
    const jsonOptions = (method, body) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    try {
      const initiallyEmpty = await request("/tareas?workspace=render_os&limit=10&offset=0");
      assert.equal(initiallyEmpty.response.status, 200);
      assert.deepEqual(initiallyEmpty.body, [], "la base QA debe comenzar sin tareas render_os");
      assert.equal(initiallyEmpty.response.headers.get("x-total-count"), "0");

      const historical = await pool.query(
        `INSERT INTO tareas (titulo, asignado_a, estado, prioridad, propiedades_extra)
         VALUES ($1, 'QA', 'pendiente', 'media', '{}'::jsonb)
         RETURNING id`,
        [`${marker} histórica`],
      );
      historicalId = historical.rows[0].id;

      const withoutHistorical = await request("/tareas?workspace=render_os&limit=10&offset=0");
      assert.equal(withoutHistorical.response.status, 200);
      assert.deepEqual(withoutHistorical.body, []);

      const createdResponse = await request("/tareas", jsonOptions("POST", {
        titulo: `${marker} principal`,
        asignado_a: "QA",
        estado: "pendiente",
        prioridad: "media",
        workspace: "render_os",
      }));
      assert.equal(createdResponse.response.status, 201);
      assert.equal(createdResponse.body.propiedades_extra.workspace, "render_os");
      const taskId = createdResponse.body.id;
      ids.push(taskId);

      const secondResponse = await request("/tareas", jsonOptions("POST", {
        titulo: `${marker} segunda`,
        asignado_a: "QA",
        estado: "pendiente",
        prioridad: "baja",
        workspace: "render_os",
        tarea_padre_id: taskId,
      }));
      assert.equal(secondResponse.response.status, 201);
      ids.push(secondResponse.body.id);

      const direct = await request(`/tareas/${taskId}?workspace=render_os`);
      assert.equal(direct.response.status, 200);
      assert.equal(direct.body.id, taskId);
      assert.equal(direct.body.propiedades_extra.workspace, "render_os");

      const historicalDirect = await request(`/tareas/${historicalId}?workspace=render_os`);
      assert.equal(historicalDirect.response.status, 404);

      const paged = await request("/tareas?workspace=render_os&limit=1&offset=0&incluir_archivadas=true");
      assert.equal(paged.response.status, 200);
      assert.equal(paged.body.length, 1);
      assert.equal(paged.response.headers.get("x-total-count"), "2");

      const edited = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        titulo: `${marker} editada`,
        expected_updated_at: direct.body.updated_at,
      }));
      assert.equal(edited.response.status, 200);
      assert.equal(edited.body.titulo, `${marker} editada`);

      const historicalEdit = await request(`/tareas/${historicalId}?workspace=render_os`, jsonOptions("PATCH", {
        titulo: `${marker} histórica alterada`,
      }));
      assert.equal(historicalEdit.response.status, 404);
      const historicalUntouched = await pool.query("SELECT titulo FROM tareas WHERE id = $1", [historicalId]);
      assert.equal(historicalUntouched.rows[0].titulo, `${marker} histórica`);

      const archived = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        propiedades_extra: { archivada_render_os: true },
        expected_updated_at: edited.body.updated_at,
      }));
      assert.equal(archived.response.status, 200);
      assert.equal(archived.body.propiedades_extra.archivada_render_os, true);
      assert.equal(archived.body.propiedades_extra.workspace, "render_os");

      const restored = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        propiedades_extra: { archivada_render_os: false },
        expected_updated_at: archived.body.updated_at,
      }));
      assert.equal(restored.response.status, 200);
      assert.equal(restored.body.propiedades_extra.archivada_render_os, false);

      const comment = await request(`/tareas/${taskId}/comentarios?workspace=render_os`, jsonOptions("POST", {
        autor: "QA",
        contenido: "Comentario de integración",
      }));
      assert.equal(comment.response.status, 201);
      const comments = await request(`/tareas/${taskId}/comentarios?workspace=render_os`);
      assert.equal(comments.response.status, 200);
      assert.ok(comments.body.some((item) => item.id === comment.body.id));
      const historicalComment = await request(`/tareas/${historicalId}/comentarios?workspace=render_os`, jsonOptions("POST", {
        autor: "QA",
        contenido: "No debe guardarse",
      }));
      assert.equal(historicalComment.response.status, 404);

      const concurrentWinner = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        titulo: `${marker} versión vigente`,
        expected_updated_at: restored.body.updated_at,
      }));
      assert.equal(concurrentWinner.response.status, 200);
      const conflict = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        titulo: `${marker} versión obsoleta`,
        expected_updated_at: restored.body.updated_at,
      }));
      assert.equal(conflict.response.status, 409);
      const afterConflict = await request(`/tareas/${taskId}?workspace=render_os`);
      assert.equal(afterConflict.body.titulo, `${marker} versión vigente`);

      const deleted = await request(`/tareas/${taskId}?workspace=render_os`, { method: "DELETE" });
      assert.equal(deleted.response.status, 200);
      ids.splice(ids.indexOf(taskId), 1);
      const deletedDirect = await request(`/tareas/${taskId}?workspace=render_os`);
      assert.equal(deletedDirect.response.status, 404);

      const historicalDelete = await request(`/tareas/${historicalId}?workspace=render_os`, { method: "DELETE" });
      assert.equal(historicalDelete.response.status, 404);
      const historicalStillThere = await pool.query("SELECT titulo FROM tareas WHERE id = $1", [historicalId]);
      assert.equal(historicalStillThere.rows[0].titulo, `${marker} histórica`);
    } finally {
      if (ids.length) {
        await pool.query("DELETE FROM tarea_comentarios WHERE tarea_id = ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM tareas WHERE id = ANY($1::int[])", [ids]);
      }
      if (historicalId) {
        await pool.query("DELETE FROM tarea_comentarios WHERE tarea_id = $1", [historicalId]);
        await pool.query("DELETE FROM tareas WHERE id = $1", [historicalId]);
      }
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  },
);
