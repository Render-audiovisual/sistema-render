import assert from "node:assert/strict";
import test from "node:test";
import { buildWilsonTask, findWilsonDuplicates, normalizeWilsonText, requireWilsonService } from "../src/wilson-integration.js";

const catalog = {
  clients: [{ id: 11, nombre: "Búnker Training" }],
  users: [{ id: 7, usuario: "Luciano", nombre: "Luciano", rol: "edicion" }],
};

test("Wilson normaliza una tarea confirmable sin inventar valores", () => {
  const result = buildWilsonTask({
    titulo: "Bunker | Edición reel | Rutina de piernas | Entrega 07/08",
    cliente: "Bunker Training", responsable: "luciano", fecha_vencimiento: "2026-08-07",
    lista: "Edición", material: "https://drive.test/material", referencia: "https://instagram.test/reel",
  }, catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.task.cliente_id, 11);
  assert.equal(result.task.asignado_a, "Luciano");
  assert.equal(result.task.tipo_tarea, "edicion");
  assert.equal(result.task.estado, "pendiente");
  assert.equal(result.task.prioridad, "media");
});

test("Wilson exige cliente, responsable, fecha y sector reales", () => {
  const result = buildWilsonTask({ titulo: "Incompleta", cliente: "Otro", responsable: "Nadie" }, catalog);
  assert.equal(result.task, null);
  assert.equal(result.errors.length, 4);
});

test("Wilson detecta tareas con el mismo material o contexto operativo", () => {
  const duplicates = findWilsonDuplicates({
    titulo: "Bunker edición reel rutina piernas", asignado_a: "Luciano", fecha_vencimiento: "2026-08-07",
    tipo_tarea: "edicion", material_referencia: "https://drive.test/material",
  }, [{
    id: 99, titulo: "Búnker edición reel rutina piernas", asignado_a: "Luciano",
    fecha_vencimiento: "2026-08-07", tipo_tarea: "edicion", material_referencia: "https://drive.test/material",
    cliente_nombre: "Búnker Training", estado: "pendiente",
  }]);
  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0].url, /task=99/);
});

test("la API técnica valida token e ID autorizado de Telegram", () => {
  const middleware = requireWilsonService({ WILSON_API_TOKEN: "token-seguro", WILSON_ALLOWED_TELEGRAM_IDS: "111,222" });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const denied = response();
  middleware({ headers: { authorization: "Bearer token-seguro", "x-telegram-user-id": "999" }, body: {} }, denied, () => assert.fail());
  assert.equal(denied.statusCode, 403);
  let continued = false;
  const request = { headers: { authorization: "Bearer token-seguro", "x-telegram-user-id": "111" }, body: {} };
  middleware(request, response(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(request.wilson.telegramUserId, "111");
});

test("normaliza acentos en nombres del sistema", () => {
  assert.equal(normalizeWilsonText(" BÚNKER Training "), "bunker training");
});
