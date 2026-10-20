import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { buildWilsonSignatureMessage } from "../src/wilson-integration.js";

function runClient(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/mia_render_os_task.py", ...args], { env: { ...process.env, ...env } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}

test("el cliente sombra firma identidad, grupo, confirmación e idempotencia sin tocar producción", async (context) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mia-shadow-"));
  const keyPath = path.join(tempDir, "private.pem");
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString();
      const body = rawBody ? JSON.parse(rawBody) : undefined;
      const url = new URL(req.url, "http://127.0.0.1");
      const message = buildWilsonSignatureMessage({
        timestamp: req.headers["x-wilson-timestamp"], nonce: req.headers["x-wilson-nonce"],
        channel: req.headers["x-wilson-channel"], actorId: req.headers["x-wilson-actor-id"],
        groupId: req.headers["x-wilson-group-id"], actorName: req.headers["x-wilson-actor-name"],
        method: req.method, path: req.url, body,
      });
      const valid = crypto.verify("sha256", Buffer.from(message), publicKey, Buffer.from(req.headers["x-wilson-signature"], "base64"));
      received.push({ req, body, valid });
      res.writeHead(200, { "content-type": "application/json" });
      const tokenResponse = url.pathname.endsWith("/confirmaciones") || url.pathname.endsWith("/lotes/revision/previsualizar");
      res.end(JSON.stringify(tokenResponse
        ? { confirmacion_token: `token-${received.length}` }
        : { shadow: true }));
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      fs.rmSync(tempDir, { recursive: true, force: true });
      context.skip("el sandbox no permite abrir un servidor HTTP local");
      return;
    }
    throw error;
  }
  const port = server.address().port;
  const env = {
    RENDER_OS_API_URL: `http://127.0.0.1:${port}/api/integraciones/wilson`,
    RENDER_OS_PRIVATE_KEY_PATH: keyPath,
    MIA_WHATSAPP_ACTOR_ID: "actor-qa", MIA_WHATSAPP_ACTOR_NAME: "Usuario QA",
    MIA_WHATSAPP_GROUP_ID: "grupo-render-qa",
  };
  try {
    const createPayload = JSON.stringify({ titulo: "Tarea QA" });
    const createProposal = await runClient(["propose", "--operation", "crear", "--payload", createPayload, "--idempotency-key", " mensaje-qa-1 "], env);
    await runClient(["create", "--payload", createPayload, "--confirmation-token", createProposal.confirmacion_token, "--idempotency-key", "mensaje-qa-1"], env);
    const archiveProposal = await runClient(["propose", "--operation", "archivar", "--task-id", "42", "--payload", JSON.stringify({ expected_revision: 7 }), "--idempotency-key", "mensaje-qa-2"], env);
    await runClient(["archive", "--task-id", "42", "--expected-revision", "7", "--confirmation-token", archiveProposal.confirmacion_token, "--idempotency-key", "mensaje-qa-2"], env);
    await runClient(["resolve-review", "--references", JSON.stringify(["Luzin Carrusel 1"])], env);
    const reviewProposal = await runClient(["preview-review", "--task-ids", JSON.stringify([71, 72])], env);
    await runClient(["confirm-review", "--confirmation-token", reviewProposal.confirmacion_token], env);
    await runClient(["fast-context", "--person", "Germán"], env);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  assert.equal(received.length, 8);
  assert.ok(received.every((entry) => entry.valid));
  assert.ok(received.every((entry) => entry.req.headers["x-wilson-signature-version"] === "2"));
  for (const { req } of received) {
    assert.equal(req.headers["x-wilson-channel"], "whatsapp");
    assert.equal(req.headers["x-wilson-actor-id"], "actor-qa");
    assert.equal(req.headers["x-wilson-actor-name"], "Usuario QA");
    assert.equal(req.headers["x-wilson-group-id"], "grupo-render-qa");
  }
  assert.equal(new Set(received.map(({ req }) => req.headers["x-wilson-nonce"])).size, 8);
  assert.deepEqual(received.filter((entry) => entry.req.url.endsWith("/confirmaciones")).map((entry) => entry.body.operacion), ["crear", "archivar"]);
  assert.deepEqual(received.filter((entry) => entry.req.headers["idempotency-key"] && !entry.req.url.endsWith("/confirmaciones"))
    .map((entry) => entry.body.confirmacion_token), ["token-1", "token-3"]);
  assert.deepEqual(received.filter((entry) => entry.req.headers["idempotency-key"]).map((entry) => entry.req.headers["idempotency-key"]), ["mensaje-qa-1", "mensaje-qa-1", "mensaje-qa-2", "mensaje-qa-2"]);
  assert.deepEqual(received.slice(0, 4).map(({ req }) => [req.method, req.url]), [
    ["POST", "/api/integraciones/wilson/confirmaciones"],
    ["POST", "/api/integraciones/wilson/tareas"],
    ["POST", "/api/integraciones/wilson/confirmaciones"],
    ["POST", "/api/integraciones/wilson/tareas/42/archivar"],
  ]);
  assert.deepEqual(received[0].body, { operacion: "crear", tarea_id: null,
    payload: { titulo: "Tarea QA", idempotency_key: "mensaje-qa-1" } });
  assert.deepEqual(received[2].body, { operacion: "archivar", tarea_id: 42,
    payload: { expected_revision: 7, idempotency_key: "mensaje-qa-2" } });
  for (const [proposal, mutation, token] of [[received[0], received[1], "token-1"], [received[2], received[3], "token-3"]]) {
    const { confirmacion_token, ...intention } = mutation.body;
    assert.equal(confirmacion_token, token);
    assert.deepEqual(intention, proposal.body.payload, "La intención firmada debe ser idéntica entre propuesta y confirmación");
    assert.equal(intention.idempotency_key, proposal.req.headers["idempotency-key"]);
    assert.equal(intention.idempotency_key, mutation.req.headers["idempotency-key"]);
    assert.equal(Object.hasOwn(mutation.body, "confirmado"), false);
  }
  assert.equal(Object.hasOwn(received[1].body, "expected_revision"), false);
  assert.equal(received[3].body.expected_revision, 7);
  assert.deepEqual(received.slice(4).map((entry) => entry.req.url), [
    "/api/integraciones/wilson/tareas/resolver-revision",
    "/api/integraciones/wilson/lotes/revision/previsualizar",
    "/api/integraciones/wilson/lotes/revision/confirmar",
    "/api/integraciones/wilson/contexto-rapido?persona=Germ%C3%A1n",
  ]);
  assert.deepEqual(received[4].body.referencias, ["Luzin Carrusel 1"]);
  assert.deepEqual(received[5].body.task_ids, [71, 72]);
  assert.equal(received[6].body.confirmacion_token, "token-6");
});
