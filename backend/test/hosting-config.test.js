import test from "node:test";
import assert from "node:assert/strict";
import { shouldSetupDemoData } from "../src/hosting-config.js";
import { readFileSync } from "node:fs";

test("no se activa el seed demo en producción salvo que se indique explícitamente", () => {
  const previousEnv = process.env;

  try {
    process.env = { ...previousEnv, NODE_ENV: "production", SETUP_DEMO_DATA: "false" };
    assert.equal(shouldSetupDemoData(), false);

    process.env = { ...previousEnv, NODE_ENV: "production", SETUP_DEMO_DATA: "true" };
    assert.equal(shouldSetupDemoData(), true);

    process.env = { ...previousEnv, NODE_ENV: "development" };
    delete process.env.SETUP_DEMO_DATA;
    assert.equal(shouldSetupDemoData(), true);
  } finally {
    process.env = previousEnv;
  }
});

test("Hostinger aplica migraciones antes de iniciar el servidor", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.equal(
    packageJson.scripts["start:hostinger"],
    "npm run migrate --prefix backend && node backend/src/server.js",
  );
  assert.match(server, /await runMigrations\(pool\)/);
});
