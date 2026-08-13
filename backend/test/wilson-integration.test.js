import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  appendWilsonDescription,
  buildMiaPendingEvent,
  buildWilsonConfirmationHash,
  buildWilsonSignatureMessage,
  buildWilsonTask,
  buildWilsonTaskUpdate,
  findWilsonDuplicates,
  normalizeWilsonText,
  requireWilsonService,
  validateWilsonConfirmation,
} from "../src/wilson-integration.js";

test("Mia convierte una grabación completa en un evento breve para líderes", () => {
  const event = buildMiaPendingEvent({
    id: 42, titulo: "Visita Moketa",
    propiedades_extra: { mia_notificacion_pendiente: { tipo: "confirmar_grabacion", creado_en: "2026-08-13T10:00:00.000Z" } },
  });
  assert.equal(event.destination, "render_brain");
  assert.match(event.text, /confirmar el traspaso a Edición/);
  assert.match(event.task_url, /task=42/);
});

test("Mia ignora marcadores desconocidos o incompletos", () => {
  assert.equal(buildMiaPendingEvent({ id: 1, propiedades_extra: {} }), null);
  assert.equal(buildMiaPendingEvent({ id: 1, propiedades_extra: { mia_notificacion_pendiente: { tipo: "otro", creado_en: "hoy" } } }), null);
});

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

test("la API técnica valida firma e ID autorizado de Telegram", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = 1785960000000;
  const timestamp = String(now / 1000);
  const headers = { "x-telegram-user-id": "111", "x-wilson-timestamp": timestamp, "x-wilson-nonce": "nonce-prueba" };
  const message = buildWilsonSignatureMessage({ timestamp, nonce: "nonce-prueba", telegramUserId: "111", method: "GET", path: "/api/integraciones/wilson/catalogo", body: undefined });
  headers["x-wilson-signature"] = crypto.sign("sha256", Buffer.from(message), privateKey).toString("base64");
  const middleware = requireWilsonService({ WILSON_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }), WILSON_ALLOWED_TELEGRAM_IDS: "111,222" }, () => now);
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const denied = response();
  middleware({ headers: { ...headers, "x-telegram-user-id": "999" }, body: undefined, method: "GET", baseUrl: "/api/integraciones/wilson", path: "/catalogo" }, denied, () => assert.fail());
  assert.equal(denied.statusCode, 403);
  let continued = false;
  const request = { headers, body: undefined, method: "GET", baseUrl: "/api/integraciones/wilson", path: "/catalogo" };
  middleware(request, response(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(request.wilson.telegramUserId, "111");
});

test("la API técnica de WhatsApp exige usuario y grupo permitidos dentro de la firma", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = 1785960000000;
  const timestamp = String(now / 1000);
  const baseHeaders = {
    "x-wilson-channel": "whatsapp", "x-wilson-actor-id": "persona-1",
    "x-wilson-group-id": "grupo-render", "x-wilson-actor-name": "Augusto",
    "x-wilson-signature-version": "2", "x-wilson-timestamp": timestamp,
  };
  const sign = (nonce, overrides = {}) => {
    const headers = { ...baseHeaders, ...overrides, "x-wilson-nonce": nonce };
    const message = buildWilsonSignatureMessage({
      timestamp, nonce, channel: headers["x-wilson-channel"], actorId: headers["x-wilson-actor-id"],
      groupId: headers["x-wilson-group-id"], actorName: headers["x-wilson-actor-name"],
      method: "GET", path: "/api/integraciones/wilson/catalogo", body: undefined,
    });
    headers["x-wilson-signature"] = crypto.sign("sha256", Buffer.from(message), privateKey).toString("base64");
    return headers;
  };
  const middleware = requireWilsonService({
    WILSON_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
    WILSON_SYSTEM_ACTOR_ID: "mia-system",
    WILSON_WHATSAPP_CONFIG: JSON.stringify({
      allowedIds: ["persona-1", "persona-2"],
      groupIds: ["grupo-render"],
      leaderIds: ["persona-1"],
    }),
  }, () => now);
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const request = { headers: sign("nonce-wa-ok"), body: undefined, method: "GET", baseUrl: "/api/integraciones/wilson", path: "/catalogo" };
  let continued = false;
  middleware(request, response(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(request.wilson.actorName, "Augusto");
  assert.equal(request.wilson.groupId, "grupo-render");

  const internationalRequest = {
    ...request,
    headers: sign("nonce-wa-international", { "x-wilson-actor-id": "+persona-1" }),
  };
  const internationalMiddleware = requireWilsonService({
    WILSON_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
    WILSON_WHATSAPP_CONFIG: JSON.stringify({
      allowedIds: ["persona-1"], groupIds: ["grupo-render"], leaderIds: ["persona-1"],
    }),
  }, () => now);
  let internationalContinued = false;
  internationalMiddleware(internationalRequest, response(), () => { internationalContinued = true; });
  assert.equal(internationalContinued, true);

  const ownerRequest = {
    ...request,
    headers: sign("nonce-wa-owner", { "x-wilson-actor-id": "+5493794141170" }),
  };
  const ownerMiddleware = requireWilsonService({
    WILSON_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
    WILSON_WHATSAPP_CONFIG: JSON.stringify({
      allowedIds: ["persona-2"], groupIds: ["grupo-render"], leaderIds: ["persona-2"],
    }),
  }, () => now);
  let ownerContinued = false;
  ownerMiddleware(ownerRequest, response(), () => { ownerContinued = true; });
  assert.equal(ownerContinued, true);

  const otherGroup = response();
  middleware({ ...request, headers: sign("nonce-wa-other", { "x-wilson-group-id": "grupo-ajeno" }) }, otherGroup, () => assert.fail());
  assert.equal(otherGroup.statusCode, 403);

  const unsignedIdentityChange = response();
  const changedHeaders = { ...sign("nonce-wa-tamper"), "x-wilson-actor-name": "Franco" };
  middleware({ ...request, headers: changedHeaders }, unsignedIdentityChange, () => assert.fail());
  assert.equal(unsignedIdentityChange.statusCode, 401);

  const systemRequest = {
    ...request,
    headers: sign("nonce-wa-system", {
      "x-wilson-actor-id": "mia-system",
      "x-wilson-actor-name": "MIA",
    }),
  };
  let systemContinued = false;
  middleware(systemRequest, response(), () => { systemContinued = true; });
  assert.equal(systemContinued, true);
  assert.equal(systemRequest.wilson.actorName, "MIA");
});

test("las confirmaciones de WhatsApp vencen a los 10 minutos", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");
  assert.equal(validateWilsonConfirmation({ confirmed: true, confirmedAt: "2026-08-10T11:51:00.000Z", now }), null);
  assert.match(validateWilsonConfirmation({ confirmed: true, confirmedAt: "2026-08-10T11:49:59.000Z", now }), /venció/);
  assert.match(validateWilsonConfirmation({ confirmed: false, confirmedAt: "2026-08-10T11:59:00.000Z", now }), /todavía no fue confirmada/);
  assert.match(validateWilsonConfirmation({ confirmed: true, confirmedAt: "sin fecha", now }), /Falta la fecha/);
});

test("la confirmación queda vinculada a operación, tarea y contenido exactos", () => {
  const base = buildWilsonConfirmationHash({ operation: "editar", taskId: 42, payload: { titulo: "Versión aprobada" } });
  assert.equal(base, buildWilsonConfirmationHash({
    operation: "editar", taskId: 42,
    payload: { titulo: "Versión aprobada", confirmacion_token: "token-no-influye", confirmado_en: "otra-fecha" },
  }));
  assert.notEqual(base, buildWilsonConfirmationHash({ operation: "editar", taskId: 43, payload: { titulo: "Versión aprobada" } }));
  assert.notEqual(base, buildWilsonConfirmationHash({ operation: "editar", taskId: 42, payload: { titulo: "Contenido cambiado" } }));
  assert.notEqual(base, buildWilsonConfirmationHash({ operation: "eliminar", taskId: 42, payload: { titulo: "Versión aprobada" } }));
});

test("normaliza acentos en nombres del sistema", () => {
  assert.equal(normalizeWilsonText(" BÚNKER Training "), "bunker training");
});

test("Wilson agrega un bloque a la descripción sin duplicarlo", () => {
  assert.equal(appendWilsonDescription("Bloque uno", "Bloque dos"), "Bloque uno\n\nBloque dos");
  assert.equal(appendWilsonDescription("Bloque uno\n\nBloque dos", "Bloque dos"), "Bloque uno\n\nBloque dos");
});

test("Wilson prepara una edición parcial preservando los demás campos", () => {
  const current = {
    titulo: "Bunker | Visita producción | 07/08", asignado_a: "Luciano", cliente_id: 11,
    cliente_nombre: "Búnker Training", fecha_vencimiento: "2026-08-07", tipo_tarea: "edicion",
    prioridad: "media", aclaraciones: "Brief original", material_referencia: "https://drive.test/material",
    subtipo: null, propiedades_extra: { referencia: "https://instagram.test/original" },
  };
  const result = buildWilsonTaskUpdate({ append_descripcion: "Nuevo bloque" }, current, catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.task.titulo, current.titulo);
  assert.equal(result.task.asignado_a, current.asignado_a);
  assert.equal(result.task.aclaraciones, "Brief original\n\nNuevo bloque\nReferencia: https://instagram.test/original");
  assert.equal(result.task.material_referencia, current.material_referencia);
});

test("Wilson permite cambiar cliente por nombre en una edición", () => {
  const extendedCatalog = {
    clients: [...catalog.clients, { id: 12, nombre: "Bohle" }], users: catalog.users,
  };
  const current = {
    titulo: "Tarea", asignado_a: "Luciano", cliente_id: 11, cliente_nombre: "Búnker Training",
    fecha_vencimiento: "2026-08-07", tipo_tarea: "edicion", prioridad: "media",
    aclaraciones: null, material_referencia: null, subtipo: null, propiedades_extra: {},
  };
  const result = buildWilsonTaskUpdate({ cliente: "Bohle" }, current, extendedCatalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.task.cliente_id, 12);
});
