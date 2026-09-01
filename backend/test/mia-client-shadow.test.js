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
        method: req.method, path: url.pathname, body,
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
    const createProposal = await runClient(["propose", "--operation", "crear", "--payload", createPayload], env);
    await runClient(["create", "--payload", createPayload, "--confirmation-token", createProposal.confirmacion_token, "--idempotency-key", "mensaje-qa-1"], env);
    const archiveProposal = await runClient(["propose", "--operation", "archivar", "--task-id", "42"], env);
    await runClient(["archive", "--task-id", "42", "--confirmation-token", archiveProposal.confirmacion_token, "--idempotency-key", "mensaje-qa-2"], env);
    await runClient(["resolve-review", "--references", JSON.stringify(["Luzin Carrusel 1"])], env);
    const reviewProposal = await runClient(["preview-review", "--task-ids", JSON.stringify([71, 72])], env);
    await runClient(["confirm-review", "--confirmation-token", reviewProposal.confirmacion_token], env);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  assert.equal(received.length, 7);
  assert.ok(received.every((entry) => entry.valid));
  assert.ok(received.every((entry) => entry.req.headers["x-wilson-signature-version"] === "2"));
  assert.deepEqual(received.filter((entry) => entry.req.url.endsWith("/confirmaciones")).map((entry) => entry.body.operacion), ["crear", "archivar"]);
  assert.deepEqual(received.filter((entry) => !entry.req.url.endsWith("/confirmaciones")).map((entry) => entry.body.confirmacion_token), ["token-1", "token-3"]);
  assert.deepEqual(received.filter((entry) => entry.req.headers["idempotency-key"]).map((entry) => entry.req.headers["idempotency-key"]), ["mensaje-qa-1", "mensaje-qa-2"]);
  assert.deepEqual(received.slice(4).map((entry) => entry.req.url), [
    "/api/integraciones/wilson/tareas/resolver-revision",
    "/api/integraciones/wilson/lotes/revision/previsualizar",
    "/api/integraciones/wilson/lotes/revision/confirmar",
  ]);
  assert.deepEqual(received[4].body.referencias, ["Luzin Carrusel 1"]);
  assert.deepEqual(received[5].body.task_ids, [71, 72]);
  assert.equal(received[6].body.confirmacion_token, "token-6");
});
