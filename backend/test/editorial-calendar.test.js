import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialSlots, normalizeEditorialPeriod } from "../src/editorial-calendar.js";

test("distribuye cuotas sin superar cinco publicaciones por día", () => {
  const slots = buildEditorialSlots({ period: "2026-09", clients: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, nombre: `Cliente ${index}`, activo: true, cuota_reels: 4, cuota_carruseles: 4 })) });
  assert.equal(slots.length, 40);
  const totals = new Map();
  slots.forEach((slot) => totals.set(slot.fecha_programada, (totals.get(slot.fecha_programada) || 0) + 1));
  assert.ok([...totals.values()].every((total) => total <= 5));
});

test("respeta varios días preferidos y la ocupación fija", () => {
  const slots = buildEditorialSlots({ period: "2026-08", clients: [{ id: 7, nombre: "Bunker", activo: true, cuota_reels: 4, cuota_carruseles: 0, dias_reels: [2, 5] }], occupied: Array.from({ length: 5 }, (_, id) => ({ id, fecha_programada: "2026-08-04" })) });
  assert.ok(slots.every((slot) => [2, 5].includes(new Date(`${slot.fecha_programada}T00:00:00Z`).getUTCDay())));
  assert.ok(slots.every((slot) => slot.fecha_programada !== "2026-08-04"));
});

test("gastronomía prefiere domingos sin configuración", () => {
  const slots = buildEditorialSlots({ period: "2026-08", clients: [{ id: 1, nombre: "Pope", rubro: "Gastronomía", activo: true, cuota_reels: 2, cuota_carruseles: 0 }] });
  assert.ok(slots.every((slot) => new Date(`${slot.fecha_programada}T00:00:00Z`).getUTCDay() === 0));
});

test("rechaza períodos inválidos", () => assert.throws(() => normalizeEditorialPeriod("agosto"), /AAAA-MM/));
