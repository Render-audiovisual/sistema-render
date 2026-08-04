import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskPageUrl } from "../../frontend/src/features/render-os/services/render-os-api.js";

test("la consulta paginada de RENDER OS envía filtros y archivado al backend", () => {
  const url = new URL(buildTaskPageUrl({
    offset: 100,
    query: "reel lanzamiento",
    area: "edicion",
    responsible: "Augusto",
    client: "12",
    sector: "edicion",
    priority: "alta",
    archiveMode: "archived",
  }), "https://render.local");
  assert.equal(url.searchParams.get("workspace"), "render_os");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("offset"), "100");
  assert.equal(url.searchParams.get("solo_archivadas"), "true");
  assert.equal(url.searchParams.get("q"), "reel lanzamiento");
  assert.equal(url.searchParams.get("area"), "edicion");
  assert.equal(url.searchParams.get("asignado_a"), "Augusto");
  assert.equal(url.searchParams.get("cliente_id"), "12");
  assert.equal(url.searchParams.get("tipo_tarea"), "edicion");
  assert.equal(url.searchParams.get("prioridad"), "alta");
});

test("los filtros vacíos no contaminan la consulta activa", () => {
  const url = new URL(buildTaskPageUrl({}), "https://render.local");
  assert.equal(url.searchParams.get("workspace"), "render_os");
  assert.equal(url.searchParams.has("incluir_archivadas"), false);
  assert.equal(url.searchParams.has("solo_archivadas"), false);
  assert.equal(url.searchParams.has("q"), false);
});
