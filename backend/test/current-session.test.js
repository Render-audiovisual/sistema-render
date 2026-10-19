import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseServerIdentity, parseCurrentSession, transportLogout, logoutCurrentSession } from "../../frontend/src/shared/session/current-session.js";

const usuario = { id: 17, usuario: "Agustin", nombre: "Agustín", rol: "admin", foto_perfil: null };

test("preserves exact server identity, role and stable ID without leader rewrite", () => {
  assert.deepEqual(parseServerIdentity(usuario), usuario);
  assert.deepEqual(parseCurrentSession(JSON.stringify({ token: "fictional", usuario })), { token: "fictional", usuario });
  assert.equal(parseServerIdentity({ ...usuario, id: "017", nombre: " Agustín " }).id, "017");
  assert.equal(parseServerIdentity({ ...usuario, nombre: " Agustín " }).nombre, " Agustín ");
  assert.equal(parseServerIdentity({ ...usuario, rol: "diseno" }).rol, "diseno");
});

test("rejects malformed, pre-ID and incomplete identities without inventing defaults", () => {
  for (const raw of [null, "broken", "null", "[]", "{}", JSON.stringify({ token: "fictional", usuario: { nombre: "Agustín" } }), JSON.stringify({ token: {}, usuario })]) {
    assert.equal(parseCurrentSession(raw), null);
  }
  for (const id of [undefined, null, 0, -1, {}, [], "", NaN]) assert.equal(parseServerIdentity({ ...usuario, id }), null);
  for (const key of ["usuario", "nombre", "rol"]) assert.equal(parseServerIdentity({ ...usuario, [key]: {} }), null);
});

test("logout posts bearer to fixed API path and requires confirmed success", async () => {
  const result = await transportLogout({ token: "fictional", fetchImpl: async (url, options) => {
    assert.equal(url, "/api/logout");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer fictional");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  assert.deepEqual(result, { revoked: true });
});

test("offline, unauthorized and unconfirmed responses never claim revocation", async () => {
  for (const fetchImpl of [
    async () => { throw Error("offline"); },
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: false, status: 500 }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw Error("bad JSON"); } }),
  ]) assert.equal((await transportLogout({ token: "fictional", fetchImpl })).revoked, false);
  assert.equal((await transportLogout({ fetchImpl: () => assert.fail("no token") })).reason, "missing_token");
});

test("finite timeout covers ignored abort and stalled response bodies", async () => {
  for (const stallBody of [false, true]) {
    let signal;
    const result = await transportLogout({ token: "fictional", timeoutMs: 10, fetchImpl: async (_url, options) => {
      signal = options.signal;
      const stalled = new Promise(() => {});
      return stallBody ? { ok: true, json: () => stalled } : stalled;
    } });
    assert.equal(result.reason, "timeout");
    assert.equal(signal.aborted, true);
  }
});

test("waits for server attempt, reports failure before clearing and navigates without rejection", async () => {
  const events = [];
  let finish;
  const promise = logoutCurrentSession({ token: "fictional", fetchImpl: () => new Promise((resolve) => { finish = resolve; }),
    clear: () => events.push("clear"), navigate: () => events.push("navigate"),
    reportFailure: (message) => { assert.match(message, /no se pudo confirmar/); events.push("report"); },
  });
  assert.deepEqual(events, []);
  finish({ ok: false, status: 503 });
  assert.equal((await promise).revoked, false);
  assert.deepEqual(events, ["report", "clear", "navigate"]);
});

test("confirmed logout clears after transport, without false failure notice", async () => {
  const events = [];
  await logoutCurrentSession({ token: "fictional", fetchImpl: async () => { events.push("post"); return { ok: true, json: async () => ({ ok: true }) }; },
    clear: () => events.push("clear"), navigate: () => events.push("navigate"), reportFailure: () => assert.fail("confirmed"),
  });
  assert.deepEqual(events, ["post", "clear", "navigate"]);
});

test("utils delegates identity/logout and no longer rewrites Agustin to Lider", () => {
  const source = readFileSync(new URL("../../frontend/src/utils.jsx", import.meta.url), "utf8");
  const sessionCode = source.slice(source.indexOf("export function getSesion"), source.indexOf("export function getSectorTarea"));
  assert.match(sessionCode, /parseCurrentSession/);
  assert.match(sessionCode, /export async function cerrarSesion/);
  assert.match(sessionCode, /logoutCurrentSession/);
  assert.doesNotMatch(sessionCode, /usuario: "lider"|nombre: "Líder"/);
});
