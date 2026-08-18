import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { pool } from "../src/db.js";

const qaDisponible = Boolean(process.env.DATABASE_URL) && process.env.RENDER_OS_TEST_DATABASE === "true";

test("API Bloc de notas: acceso compartido, autoguardado, conflicto y Papelera", {
  skip: qaDisponible ? false : "requiere PostgreSQL QA y RENDER_OS_TEST_DATABASE=true",
  timeout: 30_000,
}, async () => {
  process.env.RENDER_DISABLE_SERVER_START = "true";
  process.env.JWT_SECRET = "render-os-qa-test-only";
  const { app } = await import("../src/server.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const token = jwt.sign({ id: -8, usuario: "qa-equipo", nombre: "QA Equipo", rol: "diseno" }, process.env.JWT_SECRET);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let noteId = null;
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    return { response, body: await response.json().catch(() => ({})) };
  };

  try {
    const created = await request("/notas", { method: "POST", body: JSON.stringify({ titulo: "QA nota", contenido: "Inicial", categoria: "diseno" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.creado_por, "QA Equipo");
    assert.equal(created.body.categoria, "diseno");
    noteId = created.body.id;

    const updated = await request(`/notas/${noteId}`, { method: "PATCH", body: JSON.stringify({ contenido: "Guardada", categoria: "reunion", expected_updated_at: created.body.updated_at }) });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.contenido, "Guardada");
    assert.equal(updated.body.categoria, "reunion");

    const stale = await request(`/notas/${noteId}`, { method: "PATCH", body: JSON.stringify({ contenido: "No pisar", expected_updated_at: created.body.updated_at }) });
    assert.equal(stale.response.status, 409);

    assert.equal((await request(`/notas/${noteId}`, { method: "DELETE" })).response.status, 200);
    const trash = await request("/notas?papelera=true&q=QA%20nota");
    assert.ok(trash.body.some((note) => note.id === noteId));
    assert.equal((await request(`/notas/${noteId}/restaurar`, { method: "POST" })).response.status, 200);
  } finally {
    if (noteId) await pool.query("DELETE FROM notas_compartidas WHERE id=$1", [noteId]);
    await new Promise((resolve) => server.close(resolve));
  }
});
