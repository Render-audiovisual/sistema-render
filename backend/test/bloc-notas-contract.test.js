import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../frontend/src/pages/BlocNotas.jsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/013_bloc_notas.sql", import.meta.url), "utf8");

test("el Bloc de notas exige sesión y expone el contrato CRUD con Papelera", () => {
  const authPosition = server.indexOf("router.use(requireAuthentication)");
  for (const route of [
    'router.get("/notas"',
    'router.post("/notas"',
    'router.patch("/notas/:id"',
    'router.delete("/notas/:id"',
    'router.post("/notas/:id/restaurar"',
  ]) {
    assert.ok(server.indexOf(route) > authPosition, `${route} debe quedar detrás de autenticación`);
  }
  assert.match(server, /expected_updated_at/);
  assert.match(server, /res\.status\(409\)/);
  assert.match(server, /eliminado_at IS NOT NULL/);
});

test("la tabla conserva autor, última modificación, Papelera y versión", () => {
  for (const field of ["creado_por", "modificado_por", "eliminado_at", "created_at", "updated_at"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
});

test("la ruta y el acceso compartido están visibles junto a Tareas", () => {
  assert.match(app, /"\/bloc-notas"/);
  assert.match(app, /<BlocNotasPage/);
  assert.match(sidebar, /href: "\/workspace\/tareas"[\s\S]*href: "\/bloc-notas"/);
  assert.match(page, /saveQueue/);
  assert.match(page, /expected_updated_at/);
  assert.match(page, /Papelera/);
});
