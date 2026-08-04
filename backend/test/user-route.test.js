import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultUserRoute, normalizeUserKey } from "../../frontend/src/shared/session/route-utils.js";

const knownRoutes = {
  lider: "/lider",
  augusto: "/augusto",
  luciano: "/luciano",
};

test("normaliza nombres de usuario sin depender de mayúsculas o acentos", () => {
  assert.equal(normalizeUserKey("  Germán  "), "german");
});

test("los usuarios sin dashboard personal ingresan a Tareas según su rol", () => {
  assert.equal(getDefaultUserRoute({ usuario: "Mariano", rol: "diseno" }, knownRoutes), "/workspace/tareas");
  assert.equal(getDefaultUserRoute({ usuario: "Leo Aragon", rol: "diseno" }, knownRoutes), "/workspace/tareas");
  assert.equal(getDefaultUserRoute({ usuario: "Nueva líder", rol: "admin" }, knownRoutes), "/lider");
  assert.equal(getDefaultUserRoute({ usuario: "Augusto", rol: "diseno" }, knownRoutes), "/augusto");
});
