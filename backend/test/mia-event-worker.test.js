import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
