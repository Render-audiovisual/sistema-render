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

test("todo el equipo ingresa al inicio personalizado y conserva el acceso al tablero", () => {
  assert.equal(getDefaultUserRoute({ usuario: "Mariano", rol: "diseno" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Leo Aragon", rol: "diseno" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Nueva líder", rol: "admin" }, knownRoutes), "/inicio");
  assert.equal(getDefaultUserRoute({ usuario: "Augusto", rol: "diseno" }, knownRoutes), "/inicio");
});
