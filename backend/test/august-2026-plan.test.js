import test from "node:test";
import assert from "node:assert/strict";
import { augustPublishingDates, buildAugust2026Plan, summarizeAugustPlan } from "../src/august-2026-plan.js";

test("el plan de agosto respeta cuotas, formatos y exclusiones", () => {
  const plan = buildAugust2026Plan();
  const summary = summarizeAugustPlan(plan);
  assert.deepEqual(summary, { total: 112, videos: 76, carousels: 36, withIdea: 15, withoutIdea: 21, maxPerDay: 5 });
  assert.equal(plan.some((row) => /EOS|Cristal/i.test(row.client)), false);
  assert.equal(plan.filter((row) => row.client === "Lavalle Hortícola" && row.type === "video").length, 8);
  assert.equal(plan.filter((row) => row.client === "Lavalle Market" && row.type === "video").length, 8);
});

test("todas las fechas van del 5 al 31 y excluyen domingos", () => {
  const allowed = new Set(augustPublishingDates());
  for (const row of buildAugust2026Plan()) {
    assert.equal(allowed.has(row.date), true, row.date);
    assert.notEqual(new Date(`${row.date}T00:00:00Z`).getUTCDay(), 0);
  }
});

test("los responsables respetan el flujo simple acordado", () => {
  const plan = buildAugust2026Plan();
  assert.equal(plan.filter((row) => row.type === "video").every((row) => row.assignee === "Líder"), true);
  assert.equal(plan.filter((row) => row.type === "carrusel" && row.client === "RPM Chevrolet").every((row) => row.assignee === "Mariano"), true);
  assert.equal(plan.filter((row) => row.type === "carrusel" && row.client === "Moketa").every((row) => row.assignee === "Augusto"), true);
});
