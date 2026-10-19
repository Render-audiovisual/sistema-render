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

test("cada identidad ingresa al Inicio personal sin atajos por nombre", () => {
  assert.equal(getDefaultUserRoute({ usuario: "Mariano", rol: "diseno" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Leo Aragon", rol: "diseno" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Nueva líder", rol: "admin" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Augusto", rol: "diseno" }, knownRoutes), "/inicio");
});
