import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClientOverviewLoader } from "./clientOverview.js";

// Only injected fetch/body promises; no window, mounted page, server or DB.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function transport() {
  const calls = [];
  const request = (url, options) => {
    const pending = deferred();
    calls.push({ ...pending, url, options, jsonCalls: 0 });
    return pending.promise; // Deliberately ignores AbortSignal.
  };
  return { calls, loader: createClientOverviewLoader(request) };
}
function respond(call, data = [], { ok = true, body } = {}) {
  call.resolve({ ok, json() { call.jsonCalls++; return body ? body.promise : Promise.resolve(data); } });
}
function finish(calls, offset, prefix) {
  const values = [[{ id: `${prefix}-cliente` }], [{ id: `${prefix}-historia` }], [{ id: `${prefix}-publicacion` }]];
  values.forEach((value, index) => respond(calls[offset + index], value));
  return { clientes: values[0], historias: values[1], publicaciones: values[2] };
}
async function boundedRejection(promise) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof Error);
    assert.ok(typeof error.message === "string" && error.message.length > 0 && error.message.length <= 240, "Current loader errors must be bounded");
    return true;
  });
}
async function microtasks() { for (let index = 0; index < 5; index++) await Promise.resolve(); }

test("valid boundary periods fetch exactly the three editorial resources with one shared signal and no tasks", async () => {
  const { calls, loader } = transport();
  for (const period of ["1000-01", "2026-10", "9999-12"]) {
    const offset = calls.length, result = loader.load(period), batch = calls.slice(offset);
    assert.deepEqual(batch.map(call => call.url), [`/api/clientes?periodo=${period}`, "/api/historias", "/api/publicaciones"]);
    assert.equal(batch[0].options.signal, batch[1].options.signal);
    assert.equal(batch[0].options.signal, batch[2].options.signal);
    assert.equal(batch[0].options.signal.aborted, false);
    for (const call of batch) assert.equal(call.options.method, undefined, "Default GET, never mutation");
    const expected = finish(calls, offset, period);
    assert.deepEqual(await result, expected);
  }
  assert.equal(calls.some(call => /tareas/.test(call.url)), false);
  loader.cancel();
});

test("invalid periods reject before new fetch: exact YYYY-MM, years1000..9999 and months01..12 only", async () => {
  const { calls, loader } = transport();
  for (const value of [undefined, null, 202610, {}, [], "", " ", "0999-12", "0000-01", "10000-01", "2026-00", "2026-13", "2026-1", "26-10", "2026-10-01", " 2026-10", "2026-10 ", "2026-10\n", "2026-10?otro=1"]) {
    await boundedRejection(loader.load(value));
    assert.equal(calls.length, 0);
  }
});

test("invalid new period still aborts and invalidates an older pending load before rejecting, without new requests", async () => {
  for (const staleFailure of [false, true]) {
    const { calls, loader } = transport();
    const old = loader.load("2026-10");
    await boundedRejection(loader.load("2026-13"));
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.options.signal.aborted));
    if (staleFailure) {
      calls[0].reject(new Error("obsolete transport failure"));
      respond(calls[1]); respond(calls[2]);
    } else finish(calls, 0, "obsolete");
    assert.equal(await old, undefined);
  }
});

test("out-of-order periods only resolve the current bundle even when old fetch ignores abort", async () => {
  const { calls, loader } = transport();
  const october = loader.load("2026-10"), november = loader.load("2026-11");
  assert.ok(calls.slice(0, 3).every(call => call.options.signal.aborted));
  assert.ok(calls.slice(3, 6).every(call => !call.options.signal.aborted));
  assert.notEqual(calls[0].options.signal, calls[3].options.signal);
  const current = finish(calls, 3, "november");
  assert.deepEqual(await november, current);
  finish(calls, 0, "october");
  assert.equal(await october, undefined);
  assert.equal(calls.length, 6, "No retry or extra task fetch");
});

test("bundle remains all-or-nothing until all three successful response bodies are arrays", async () => {
  const { calls, loader } = transport();
  const bodies = [deferred(), deferred(), deferred()];
  let settled = false;
  const pending = loader.load("2026-10").then(value => { settled = true; return value; });
  calls.forEach((call, index) => respond(call, undefined, { body: bodies[index] }));
  bodies[0].resolve([{ id: "client" }]); bodies[1].resolve([]);
  await microtasks(); assert.equal(settled, false);
  bodies[2].resolve([{ id: "publication" }]);
  assert.deepEqual(await pending, { clientes: [{ id: "client" }], historias: [], publicaciones: [{ id: "publication" }] });
  assert.deepEqual(calls.map(call => call.jsonCalls), [1, 1, 1]);
});

test("each HTTP failure rejects the current bundle without parsing its body or fabricating partial success", async () => {
  for (let failed = 0; failed < 3; failed++) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    calls.forEach((call, index) => respond(call, [], { ok: index !== failed }));
    await checked;
    assert.equal(calls[failed].jsonCalls, 0);
    assert.equal(calls.length, 3);
  }
});

test("non-array bodies and malformed response objects cannot resolve as a successful bundle", async () => {
  for (const body of [null, {}, { error: "business error" }, "[]", false, 0]) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    respond(calls[0], []); respond(calls[1], body); respond(calls[2], []);
    await checked;
  }
  for (const response of [undefined, null, {}, { ok: true }, { ok: true, json: "not a function" }]) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    calls[0].resolve(response); respond(calls[1]); respond(calls[2]);
    await checked;
  }
});

test("malformed current JSON rejects with bounded error, never a transport-sized body diagnostic", async () => {
  const { calls, loader } = transport(), body = deferred();
  const pending = loader.load("2026-10"), checked = boundedRejection(pending);
  respond(calls[0], undefined, { body }); respond(calls[1]); respond(calls[2]);
  body.reject(new SyntaxError("malformed raw JSON: " + "x".repeat(5000)));
  await checked;
});

test("obsolete body success or failure resolves undefined after current load succeeds", async () => {
  for (const fail of [false, true]) {
    const { calls, loader } = transport(), body = deferred();
    const old = loader.load("2026-10");
    respond(calls[0], undefined, { body }); respond(calls[1]); respond(calls[2]);
    await microtasks();
    const current = loader.load("2026-11"), expected = finish(calls, 3, "current");
    assert.deepEqual(await current, expected);
    if (fail) body.reject(new SyntaxError("obsolete JSON failure")); else body.resolve([{ id: "old-client" }]);
    assert.equal(await old, undefined);
    assert.equal(calls.length, 6);
  }
});

test("stale transport failures are ignored without swallowing current failures or retrying", async () => {
  const { calls, loader } = transport();
  const old = loader.load("2026-10"), current = loader.load("2026-11");
  const checked = boundedRejection(current);
  calls[0].reject(new Error("old fetch failure")); respond(calls[1]); respond(calls[2]);
  assert.equal(await old, undefined);
  respond(calls[3]); calls[4].reject(new Error("current fetch failure")); respond(calls[5]);
  await checked;
  assert.equal(calls.length, 6);
});

test("cancel is reusable across pending fetch/body reads; later load and explicit retry can succeed", async () => {
  const { calls, loader } = transport();
  const first = loader.load("2026-10"); loader.cancel(); loader.cancel();
  assert.ok(calls.every(call => call.options.signal.aborted));
  finish(calls, 0, "canceled"); assert.equal(await first, undefined);
  const body = deferred(), second = loader.load("2026-11");
  respond(calls[3], undefined, { body }); respond(calls[4]); respond(calls[5]);
  await microtasks(); loader.cancel(); body.resolve([]);
  assert.equal(await second, undefined);
  const failed = loader.load("2026-12"), checked = boundedRejection(failed);
  respond(calls[6], [], { ok: false }); respond(calls[7]); respond(calls[8]); await checked;
  const retry = loader.load("2026-12"), expected = finish(calls, 9, "retry");
  assert.deepEqual(await retry, expected);
  assert.equal(calls.length, 12);
});

test("Clientes integrates loader cleanup/current-bundle commit and never equates task completion with publication", () => {
  const page = readFileSync(new URL("./Clientes.jsx", import.meta.url), "utf8");
  assert.match(page, /import \{ createClientOverviewLoader \} from "\.\/clientOverview\.js"/);
  assert.match(page, /createClientOverviewLoader\(/);
  assert.match(page, /overviewLoader\.current\.load\(mesSeleccionado\)/);
  assert.match(page, /if \(!data\) return;[\s\S]*?setClientes\(data\.clientes\);[\s\S]*?setHistorias\(data\.historias\);[\s\S]*?setPublicaciones\(data\.publicaciones\)/);
  assert.match(page, /return \(\) => \{[\s\S]*?clearInterval\(intervalo\);[\s\S]*?removeEventListener\("visibilitychange", alVolverVisible\);[\s\S]*?overviewLoader\.current\.cancel\(\)/);
  assert.doesNotMatch(page, /tareasFinalizadas|\/api\/tareas|checklist\s*OK/i);
  assert.match(page, /getResumenClientes/);
});
