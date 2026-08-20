import test from "node:test";
import assert from "node:assert/strict";
import { shouldSendWilsonDigest, wilsonPeriod } from "../src/wilson-chat.js";

test("el período de Wilson usa el mes de Argentina", () => {
  assert.equal(wilsonPeriod(new Date("2026-09-01T02:00:00Z")), "2026-08");
});

test("viernes a las 10 genera un control semanal", () => {
  assert.deepEqual(shouldSendWilsonDigest(new Date("2026-08-21T13:00:00Z")), { date: "2026-08-21", type: "semanal" });
});

test("el día 28 que también es viernes combina ambos controles", () => {
  assert.deepEqual(shouldSendWilsonDigest(new Date("2026-08-28T13:00:00Z")), { date: "2026-08-28", type: "semanal_mensual" });
});
