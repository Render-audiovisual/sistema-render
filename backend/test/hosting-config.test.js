import test from "node:test";
import assert from "node:assert/strict";
import { shouldSetupDemoData } from "../src/hosting-config.js";

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
