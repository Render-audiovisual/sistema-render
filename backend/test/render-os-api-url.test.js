import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskPageUrl } from "../../frontend/src/features/render-os/services/render-os-api.js";

test("la consulta paginada de RENDER OS envía filtros al backend sin modo Archivadas", () => {
  const url = new URL(buildTaskPageUrl({
    offset: 100,
    query: "reel lanzamiento",
    area: "edicion",
    responsible: "id:123",
    client: "12",
    sector: "edicion",
    priority: "alta",
    archiveMode: "active",
  }), "https://render.local");
  assert.equal(url.searchParams.get("workspace"), "render_os");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("offset"), "100");
  assert.equal(url.searchParams.has("solo_archivadas"), false);
  assert.equal(url.searchParams.get("q"), "reel lanzamiento");
  assert.equal(url.searchParams.get("area"), "edicion");
  assert.equal(url.searchParams.get("asignado_a_id"), "123");
  assert.equal(url.searchParams.has("asignado_a"), false);
  assert.equal(url.searchParams.get("cliente_id"), "12");
  assert.equal(url.searchParams.get("tipo_tarea"), "edicion");
  assert.equal(url.searchParams.get("prioridad"), "alta");
});

test("Papelera usa su propio filtro", () => {
  const url = new URL(buildTaskPageUrl({ archiveMode: "trash" }), "https://render.test");
  assert.equal(url.searchParams.get("papelera"), "true");
  assert.equal(url.searchParams.has("solo_archivadas"), false);
});

test("los filtros vacíos no contaminan la consulta activa", () => {
  const url = new URL(buildTaskPageUrl({}), "https://render.local");
  assert.equal(url.searchParams.get("workspace"), "render_os");
  assert.equal(url.searchParams.has("incluir_archivadas"), false);
  assert.equal(url.searchParams.has("solo_archivadas"), false);
  assert.equal(url.searchParams.has("q"), false);
});

test('principal page requests reject invalid numeric pagination before making a request', () => {
  for (const limit of [0, -1, 501, '50', null, 1.5]) assert.throws(() => buildTaskPageUrl({ limit }));
  for (const offset of [-1, 1000001, '0', null, 0.5]) assert.throws(() => buildTaskPageUrl({ offset }));
  const url = new URL(buildTaskPageUrl({ limit: 500, offset: 1000000 }), 'https://render.local');
  assert.equal(url.searchParams.get('limit'), '500');
  assert.equal(url.searchParams.get('offset'), '1000000');
});
