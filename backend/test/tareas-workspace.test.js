import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { pool } from "../src/db.js";

const qaDisponible = Boolean(process.env.DATABASE_URL) && process.env.RENDER_OS_TEST_DATABASE === "true";
const skipReason = "requiere DATABASE_URL de QA y RENDER_OS_TEST_DATABASE=true";

test(
  "API RENDER OS: aislamiento, CRUD, comentarios, paginación y concurrencia",
  { skip: qaDisponible ? false : skipReason, timeout: 30_000 },
  async () => {
    process.env.RENDER_DISABLE_SERVER_START = "true";
    process.env.SETUP_DEMO_DATA = "false";
    process.env.JWT_SECRET = "render-os-qa-test-only";
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

    const adminToken = jwt.sign({ id: -1, usuario: "qa-admin", nombre: "QA Admin", rol: "admin" }, process.env.JWT_SECRET);
    const employeeToken = jwt.sign({ id: -2, usuario: "qa-diseno", nombre: "QA Diseño", rol: "diseno" }, process.env.JWT_SECRET);
    const request = async (path, options = {}, token = adminToken) => {
      const headers = { ...(options.headers || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    };
    const jsonOptions = (method, body) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    try {
      const anonymous = await request("/tareas?workspace=render_os", {}, null);
      assert.equal(anonymous.response.status, 401);

      const forbiddenAdminAction = await request("/clientes", jsonOptions("POST", { nombre: "No crear" }), employeeToken);
      assert.equal(forbiddenAdminAction.response.status, 403);

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
        colaboradores: ["QA Colaborador", "QA Diseño"],
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
        tipo_tarea: "produccion",
        workspace: "render_os",
        tarea_padre_id: taskId,
      }));
      assert.equal(secondResponse.response.status, 201);
      ids.push(secondResponse.body.id);

      await pool.query("UPDATE tareas SET tarea_padre_id = $1 WHERE id = $2", [taskId, historicalId]);

      const subtasks = await request(`/tareas/${taskId}/subtareas?workspace=render_os`);
      assert.equal(subtasks.response.status, 200);
      assert.deepEqual(subtasks.body.map((item) => item.id), [secondResponse.body.id]);
      assert.ok(subtasks.body.every((item) => item.propiedades_extra.workspace === "render_os"));

      const historicalSubtasks = await request(`/tareas/${historicalId}/subtareas?workspace=render_os`);
      assert.equal(historicalSubtasks.response.status, 404);

      const direct = await request(`/tareas/${taskId}?workspace=render_os`);
      assert.equal(direct.response.status, 200);
      assert.equal(direct.body.id, taskId);
      assert.equal(direct.body.propiedades_extra.workspace, "render_os");

      const employeeList = await request("/tareas?workspace=render_os&limit=10", {}, employeeToken);
      assert.deepEqual(employeeList.body.map((item) => item.id), [taskId, secondResponse.body.id]);
      const employeeDirect = await request(`/tareas/${taskId}?workspace=render_os`, {}, employeeToken);
      assert.equal(employeeDirect.response.status, 200);
      const employeeOtherTask = await request(`/tareas/${secondResponse.body.id}?workspace=render_os`, {}, employeeToken);
      assert.equal(employeeOtherTask.response.status, 200);
      const employeeCreate = await request("/tareas", jsonOptions("POST", {
        titulo: `${marker} no autorizada`, asignado_a: "QA Diseño", workspace: "render_os",
      }), employeeToken);
      assert.equal(employeeCreate.response.status, 403);
      const employeeRename = await request(`/tareas/${taskId}?workspace=render_os`, jsonOptions("PATCH", {
        titulo: `${marker} no autorizada`,
      }), employeeToken);
      assert.equal(employeeRename.response.status, 403);
      const employeeDelete = await request(`/tareas/${taskId}?workspace=render_os`, { method: "DELETE" }, employeeToken);
      assert.equal(employeeDelete.response.status, 403);
      const employeeComment = await request(`/tareas/${taskId}/comentarios?workspace=render_os`, jsonOptions("POST", {
        autor: "Nombre falsificado",
        contenido: "Comentario del colaborador",
      }), employeeToken);
      assert.equal(employeeComment.response.status, 201);
      assert.equal(employeeComment.body.autor, "QA Diseño");

      const historicalDirect = await request(`/tareas/${historicalId}?workspace=render_os`);
      assert.equal(historicalDirect.response.status, 404);

      const paged = await request("/tareas?workspace=render_os&limit=1&offset=0&incluir_archivadas=true");
      assert.equal(paged.response.status, 200);
      assert.equal(paged.body.length, 1);
      assert.equal(paged.response.headers.get("x-total-count"), "2");

      const byCollaborator = await request("/tareas?workspace=render_os&asignado_a=QA%20Colaborador&limit=10");
      assert.deepEqual(byCollaborator.body.map((item) => item.id), [taskId]);
      const bySearch = await request("/tareas?workspace=render_os&q=principal&limit=10");
      assert.deepEqual(bySearch.body.map((item) => item.id), [taskId]);
      const byCombinedSearch = await request(`/tareas?workspace=render_os&q=${encodeURIComponent(`${marker} principal QA`)}&limit=10`);
      assert.deepEqual(byCombinedSearch.body.map((item) => item.id), [taskId]);
      const byArea = await request("/tareas?workspace=render_os&area=produccion&limit=10");
      assert.deepEqual(byArea.body.map((item) => item.id), [secondResponse.body.id]);

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

      const archivedOnly = await request("/tareas?workspace=render_os&solo_archivadas=true&limit=10");
      assert.deepEqual(archivedOnly.body.map((item) => item.id), [taskId]);

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

      const visitResponse = await request("/tareas", jsonOptions("POST", {
        titulo: `${marker} Visita producción`,
        asignado_a: "QA",
        cliente_id: null,
        estado: "pendiente",
        tipo_tarea: "produccion",
        subtipo: "visita",
        produccion_videos_previstos: 2,
        material_referencia: "https://drive.google.com/qa-material",
        workspace: "render_os",
      }));
      assert.equal(visitResponse.response.status, 201);
      ids.push(visitResponse.body.id);
      const productionRecord = await request(`/tareas/${visitResponse.body.id}/produccion/registros?workspace=render_os`, jsonOptions("POST", {
        cantidad: 2,
        fecha: "2026-08-06",
        expected_updated_at: visitResponse.body.updated_at,
      }));
      assert.equal(productionRecord.response.status, 201);
      const visitReview = await request(`/tareas/${visitResponse.body.id}?workspace=render_os`, jsonOptions("PATCH", {
        estado: "en_revision",
        expected_updated_at: productionRecord.body.updated_at,
      }));
      assert.equal(visitReview.response.status, 200);
      let generatedEditingTask = null;
      for (let attempt = 0; attempt < 20 && !generatedEditingTask; attempt += 1) {
        const generated = await pool.query("SELECT id, asignado_a, material_referencia FROM tareas WHERE propiedades_extra->>'origen_visita_id' = $1", [String(visitResponse.body.id)]);
        generatedEditingTask = generated.rows[0] || null;
        if (!generatedEditingTask) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(generatedEditingTask?.asignado_a, "Luciano");
      assert.equal(generatedEditingTask?.material_referencia, "https://drive.google.com/qa-material");
      ids.push(generatedEditingTask.id);
      const generatedCount = await pool.query("SELECT count(*)::int AS total FROM tareas WHERE propiedades_extra->>'origen_visita_id' = $1", [String(visitResponse.body.id)]);
      assert.equal(generatedCount.rows[0].total, 1);

      const reviewVideoResponse = await request("/tareas", jsonOptions("POST", {
        titulo: `${marker} Editar video`,
        asignado_a: "QA",
        estado: "en_revision",
        tipo_tarea: "edicion",
        workspace: "render_os",
      }));
      assert.equal(reviewVideoResponse.response.status, 201);
      ids.push(reviewVideoResponse.body.id);
      const approvedVideo = await request(`/tareas/${reviewVideoResponse.body.id}/aprobar-publicacion?workspace=render_os`, { method: "POST" });
      assert.equal(approvedVideo.response.status, 200);
      assert.equal(approvedVideo.body.asignado_a, "Oriana");
      assert.equal(approvedVideo.body.propiedades_extra.revision_aprobada, true);
      const duplicateApproval = await request(`/tareas/${reviewVideoResponse.body.id}/aprobar-publicacion?workspace=render_os`, { method: "POST" });
      assert.equal(duplicateApproval.response.status, 409);

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
