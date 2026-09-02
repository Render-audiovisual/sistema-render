import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const script = fileURLToPath(new URL("../../scripts/mia_event_worker.py", import.meta.url));

test("el worker genera un aviso corto con enlace directo", () => {
  const source = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("worker", ${JSON.stringify(script)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(module.format_event({"text":"Grabación lista para confirmar.","task_url":"https://sistema.rendercorrientes.com/workspace/tareas?task=42"}))
`;
  const output = execFileSync("python3", ["-c", source], { encoding: "utf8" });
  assert.equal(output.trim(), "Grabación lista para confirmar.\n\nAbrir tarea: https://sistema.rendercorrientes.com/workspace/tareas?task=42");
});

test("el worker rechaza eventos sin texto", () => {
  const source = `
import importlib.util
spec = importlib.util.spec_from_file_location("worker", ${JSON.stringify(script)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.format_event({"text":""})
except ValueError:
    print("ok")
`;
  const output = execFileSync("python3", ["-c", source], { encoding: "utf8" });
  assert.equal(output.trim(), "ok");
});

test("el worker combina eventos puntuales y resúmenes sin confirmar antes de enviar", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /private-notifications/);
  assert.match(source, /ack-private-notification/);
  assert.match(source, /MIA_PRIVATE_RECIPIENTS_JSON/);
  assert.match(source, /group-digests/);
  assert.match(source, /ack-group-digest/);
  assert.match(source, /if args\.send:/);
});

test("las notificaciones privadas se reservan y deduplican en PostgreSQL", () => {
  const migration = fs.readFileSync(new URL("../migrations/031_mia_private_task_notifications.sql", import.meta.url), "utf8");
  assert.match(migration, /fingerprint CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /estado IN \('pending', 'sending', 'delivered'\)/);
  const integration = fs.readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
  assert.match(integration, /FOR UPDATE SKIP LOCKED/);
  assert.match(integration, /notificaciones-privadas\/:id\/entregada/);
});

test("la deduplicación de resúmenes queda persistida por destino y período", () => {
  const migration = fs.readFileSync(new URL("../migrations/029_mia_group_digests.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mia_group_digest_deliveries/);
  assert.match(migration, /fingerprint CHAR\(64\) PRIMARY KEY/);
  assert.match(migration, /delivered_at TIMESTAMPTZ/);
});
