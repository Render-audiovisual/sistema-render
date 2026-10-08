import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialSlots, normalizeEditorialPeriod, reconcileEditorialCalendar } from "../src/editorial-calendar.js";

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

test("al bajar una cuota conserva publicaciones con tareas y cuenta únicamente los espacios eliminados", async () => {
  const existing = [1, 2].map((id) => ({ id, cliente_id: 7, tipo: "video", estado: "pendiente",
    fecha_programada: "2026-10-10", origen_calendario: "automatico", calendario_clave: `7:video:${id}`, fecha_bloqueada: false }));
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [{ id: 7, nombre: "Cliente", activo: true, cuota_reels: 0, cuota_carruseles: 0 }] };
    if (calls.length === 2) return { rows: existing };
    // The database returns only the empty slot: publication 1 has a task.
    assert.match(sql, /DELETE FROM publicaciones AS publication/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM tareas task WHERE task\.publicacion_id = publication\.id\)/);
    assert.match(sql, /RETURNING publication\.id/);
    assert.deepEqual(params, [[1, 2]]);
    return { rows: [{ id: 2 }] };
  } };
  const result = await reconcileEditorialCalendar(db, "2026-10");
  assert.equal(calls.length, 3);
  assert.equal(result.eliminadas, 1);
  assert.equal(result.preservadas, 1);
  assert.equal(result.creadas, 0);
});
