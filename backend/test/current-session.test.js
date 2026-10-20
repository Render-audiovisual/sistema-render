import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issueUserToken } from '../src/auth.js';
import { createAuthenticatedApiFetch } from '../../frontend/src/shared/session/api-fetch.js';
import { parseServerIdentity, parseCurrentSession, transportLogout, logoutCurrentSession } from "../../frontend/src/shared/session/current-session.js";

const usuario = { id: 17, usuario: "Agustin", nombre: "Agustín", rol: "admin", foto_perfil: null };
const session = { token: 'fictional', usuario };

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
  const promise = logoutCurrentSession({ session, readSession: () => session, fetchImpl: () => new Promise((resolve) => { finish = resolve; }),
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
  await logoutCurrentSession({ session, readSession: () => session, fetchImpl: async () => { events.push("post"); return { ok: true, json: async () => ({ ok: true }) }; },
    clear: () => events.push("clear"), navigate: () => events.push("navigate"), reportFailure: () => assert.fail("confirmed"),
  });
  assert.deepEqual(events, ["post", "clear", "navigate"]);
});

test('obsolete logout results cannot erase or redirect a newer account, login or changed role', async () => {
  for (const replacement of [null, { ...session, token: 'new-login' },
    { ...session, usuario: { ...usuario, id: 18 } },
    { ...session, usuario: { ...usuario, rol: 'edicion' } }]) {
    for (const status of [200, 401, 503]) {
      let live = session, finish;
      const events = [];
      const pending = logoutCurrentSession({ session, readSession: () => live,
        fetchImpl: () => new Promise(resolve => { finish = resolve; }),
        clear: () => events.push('clear'), navigate: () => events.push('navigate'), reportFailure: () => events.push('report') });
      live = replacement;
      finish({ ok: status === 200, status, json: async () => ({ ok: true }) });
      assert.equal((await pending).revoked, status === 200);
      assert.deepEqual(events, []);
      assert.equal(live, replacement);
    }
  }
});

test('obsolete logout timeout and unreadable current storage have no local side effects', async () => {
  for (const unreadable of [false, true]) {
    let changed = false;
    const pending = logoutCurrentSession({ session, timeoutMs: 10,
      readSession: () => { if (changed && unreadable) throw Error('storage'); return changed ? null : session; },
      fetchImpl: () => new Promise(() => {}), clear: () => assert.fail('clear'),
      navigate: () => assert.fail('navigate'), reportFailure: () => assert.fail('report') });
    changed = true;
    assert.equal((await pending).reason, 'timeout');
  }
});

test('session change during failure notification is rechecked before cleanup', async () => {
  let live = session;
  await logoutCurrentSession({ session, readSession: () => live,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    reportFailure: () => { live = { ...session, token: 'new-login' }; },
    clear: () => assert.fail('must keep new login'), navigate: () => assert.fail('must not redirect') });
  assert.equal(live.token, 'new-login');
});

test('missing or already obsolete logout context cannot send a request', async () => {
  const callbacks = { fetchImpl: () => assert.fail('no transport'), clear: () => assert.fail('clear'),
    navigate: () => assert.fail('navigate'), reportFailure: () => assert.fail('report') };
  assert.equal((await logoutCurrentSession({ ...callbacks })).reason, 'missing_session');
  assert.equal((await logoutCurrentSession({ ...callbacks, session, readSession: () => null })).reason, 'obsolete_session');
});

test('actual same-second issued credentials fence both late logout and late unauthorized transport', async () => {
  const originalNow = Date.now;
  let first, second;
  try {
    Date.now = () => 1800000000000;
    const account = { ...usuario, activo: true, session_version: 1 };
    first = issueUserToken(account, 'synthetic-race-test-secret');
    second = issueUserToken(account, 'synthetic-race-test-secret');
  } finally { Date.now = originalNow; }
  assert.ok(first !== second, 'Fresh credentials must differ without logging either');
  let raw = JSON.stringify({ token: first, usuario }), finishLogout, finishRead;
  const readSession = () => parseCurrentSession(raw);
  const storage = { getItem: () => raw, removeItem: () => assert.fail('must preserve newer session') };
  const fetch = createAuthenticatedApiFetch({ storage,
    location: { pathname: '/inicio', replace: () => assert.fail('must not redirect') },
    fetchImpl: () => new Promise(resolve => { finishRead = resolve; }) });
  const logout = logoutCurrentSession({ session: readSession(), readSession,
    fetchImpl: () => new Promise(resolve => { finishLogout = resolve; }),
    clear: () => assert.fail('must not clear'), navigate: () => assert.fail('must not navigate'),
    reportFailure: () => assert.fail('obsolete failure must remain silent') });
  const read = fetch('/api/inicio');
  raw = JSON.stringify({ token: second, usuario });
  finishLogout({ ok: false, status: 401 });
  finishRead(new Response('{}', { status: 401 }));
  assert.equal((await logout).revoked, false);
  assert.equal((await read).status, 401);
  assert.ok(readSession().token === second, 'Current login must survive both obsolete results');
});

test("utils delegates identity/logout and no longer rewrites Agustin to Lider", () => {
  const source = readFileSync(new URL("../../frontend/src/utils.jsx", import.meta.url), "utf8");
  const sessionCode = source.slice(source.indexOf("export function getSesion"), source.indexOf("export function getSectorTarea"));
  assert.match(sessionCode, /parseCurrentSession/);
  assert.match(sessionCode, /export async function cerrarSesion/);
  assert.match(sessionCode, /logoutCurrentSession/);
  assert.doesNotMatch(sessionCode, /usuario: "lider"|nombre: "Líder"/);
});
