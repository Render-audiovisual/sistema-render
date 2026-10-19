import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { issueUserToken, requireCurrentIdentity } from "../src/auth.js";

const user = { id: 7, usuario: "qa-editor", nombre: "Editor QA", rol: "edicion", activo: true, session_version: 1 };
const sessionClaims = { id: 7, session_version: 1, iss: "render", aud: "render-api", exp: Math.floor(Date.now() / 1000) + 300 };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

async function check(claims, row = user) {
  const req = { auth: { ...sessionClaims, ...claims } }, res = response();
  let continued = false, error;
  const db = { async query(sql, params) { assert.match(sql, /WHERE id=\$1/); assert.deepEqual(params, [7]); return { rows: row ? [row] : [] }; } };
  await requireCurrentIdentity(db)(req, res, err => { error = err; continued = !err; });
  return { req, res, continued, error };
}

test("current account replaces forged/stale token authority and names", async () => {
  const result = await check({ id: 7, session_version: 1, rol: "admin", nombre: "Franco" });
  assert.equal(result.continued, true);
  assert.equal(result.req.auth.rol, "edicion");
  assert.equal(result.req.auth.nombre, "Editor QA");
});

test("inactive, deleted and revoked accounts fail closed", async () => {
  for (const row of [null, { ...user, activo: false }, { ...user, session_version: 2 }]) {
    const result = await check({ id: 7, session_version: 1 }, row);
    assert.equal(result.continued, false);
    assert.equal(result.res.statusCode, 401);
  }
});

test("legacy tokens, purpose tokens and invalid IDs cannot become user sessions", async () => {
  for (const auth of [{ id: 7 }, { ...sessionClaims, id: "7" }, { ...sessionClaims, id: true }, { id: "7x", session_version: 1 }, { id: 0, session_version: 1 }, { purpose: "drive_upload" }, { id: 7, session_version: "1" }]) {
    const res = response();
    await requireCurrentIdentity({ query() { assert.fail("invalid session must not query DB"); } })({ auth }, res, () => assert.fail());
    assert.equal(res.statusCode, 401);
  }
});

test("database error never falls back to signed roles", async () => {
  const failure = new Error("database unavailable");
  let seen;
  await requireCurrentIdentity({ async query() { throw failure; } })({ auth: { ...sessionClaims, rol: "admin" } }, response(), err => { seen = err; });
  assert.equal(seen, failure);
});

test("new token carries only stable identity/version and expires after eight hours", () => {
  const token = issueUserToken(user, "unit-test-secret-not-used-outside-test");
  const claims = jwt.verify(token, "unit-test-secret-not-used-outside-test", { algorithms: ["HS256"] });
  assert.equal(claims.id, 7);
  assert.equal(claims.session_version, 1);
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  assert.equal(claims.iss, "render");
  assert.equal(claims.aud, "render-api");
  assert.equal(Object.hasOwn(claims, "rol"), false);
  assert.throws(() => issueUserToken({ ...user, activo: false }, "test"));
});

test("wrong purpose, audience and expired claims are not user sessions", async () => {
  for (const extra of [{ iss: "drive" }, { aud: "other-api" }, { exp: 1 }, { exp: undefined }]) {
    const result = await check(extra);
    assert.equal(result.continued, false);
    assert.equal(result.res.statusCode, 401);
  }
});
