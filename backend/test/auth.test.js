import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import { requireAuthentication, requireRole } from "../src/auth.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("requireAuthentication rechaza solicitudes anónimas y tokens inválidos", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret";
  try {
    const anonymousResponse = responseRecorder();
    requireAuthentication({ headers: {} }, anonymousResponse, () => assert.fail("No debe continuar"));
    assert.equal(anonymousResponse.statusCode, 401);

    const invalidResponse = responseRecorder();
    requireAuthentication({ headers: { authorization: "Bearer incorrecto" } }, invalidResponse, () => assert.fail("No debe continuar"));
    assert.equal(invalidResponse.statusCode, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("requireAuthentication incorpora la identidad firmada", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret";
  try {
    const token = jwt.sign({ id: 7, usuario: "persona", rol: "diseno" }, process.env.JWT_SECRET);
    const request = { headers: { authorization: `Bearer ${token}` } };
    let continued = false;
    requireAuthentication(request, responseRecorder(), () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(request.auth.id, 7);
    assert.equal(request.auth.rol, "diseno");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("requireRole distingue empleado y administrador", () => {
  const denied = responseRecorder();
  requireRole("admin")({ auth: { rol: "diseno" } }, denied, () => assert.fail("No debe continuar"));
  assert.equal(denied.statusCode, 403);

  let continued = false;
  requireRole("admin")({ auth: { rol: "admin" } }, responseRecorder(), () => { continued = true; });
  assert.equal(continued, true);
});
