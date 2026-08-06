import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidUserRole,
  normalizeUserRole,
  resolveUserRole,
  SYSTEM_USER_ROLES,
} from "../src/user-roles.js";

test("Programación es una categoría laboral disponible para integrantes", () => {
  assert.equal(SYSTEM_USER_ROLES.includes("programacion"), true);
  assert.equal(resolveUserRole("Programación"), "programacion");
});

test("normaliza categorías laborales nuevas sin convertirlas en permisos", () => {
  assert.equal(normalizeUserRole("Desarrollo Web"), "desarrollo_web");
  assert.equal(resolveUserRole("Fotografía y Video"), "fotografia_y_video");
});

test("rechaza categorías vacías o con formato inválido", () => {
  assert.equal(isValidUserRole(""), false);
  assert.equal(resolveUserRole("1"), null);
  assert.equal(resolveUserRole("___"), null);
});
