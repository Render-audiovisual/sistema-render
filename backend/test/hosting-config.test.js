import test from "node:test";
import assert from "node:assert/strict";
import { shouldSetupDemoData } from "../src/hosting-config.js";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("demo nunca se activa en producción ni por defecto; true local es solo compatibilidad legacy", () => {
  const previousEnv = process.env;

  try {
    process.env = { ...previousEnv, NODE_ENV: "production", SETUP_DEMO_DATA: "false" };
    assert.equal(shouldSetupDemoData(), false);

    process.env = { ...previousEnv, NODE_ENV: "production", SETUP_DEMO_DATA: "true" };
    assert.equal(shouldSetupDemoData(), false);

    for (const mode of [undefined, "development", "test", "production"]) {
      process.env = { NODE_ENV: mode };
      assert.equal(shouldSetupDemoData(), false);
      for (const value of ["false", "", "TRUE", "1"]) {
        process.env.SETUP_DEMO_DATA = value;
        assert.equal(shouldSetupDemoData(), false);
      }
      process.env.SETUP_DEMO_DATA = "true";
      assert.equal(shouldSetupDemoData(), mode !== "production");
    }
  } finally {
    process.env = previousEnv;
  }
});

test("start y Hostinger no encadenan migraciones, instalación ni seeds", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const backend = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    packageJson.scripts["start:hostinger"],
    "node backend/src/server.js",
  );
  assert.equal(backend.scripts.start, "node src/server.js");
  assert.equal(packageJson.scripts.start, "npm start --prefix backend");
  assert.equal(packageJson.scripts.migrate, "node backend/scripts/migrate.js");
  assert.equal(backend.scripts.migrate, "node scripts/migrate.js");
  assert.equal(backend.scripts.setup, "node scripts/setup-disabled.js");
});

test("setup heredado falla sin importar DB ni ejecutar comandos", () => {
  const path = new URL("../scripts/setup-disabled.js", import.meta.url);
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /(?:import\s*\(|import\s+.*from|require\(|child_process|dotenv)/);
  const result = spawnSync(process.execPath, [fileURLToPath(path)], { encoding: "utf8", env: {}, timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Setup automático deshabilitado/);
});
