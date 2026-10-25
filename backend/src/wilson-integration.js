import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import { buildMiaGroupDigests, buildMiaWeeklyCarruselDigest, miaGroupDigestWindow } from "./mia-group-digest.js";
import { destinatariosNuevosDeAsignacion } from "./private-task-notifications.js";
import { normalizeFeedback, withServerFeedbackProvenance } from "./feedback-fields.js";
import { normalizeFeedbackResponsibleIds } from '../../shared/feedback-responsibles.mjs';
import { resolveFeedbackResponsibleSelection } from './feedback-responsibles.js';
import { encolarNotificacionPrivadaFeedback } from "./private-feedback-notifications.js";
import { SYSTEM_USER_ROLES } from "./user-roles.js";
import { canonicalFeedbackIntent, feedbackIdempotencyKey, feedbackIntentHash, feedbackConfirmationHash,
  lockFeedbackActor, findFeedbackReceipt, feedbackReplayResponse, insertFeedbackReceipt, feedbackNoteDto } from "./feedback-receipts.js";
import { findSimilarFeedback } from "./feedback-workflow.js";
import { getProductionProgress, isProductionVisitTask } from "./production-visits.js";
import { rankTaskPriorities } from "./task-priority.js";
import { getStateNotification, validateProductionHandoff } from "./task-workflow.js";
import { createMiaPersonalListsRouter, enqueueDuePersonalListReminders } from "./mia-personal-lists.js";
import { createMiaSupervisorRouter, acknowledgeSupervisorDelivery, supervisorNotificationDeliverable } from "./mia-supervisor.js";
import { annotateTaskAssignments, replaceTaskAssignments, resolveTaskAssignments } from "./task-assignments.js";
import { isTaskFinalized, isTaskApproved } from "./workflow-contract.js";
import { taskOperationalDto, clientOperationalDto } from "./operational-dto.js";
import { syncProductionVisitFromTask } from "./production-registry.js";
import { lockProductionObjectiveLinks } from "./production-editorial.js";
import { productionEditorialConflict } from "./production-link-errors.js";
import { encolarNotificacionPrivadaTarea } from "./private-task-notifications.js";
import { buildTaskNotificationEligibilityPredicate } from './task-notification-eligibility.js';
import { canonicalTaskOperationIntent, taskOperationKey, taskOperationIntentHash, taskOperationConfirmationHash,
  TASK_RECEIPT_OPERATIONS, taskOperationReceiptDto, findTaskOperationReceipt, insertTaskOperationReceipt,
  consumeTaskOperationConfirmation, lockTaskOperationResources } from "./task-operation-receipts.js";

const DEFAULT_PUBLIC_KEY = fs.readFileSync(new URL("./wilson-public-key.pem", import.meta.url), "utf8");
const DEFAULT_ALLOWED_WHATSAPP_ID_HASHES = [
  "6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a",
  "82dbca966460791f7150fbab9343d1a8418686a0f0d393777c487be1cd7c7893",
  "778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2",
  "2e945d6cb00e0f5f616176c007825af691f1398ead3e12787800bd8e6c6968c6",
  "919b2d579ce977f7814bf24d754e6fa9d561d25c61ee06e7683a372cd566ee7e",
  "5028709cf82d1cc48f174b565e3ca8bf07efb7ccc3e20d2a713dc88bd9957819",
  "571fe5c68e0b986e380c466bffe5ec2e283c7d812a2717fe243fbff366a58a46",
  "f1e60232f9cb2d8abc631090c963c389fc46d83e1ffae025e1342182bdce29d1",
  "9047d18e25d15cdd650813a3f1c23bc3f84595be2bd91d1bc189d8f957d01a35",
];
const DEFAULT_WHATSAPP_GROUP_HASHES = [
  "90026ea595078835894848d79b5e40dc4ca86651b84ed947576022351b717a13",
  "c1adff01efe046a3672d49396f6c98227337925ae88eec8447d35ae268c4f276",
  "e7061cae0bec963ae7bd47d398780d50bcc0dd1ff868e5f530be445a2d443c73",
  "46fbc2dcc8412fa02fdf81b219d5c7e6f91e2a1f0927d94beccb4c761309dd5b",
  "2e0c668340e7a99aede30b6867a22268a59590fa5fc8f930f1897dc53b88de41",
  "fc248508123b69e17aff5721290cefe85f70a79365f208c6c8efc2e0a15b129e",
  "b6f63a0029124839f0fccc5549fb7bd9e2f8c2b62da51bcee7748d1ee59e9c08",
  "6318cb9c44d735e14744941f97c3b12ba42422806923a5af2cb7df55e6a232db",
  "43fcf492bf7ca90aaf528553cfbe2933e6252cd1dfc42a343177db0fb1364f19",
  "7226238e049eabc8d17ed0d73c5c7fca6250bc9a9b2c2120289b38ea19ec9cab",
  "2b707612508a420a763ae6fe0c7f5a472535a89678aa5d2da2addffce0e96822",
  "b4300a2a3d3e8afdc5b3a1112738e591ce2d40e4c3eb54811a3903e47c6047b3",
  "13c4054dc2f04e52e88077a6ae57df28f717ce5aeb56ee1f4da533952c33db8f",
  "05c96311dfb4493930e7ff95959e45002cc34177c78b9876500514ccf1d44d96",
  "545579df7cd4db1239e771b947fbf3a96adb8c55dcbadd85b5281786cd55697d",
  "81f07413f1fa70a452a5b7778fee2e08bfaa93f40ecdea6d08bc2aaf4b936550",
  "5b517ee6570c3161bbc73efc89473f6afd1e58ff631398fdcd7782ade6324921",
  "a8608a3cd3282c499a8b584370641e47f1b1a0ce35c5610d249a16c7be97b2d4",
  "2f86b6fa9e678bbcc66b8a29cf8640519c79cfbfe8f8e72db50a62846eb61925",
  "33d84cadc0512ea2194cd763d3a2affca3f7211f76f7d283a163e31dc74a6e21",
];
const OWNER_WHATSAPP_ID_HASHES = [
  "778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2",
];
const DEFAULT_LEADER_WHATSAPP_ID_HASHES = [
  "6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a",
  "82dbca966460791f7150fbab9343d1a8418686a0f0d393777c487be1cd7c7893",
  "778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2",
];
const KNOWN_WHATSAPP_ACCOUNTS = [
  { hash: "778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2", name: "Agustín", role: "lider", leader: true },
  { hash: "6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a", name: "Franco", role: "lider", leader: true },
  { hash: "919b2d579ce977f7814bf24d754e6fa9d561d25c61ee06e7683a372cd566ee7e", name: "Augusto", role: "diseno", leader: false },
  { hash: "5028709cf82d1cc48f174b565e3ca8bf07efb7ccc3e20d2a713dc88bd9957819", name: "Germán", role: "produccion", leader: false },
  { hash: "571fe5c68e0b986e380c466bffe5ec2e283c7d812a2717fe243fbff366a58a46", name: "Luciano", role: "edicion", leader: false },
  { hash: "f1e60232f9cb2d8abc631090c963c389fc46d83e1ffae025e1342182bdce29d1", name: "Mariano Meza", role: "diseno", leader: false },
  { hash: "2e945d6cb00e0f5f616176c007825af691f1398ead3e12787800bd8e6c6968c6", name: "Oriana", role: "community", leader: false },
  { hash: "9047d18e25d15cdd650813a3f1c23bc3f84595be2bd91d1bc189d8f957d01a35", name: "Ana Mayerro", role: "community", leader: false },
];
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const CONFIRMATION_MAX_AGE_MS = 15 * 60 * 1000;
const usedNonces = new Map();

const SECTORS = new Map([
  ["desarrollo", "desarrollo"],
  ["diseno", "diseno"], ["diseño", "diseno"],
  ["edicion", "edicion"], ["edición", "edicion"],
  ["produccion", "produccion"], ["producción", "produccion"],
  ["community", "community"], ["comunidad", "community"],
  ["administracion", "administracion"], ["administración", "administracion"],
]);
const PRIORITIES = new Set(["baja", "media", "alta"]);

export function normalizeWilsonText(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const CONFIRMABLE_OPERATIONS = new Set(["crear", "editar", "archivar", "eliminar", "confirmar_grabacion", "crear_feedback", "editar_feedback"]);
const REVIEW_BATCH_MAX_TASKS = 20;

export function normalizeReviewBatchIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    .slice(0, REVIEW_BATCH_MAX_TASKS);
}

const validUserId = id => Number.isSafeInteger(id) && id > 0;

export function reviewTaskOwnedBy(task = {}, userId) {
  if (!validUserId(userId)) return false;
  return task.asignado_a_id === userId
    || (Array.isArray(task.colaborador_ids) && task.colaborador_ids.includes(userId));
}

export function reviewBatchSnapshotChanged(task = {}, snapshot = {}) {
  return Number(task.id) !== Number(snapshot.id)
    || task.estado !== snapshot.estado
    || canonicalWilsonPerson(task.asignado_a) !== canonicalWilsonPerson(snapshot.asignado_a)
    || new Date(task.updated_at).getTime() !== new Date(snapshot.updated_at).getTime();
}

export function reviewHandoffError(task = {}) {
  const handoffError = validateProductionHandoff(task);
  if (handoffError) return handoffError;
  if (isProductionVisitTask(task) && !task.propiedades_extra?.produccion_confirmada_at) {
    return "La grabación debe estar confirmada por un líder. Confirmar no crea edición: se asigna por video desde Producciones, con editor y fecha explícitos.";
  }
  return null;
}

export function resolveReviewTaskReferences(references = [], tasks = [], auth = {}) {
  const cleanReferences = Array.isArray(references)
    ? references.map((value) => String(value || "").trim()).filter(Boolean).slice(0, REVIEW_BATCH_MAX_TASKS)
    : [];
  const results = cleanReferences.map((reference) => {
    const query = normalizeWilsonText(reference);
    const words = query.split(" ").filter((word) => word.length > 1);
    const matches = tasks.filter((task) => {
      const title = normalizeWilsonText(task.titulo);
      const client = normalizeWilsonText(task.cliente_nombre);
      const haystack = `${title} ${client} ${task.fecha_vencimiento || ""}`;
      return query && (title === query || haystack.includes(query) || (words.length > 0 && words.every((word) => haystack.includes(word))));
    }).map(task => taskWithUrl(task, auth));
    return { reference, status: matches.length === 1 ? "resolved" : matches.length > 1 ? "ambiguous" : "not_found", matches };
  });
  return {
    results,
    task_ids: results.filter((item) => item.status === "resolved").map((item) => item.matches[0].id),
    can_preview: results.length > 0 && results.every((item) => item.status === "resolved"),
  };
}

export function buildWilsonConfirmationHash({ operation, taskId = null, payload = {} }) {
  const cleanPayload = Object.fromEntries(Object.entries(payload || {}).filter(([key]) => ![
    "confirmado", "confirmado_en", "confirmacion_token", "idempotency_key",
  ].includes(key)));
  return crypto.createHash("sha256").update(canonicalJson({
    operation, taskId: taskId === null || taskId === undefined ? null : String(taskId), payload: cleanPayload,
  })).digest("hex");
}

export function buildWilsonSignatureMessage({ timestamp, nonce, telegramUserId, channel, actorId, groupId, actorName, method, path, body }) {
  const bodyHash = crypto.createHash("sha256").update(body === undefined ? "" : canonicalJson(body)).digest("hex");
  if (channel || actorId || groupId || actorName) {
    return ["v2", timestamp, nonce, channel || "telegram", actorId || telegramUserId || "", groupId || "", actorName || "", method.toUpperCase(), path, bodyHash].join("\n");
  }
  return [timestamp, nonce, telegramUserId, method.toUpperCase(), path, bodyHash].join("\n");
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function whatsappConfig(env) {
  try {
    const value = JSON.parse(String(env.WILSON_WHATSAPP_CONFIG || "{}"));
    return {
      allowedIds: Array.isArray(value.allowedIds) ? value.allowedIds.map(String) : csv(env.WILSON_ALLOWED_WHATSAPP_IDS),
      groupIds: Array.isArray(value.groupIds) ? value.groupIds.map(String) : csv(env.WILSON_ALLOWED_WHATSAPP_GROUP_IDS),
      leaderIds: Array.isArray(value.leaderIds) ? value.leaderIds.map(String) : csv(env.WILSON_LEADER_WHATSAPP_IDS),
    };
  } catch {
    return {
      allowedIds: csv(env.WILSON_ALLOWED_WHATSAPP_IDS),
      groupIds: csv(env.WILSON_ALLOWED_WHATSAPP_GROUP_IDS),
      leaderIds: csv(env.WILSON_LEADER_WHATSAPP_IDS),
    };
  }
}

function matchesIdentifier(value, configuredValues, defaultHashes) {
  const rawValue = String(value || "").trim();
  const candidates = rawValue.startsWith("+") ? [rawValue, rawValue.slice(1)] : [rawValue];
  if (configuredValues.length) return candidates.some((candidate) => configuredValues.includes(candidate));
  return candidates.some((candidate) => {
    const hash = crypto.createHash("sha256").update(candidate).digest("hex");
    return defaultHashes.includes(hash);
  });
}

function knownWhatsappAccount(value) {
  const rawValue = String(value || "").trim().replace(/^\+/, "");
  const hash = crypto.createHash("sha256").update(rawValue).digest("hex");
  return KNOWN_WHATSAPP_ACCOUNTS.find((account) => account.hash === hash) || null;
}

export function canWilsonAssignPrivately({ userId, actorRole }, assigneeId) {
  return validUserId(userId) && validUserId(assigneeId)
    && (actorRole === "admin" || userId === assigneeId);
}

export function telegramWilsonUserId(env, actorId) {
  try {
    const bindings = JSON.parse(env.WILSON_TELEGRAM_USER_BINDINGS || "{}");
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
    const id = Object.hasOwn(bindings, actorId) ? bindings[actorId] : null;
    return validUserId(id) ? id : null;
  } catch { return null; }
}

function canonicalWilsonPerson(value) {
  const normalized = normalizeWilsonText(value);
  if (["luciano", "milton", "milton luciano"].includes(normalized)) return "luciano";
  if (["mariano", "mariano mesa", "mariano meza", "mesa", "meza"].includes(normalized)) return "mariano meza";
  if (["ana", "ana may", "ana nay", "ana mayerro"].includes(normalized)) return "ana mayerro";
  return normalized;
}

export function wilsonPersonAliases(value) {
  const canonical = canonicalWilsonPerson(value);
  if (["agus", "agustin", "lider"].includes(canonical)) return ["agus", "agustin", "lider"];
  if (canonical === "luciano") return ["luciano", "milton", "milton luciano"];
  if (canonical === "mariano meza") return ["mariano", "mariano mesa", "mariano meza", "mesa", "meza"];
  if (canonical === "ana mayerro") return ["ana", "ana may", "ana nay", "ana mayerro"];
  if (canonical === "german") return ["german", "germán"];
  return canonical ? [canonical] : [];
}

export function buildMiaFastContext(tasks = [], person = {}, { today = argentinaDate(), limit = 6 } = {}) {
  const active = tasks.filter((task) => !isTaskFinalized(task));
  const ranked = rankTaskPriorities(active, { today, limit });
  const role = person.role || "equipo";
  const roleTasks = role === "produccion" ? tasks.filter(isProductionVisitTask)
    : role === "diseno" ? tasks.filter((task) => normalizeWilsonText(`${task.titulo} ${task.subtipo}`).includes("carrusel"))
      : role === "edicion" ? tasks.filter((task) => task.tipo_tarea === "edicion")
        : role === "community" ? tasks.filter((task) => ["en_revision", "aprobada"].includes(task.estado) || isTaskFinalized(task))
          : tasks;
  const activeRoleTasks = roleTasks.filter((task) => !isTaskFinalized(task));
  const metrics = {
    abiertas: activeRoleTasks.filter((task) => ["pendiente", "en_progreso"].includes(task.estado)).length,
    en_revision: activeRoleTasks.filter((task) => task.estado === "en_revision" && !isTaskApproved(task)).length,
    finalizadas_mes: roleTasks.filter((task) => isTaskFinalized(task)
      && String(task.fecha_vencimiento || task.updated_at || "").slice(0, 7) === today.slice(0, 7)).length,
  };
  if (role === "produccion") {
    metrics.videos_registrados_mes = roleTasks.reduce((total, task) => total
      + (Array.isArray(task.propiedades_extra?.produccion_registros) ? task.propiedades_extra.produccion_registros : [])
        .filter((record) => String(record.periodo_objetivo || record.fecha || "").slice(0, 7) === today.slice(0, 7))
        .reduce((sum, record) => sum + (Number(record.cantidad) || 0), 0), 0);
    metrics.videos_pendientes = activeRoleTasks.map(getProductionProgress)
      .reduce((total, item) => total + item.remaining, 0);
  } else if (role === "diseno") {
    metrics.carruseles_pendientes = metrics.abiertas;
  } else if (role === "edicion") {
    metrics.ediciones_pendientes = metrics.abiertas;
  } else if (role === "community") {
    metrics.para_publicar = metrics.en_revision;
  }
  const compactTask = (task) => ({
    id: Number(task.id), titulo: task.titulo, cliente: task.cliente_nombre || null,
    estado: isTaskApproved(task) ? 'aprobada' : task.estado, prioridad: task.dynamic_priority_label,
    entrega: task.fecha_vencimiento || null, motivo: task.priority_reasons?.[0] || null,
    url: `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}`,
  });
  return {
    empleado: person.name,
    rol: role,
    fecha: today,
    resumen: { ...ranked.summary, ...metrics },
    hacer_ahora: ranked.recommendations.map(compactTask),
  };
}

function argentinaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function validateWilsonConfirmation({ confirmed, confirmedAt, now = Date.now(), maxAgeMs = CONFIRMATION_MAX_AGE_MS }) {
  if (confirmed !== true) return "La operación todavía no fue confirmada.";
  const timestamp = Date.parse(String(confirmedAt || ""));
  if (!Number.isFinite(timestamp)) return "Falta la fecha de confirmación.";
  if (timestamp > now + 30_000 || now - timestamp > maxAgeMs) {
    return "La confirmación venció. Volvé a revisar y confirmar la operación.";
  }
  return null;
}

export function canWilsonGroupParticipantPropose(wilson, operation) {
  return !wilson?.groupParticipantOnly || operation === "crear";
}

export function requireWilsonService(env = process.env, now = () => Date.now(), { allowSignedUnknownWhatsappPrivate = false } = {}) {
  return (req, res, next) => {
    const timestamp = String(req.headers?.["x-wilson-timestamp"] || "").trim();
    const nonce = String(req.headers?.["x-wilson-nonce"] || "").trim();
    const signature = String(req.headers?.["x-wilson-signature"] || "").trim();
    const channel = String(req.headers?.["x-wilson-channel"] || "telegram").trim().toLowerCase();
    if (!["telegram", "whatsapp"].includes(channel)) return res.status(403).json({ error: "Canal no autorizado." });
    const actorId = String(req.headers?.["x-wilson-actor-id"] || req.headers?.["x-telegram-user-id"] || req.body?.telegram_user_id || "").trim();
    const groupId = String(req.headers?.["x-wilson-group-id"] || "").trim();
    const actorName = String(req.headers?.["x-wilson-actor-name"] || "").trim();
    const whatsapp = whatsappConfig(env);
    const knownAccount = channel === "whatsapp" ? knownWhatsappAccount(actorId) : null;
    const privateChat = channel === "whatsapp" && !groupId;
    const allowedWhatsappGroup = channel === "whatsapp" && !privateChat
      && matchesIdentifier(groupId, whatsapp.groupIds, DEFAULT_WHATSAPP_GROUP_HASHES);
    const allowedIds = channel === "whatsapp"
      ? whatsapp.allowedIds
      : [];
    const systemActorId = String(env.WILSON_SYSTEM_ACTOR_ID || "").trim();
    const actorIndividuallyAllowed = channel === "whatsapp"
      ? (Boolean(systemActorId) && actorId === systemActorId)
        || Boolean(knownAccount)
        || matchesIdentifier(actorId, allowedIds, DEFAULT_ALLOWED_WHATSAPP_ID_HASHES)
        || matchesIdentifier(actorId, [], OWNER_WHATSAPP_ID_HASHES)
      : telegramWilsonUserId(env, actorId) !== null || (Boolean(systemActorId) && actorId === systemActorId);
    const actorAllowed = actorIndividuallyAllowed || allowedWhatsappGroup
      || (allowSignedUnknownWhatsappPrivate && channel === "whatsapp" && privateChat);
    if (!actorAllowed) return res.status(403).json({ error: `Esta cuenta de ${channel === "whatsapp" ? "WhatsApp" : "Telegram"} no puede operar tareas.` });
    if (privateChat && !knownAccount && !allowSignedUnknownWhatsappPrivate) {
      return res.status(403).json({ error: "Esta cuenta de WhatsApp no puede usar el asistente privado." });
    }
    if (channel === "whatsapp" && !privateChat && !allowedWhatsappGroup) {
      return res.status(403).json({ error: "Este grupo de WhatsApp no puede operar tareas." });
    }
    const timestampMs = Number(timestamp) * 1000;
    if (!timestamp || !nonce || !signature || !Number.isFinite(timestampMs)
      || Math.abs(now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Firma de Wilson ausente o vencida." });
    }
    for (const [savedNonce, expiresAt] of usedNonces) if (expiresAt <= now()) usedNonces.delete(savedNonce);
    if (usedNonces.has(nonce)) return res.status(409).json({ error: "La solicitud de Wilson ya fue utilizada." });
    // Sign the exact request target, including query parameters. v1 omits
    // channel/group/actor binding and must never be accepted as a fallback.
    const path = req.originalUrl || `${req.baseUrl || ""}${req.url || req.path}`;
    const signatureVersion = String(req.headers?.["x-wilson-signature-version"] || "").trim();
    if (signatureVersion !== "2") return res.status(401).json({ error: "Wilson requiere firma versión 2." });
    const message = buildWilsonSignatureMessage({ timestamp, nonce, channel, actorId, groupId, actorName, method: req.method, path, body: req.body });
    const publicKey = env.WILSON_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    let valid = false;
    try {
      valid = crypto.verify("sha256", Buffer.from(message), publicKey, Buffer.from(signature, "base64"));
    } catch { valid = false; }
    if (!valid) return res.status(401).json({ error: "Firma de Wilson inválida." });
    usedNonces.set(nonce, now() + SIGNATURE_MAX_AGE_MS);
    const conversationId = privateChat
      ? `private:${crypto.createHash("sha256").update(actorId.replace(/^\+/, "")).digest("hex").slice(0, 16)}`
      : groupId;
    req.wilson = {
      channel, actorId, groupId: conversationId, privateChat,
      actorName: knownAccount?.name || actorName || (channel === "telegram" ? "Usuario de Telegram" : "Usuario de WhatsApp"),
      actorRole: "", // Transport metadata never grants a database role.
      groupParticipantOnly: channel === "whatsapp" && allowedWhatsappGroup && !actorIndividuallyAllowed,
      telegramUserId: channel === "telegram" ? actorId : "",
      confirmedBy: knownAccount?.name || actorName || (channel === "telegram" ? "Usuario de Telegram" : "Usuario de WhatsApp"),
    };
    return next();
  };
}

async function alertUnlinkedWhatsapp(pool, req) {
  const day = new Date().toISOString().slice(0, 10);
  const actor = crypto.createHash("sha256").update(String(req.wilson.actorId || "").replace(/^\+/, "")).digest("hex");
  const leaders = await pool.query(`SELECT COALESCE(i.display_name,u.nombre) nombre,
      COALESCE(i.notification_key,u.usuario) clave FROM usuarios u
    LEFT JOIN mia_whatsapp_identities i ON i.usuario_id=u.id AND i.enabled IS TRUE
    WHERE u.rol IN ('admin','lider') AND u.whatsapp_habilitado IS TRUE
      AND (i.actor_hash IS NOT NULL OR u.whatsapp_id_hash IS NOT NULL)`);
  for (const leader of leaders.rows) {
    const fingerprint = crypto.createHash("sha256").update(`whatsapp-sin-vincular:${actor}:${leader.clave}:${day}`).digest("hex");
    await pool.query(`INSERT INTO mia_private_task_notifications
      (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
      VALUES($1,$2,$3,0,'whatsapp_sin_vincular',$4,$5,$6::jsonb)
      ON CONFLICT(fingerprint) DO NOTHING`, [fingerprint, leader.nombre, leader.clave,
      "⚠️ Mía recibió un pedido de Lista desde un WhatsApp que no está vinculado. No modifiqué nada. Vinculalo desde Usuarios y accesos.",
      "https://sistema.rendercorrientes.com/empleados", JSON.stringify({ actor_hash: actor })]);
  }
}

export function wilsonSystemRouteAllowed(method, path) {
  return (method === "GET" && ["/eventos-pendientes", "/notificaciones-privadas", "/resumenes-grupos", "/supervisor/comunicaciones"].includes(path))
    || (method === "GET" && /^\/notificaciones-privadas\/\d+\/verificar$/.test(path))
    || (method === "POST" && (/^\/notificaciones-privadas\/\d+\/entregada$/.test(path)
      || /^\/resumenes-grupos\/[a-f0-9]{64}\/entregado$/.test(path)
      || /^\/eventos\/\d+\/entregado$/.test(path) || path === "/supervisor/tick"));
}

export function resolveWilsonUser(pool, env = process.env) {
  return async (req, res, next) => {
    // Clear any transport/display claims before establishing DB authority.
    Object.assign(req.wilson, { userId: null, actorRole: "", isLeader: false, systemActor: false });
    if (env.WILSON_SYSTEM_ACTOR_ID && req.wilson.actorId === String(env.WILSON_SYSTEM_ACTOR_ID)) {
      if (!wilsonSystemRouteAllowed(req.method, req.path)) return res.status(403).json({ error: "Actor automático sin permisos humanos." });
      req.wilson.systemActor = true;
      return next();
    }
    try {
      const hash = crypto.createHash("sha256").update(String(req.wilson.actorId || "").replace(/^\+/, "")).digest("hex");
      const telegramId = telegramWilsonUserId(env, req.wilson.actorId);
      if (req.wilson.channel === "telegram" && telegramId === null) return res.status(403).json({ error: "Telegram sin vínculo explícito.", code: "unlinked_telegram" });
      const result = req.wilson.channel === "telegram"
        ? await pool.query('SELECT id,usuario,nombre,rol,activo FROM usuarios WHERE id=$1', [telegramId])
        : await pool.query(`SELECT u.id,u.usuario,u.nombre,u.rol,u.activo FROM usuarios u
        WHERE u.whatsapp_habilitado IS TRUE AND (u.whatsapp_id_hash=$1
          OR EXISTS(SELECT 1 FROM mia_whatsapp_identities i WHERE i.usuario_id=u.id AND i.actor_hash=$1 AND i.enabled IS TRUE))
        ORDER BY u.id`, [hash]);
      const user = result.rows[0];
      if (result.rows.length !== 1 || user.activo !== true || !validUserId(Number(user.id))) {
        return res.status(403).json({
          error: "La cuenta externa debe estar vinculada a un único usuario activo de Render OS.",
          code: "unlinked_or_ambiguous_identity",
        });
      }
      req.wilson.userId = Number(user.id);
      req.wilson.actorName = user.nombre;
      req.wilson.actorRole = user.rol;
      req.wilson.confirmedBy = user.nombre;
      req.wilson.isLeader = user.rol === "admin";
      return next();
    } catch (error) { return next(error); }
  };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function exactMatch(items, value, fields) {
  const normalized = normalizeWilsonText(value);
  return items.find((item) => fields.some((field) => normalizeWilsonText(item[field]) === normalized));
}

function exactWilsonUser(users, value) {
  const aliases = new Set(wilsonPersonAliases(value));
  const matches = users.filter((user) => user.activo !== false && ["nombre", "usuario"]
    .some((field) => aliases.has(normalizeWilsonText(user[field]))));
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizedAssignees(input, users) {
  const requested = Array.isArray(input.responsables) ? input.responsables : [];
  const primaryValue = input.responsable || input.asignado_a || requested[0];
  const primary = exactWilsonUser(users, primaryValue);
  const additionalValues = [
    ...(Array.isArray(input.colaboradores) ? input.colaboradores : []),
    ...requested,
  ];
  const collaborators = [];
  const unknown = [];
  const seen = new Set(primary ? [canonicalWilsonPerson(primary.nombre)] : []);
  for (const value of additionalValues) {
    const cleanValue = String(value || "").trim();
    if (!cleanValue) continue;
    const matched = exactWilsonUser(users, cleanValue);
    if (!matched) {
      if (!unknown.includes(cleanValue)) unknown.push(cleanValue);
      continue;
    }
    const key = canonicalWilsonPerson(matched.nombre);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    collaborators.push(matched.nombre);
  }
  return { primary, collaborators, unknown };
}

export function buildWilsonTask(input, { clients, users }) {
  return buildWilsonTaskFields(input, clients, normalizedAssignees(input, users));
}

function buildWilsonTaskFields(input, clients, assignees) {
  const title = String(input.titulo || "").trim();
  const dueDate = String(input.fecha_vencimiento || input.vencimiento || "").trim();
  const client = input.cliente_id
    ? clients.find((item) => String(item.id) === String(input.cliente_id))
    : exactMatch(clients, input.cliente, ["nombre"]);
  const sector = SECTORS.get(String(input.sector || input.lista || input.tipo_tarea || "").trim().toLowerCase());
  const priority = String(input.prioridad || "media").trim().toLowerCase();
  const hasPlannedProductionVideos = hasOwn(input, "produccion_videos_previstos")
    && input.produccion_videos_previstos !== null
    && input.produccion_videos_previstos !== undefined
    && input.produccion_videos_previstos !== "";
  const plannedProductionVideos = hasPlannedProductionVideos
    ? Number(input.produccion_videos_previstos)
    : null;
  const errors = [];
  if (!title) errors.push("Falta el título.");
  if (!client) errors.push("El cliente no coincide con un cliente del sistema.");
  if (!assignees.primary) errors.push("Elegí al menos una persona responsable que exista en el sistema.");
  if (assignees.unknown.length) errors.push(`Estos responsables no coinciden con usuarios del sistema: ${assignees.unknown.join(", ")}.`);
  if (dueDate && !validDate(dueDate)) errors.push("La fecha debe tener formato YYYY-MM-DD.");
  if (!sector) errors.push("El sector debe ser Diseño, Edición, Producción, Community o Administración.");
  if (!PRIORITIES.has(priority)) errors.push("La prioridad debe ser baja, media o alta.");
  if (plannedProductionVideos !== null && (!Number.isInteger(plannedProductionVideos) || plannedProductionVideos <= 0)) {
    errors.push("Los videos previstos deben ser un número entero mayor a cero.");
  }
  const description = String(input.descripcion || input.aclaraciones || "").trim();
  const reference = String(input.referencia || "").trim();
  const notes = [description, reference && !description.includes(reference) ? `Referencia: ${reference}` : ""].filter(Boolean).join("\n");
  return {
    errors,
    task: errors.length ? null : {
      titulo: title,
      asignado_a: assignees.primary.nombre,
      colaboradores: assignees.collaborators,
      responsables: [assignees.primary.nombre, ...assignees.collaborators],
      cliente_id: client.id,
      cliente_nombre: client.nombre,
      estado: "pendiente",
      fecha_vencimiento: dueDate || null,
      tipo_tarea: sector,
      subtipo: String(input.subtipo || "").trim() || null,
      prioridad: priority,
      aclaraciones: notes || null,
      material_referencia: String(input.material || input.material_referencia || "").trim() || null,
      referencia: reference || null,
      produccion_videos_previstos: plannedProductionVideos,
    },
  };
}

export function buildWilsonFeedback(input, { clients, users }, resolvedSelection = null) {
  const section = String(input.seccion || input.tipo || "cliente").trim().toLowerCase();
  const internal = ["equipo", "interno", "reunion", "reunión"].includes(section);
  const client = internal ? null : (input.cliente_id
    ? clients.find((item) => String(item.id) === String(input.cliente_id))
    : exactMatch(clients, input.cliente, ["nombre"]));
  const requested = Array.isArray(input.responsables)
    ? input.responsables
    : [input.responsable].filter(Boolean);
  const explicitIds=Object.hasOwn(input,'responsable_ids')?normalizeFeedbackResponsibleIds(input.responsable_ids):null;
  const responsables = [];
  const unknown = [];
  if(explicitIds!==null){
    if(resolvedSelection!==null){
      // Only validateWilsonFeedback supplies this server-resolved selection.
      // It may retain historical labels for an unchanged, now-inactive ID.
      responsables.push(...(resolvedSelection.responsables||[]));
    }else for(const id of explicitIds){
      const matched=users.find(user=>user.id===id);
      if(!matched){unknown.push(String(id));continue;}
      responsables.push(matched.nombre||matched.usuario);
    }
  }else for (const value of requested) {
      const matched = exactWilsonUser(users, value);
      if (!matched) { unknown.push(String(value || "").trim()); continue; }
      if (!responsables.some((name) => canonicalWilsonPerson(name) === canonicalWilsonPerson(matched.nombre))) responsables.push(matched.nombre);
  }
  const titulo = String(input.titulo || "").trim();
  const contenido = String(input.detalle || input.contenido || "").trim();
  const vigencia = String(input.vigencia || "puntual").trim().toLowerCase();
  const estado = String(input.estado || "pendiente").trim().toLowerCase();
  const errors = [];
  if (!internal && !client) errors.push("El cliente no coincide con un cliente del sistema.");
  if (!titulo) errors.push("Falta el título corto del feedback.");
  if (!contenido) errors.push("Falta el detalle del feedback.");
  if (explicitIds!==null?!explicitIds.length:!responsables.length) errors.push("Elegí al menos una persona responsable.");
  if (unknown.length) errors.push(`Estas personas no coinciden con usuarios del sistema: ${unknown.join(", ")}.`);
  if (!["puntual", "permanente"].includes(vigencia)) errors.push("La vigencia debe ser puntual o permanente.");
  if (!["pendiente", "resuelto"].includes(estado)) errors.push("El estado debe ser pendiente o resuelto.");
  return {
    errors,
    feedback: errors.length ? null : {
      titulo,
      contenido,
      categoria: internal ? "reunion" : "general",
      feedback: normalizeFeedback({
        cliente: client?.nombre || "",
        responsables,
        ...(explicitIds!==null?{responsable_ids:explicitIds}:{}),
        referencia: String(input.referencia || "").trim(),
        vigencia,
        estado,
        flujo: "feedback",
      }),
    },
  };
}

async function validateWilsonFeedback(db, body, {patch=body,current={}} = {}) {
  const selection=await resolveFeedbackResponsibleSelection(db,patch,current);
  const resolved={...body,...selection};
  const normalized = buildWilsonFeedback(resolved, await loadCatalog(db),
    Object.hasOwn(resolved,'responsable_ids')?resolved:null);
  if (normalized.errors.length) return { ...normalized, duplicates: [] };
  const existing = await db.query(
    `SELECT id,titulo,contenido,feedback,updated_at FROM notas_compartidas
     WHERE eliminado_at IS NULL AND COALESCE(feedback->>'cliente','') ILIKE $1
     ORDER BY updated_at DESC LIMIT 100`,
    [normalized.feedback.feedback.cliente],
  );
  return {
    ...normalized,
    duplicates: findSimilarFeedback({
      cliente: normalized.feedback.feedback.cliente,
      titulo: normalized.feedback.titulo,
      contenido: normalized.feedback.contenido,
    }, existing.rows),
  };
}

function tokens(value) {
  return new Set(normalizeWilsonText(value).split(/\s+/).filter((token) => token.length > 2));
}

function similarity(left, right) {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function findWilsonDuplicates(candidate, existingTasks) {
  return existingTasks.flatMap((task) => {
    const reasons = [];
    if (normalizeWilsonText(task.titulo) === normalizeWilsonText(candidate.titulo)) reasons.push("mismo título");
    if (candidate.material_referencia && task.material_referencia === candidate.material_referencia) reasons.push("mismo material");
    if (String(task.fecha_vencimiento || "") === candidate.fecha_vencimiento
      && task.tipo_tarea === candidate.tipo_tarea
      && normalizeWilsonText(task.asignado_a) === normalizeWilsonText(candidate.asignado_a)
      && similarity(task.titulo, candidate.titulo) >= 0.5) reasons.push("misma fecha, sector y responsable con título similar");
    return reasons.length ? [{
      id: task.id, titulo: task.titulo, cliente_nombre: task.cliente_nombre,
      responsables: taskAssignees(task), fecha_vencimiento: task.fecha_vencimiento,
      estado: task.estado, razones: reasons,
      url: `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}`,
    }] : [];
  });
}

async function loadCatalog(db) {
  const [clients, users] = await Promise.all([
    db.query("SELECT id,nombre FROM clientes WHERE activo IS TRUE ORDER BY nombre"),
    db.query("SELECT id,usuario,nombre,rol FROM usuarios WHERE activo IS TRUE ORDER BY nombre"),
  ]);
  return { clients: clients.rows, users: users.rows };
}

async function validate(db, body, actor) {
  const normalized = buildWilsonTask(body, await loadCatalog(db));
  if (normalized.errors.length) return { ...normalized, duplicates: [] };
  const task = normalized.task;
  const existing = await db.query(
    `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.material_referencia,
            to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,c.nombre AS cliente_nombre
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
     WHERE t.propiedades_extra->>'workspace'='render_os'
       AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
       AND t.cliente_id=$1
       AND ($2::boolean OR EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$3))
       ORDER BY t.id DESC LIMIT 100`,
    [task.cliente_id, actor?.actorRole === "admin" && validUserId(actor?.userId), actor?.userId || null],
  );
  return { ...normalized, duplicates: findWilsonDuplicates(task, existing.rows) };
}

export function wilsonOperationalAuth(wilson = {}) {
  return { rol: validUserId(wilson.userId) && wilson.actorRole === "admin" && !wilson.systemActor ? "admin" : "" };
}

export function wilsonTaskForResponse(task, { includeUrl = true, auth = {} } = {}) {
  if (!task) return task;
  task = taskOperationalDto(task, auth);
  const { asignado_a: _legacyAssignee, colaboradores: _legacyCollaborators, ...visibleTask } = task;
  const properties = task.propiedades_extra && typeof task.propiedades_extra === "object"
    ? { ...task.propiedades_extra }
    : task.propiedades_extra;
  if (properties) delete properties.colaboradores;
  return {
    ...visibleTask,
    ...(properties ? { propiedades_extra: properties } : {}),
    responsables: taskAssignees(task),
    ...(includeUrl && task.id ? { url: `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}` } : {}),
  };
}

function taskWithUrl(task, auth = {}) {
  return wilsonTaskForResponse(task, { auth });
}

function wilsonTaskValidationResponse(result, auth) {
  return { ...result,
    task: result.task ? wilsonTaskForResponse(result.task, { includeUrl: false, auth }) : null,
    duplicates: (result.duplicates || []).map(task => taskWithUrl(task, auth)),
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

export function appendWilsonDescription(currentValue, appendedValue) {
  const current = String(currentValue || "").trim();
  const appended = String(appendedValue || "").trim();
  if (!appended) return current;
  if (normalizeWilsonText(current).includes(normalizeWilsonText(appended))) return current;
  return [current, appended].filter(Boolean).join("\n\n");
}

const MIA_EVENT_DESTINATIONS = Object.freeze({
  confirmar_grabacion: "render_brain",
  avance_grabacion: "visitas",
  correccion_grabacion: "visitas",
});

const MIA_STATE_EVENT_LABELS = Object.freeze({
  tarea_iniciada: "Tarea iniciada",
  tarea_en_revision: "Lista para revisar",
  // Historical task completion marker, not evidence of editorial publication.
  tarea_publicada: "Tarea finalizada",
  tarea_finalizada: "Tarea finalizada",
  tarea_aprobada: "Tarea aprobada",
});
const MIA_EVENT_GROUPS = new Set(["render_brain", "visitas", "edicion", "comunicacion"]);

export function buildMiaPendingEvent(task) {
  const pending = task?.propiedades_extra?.mia_notificacion_pendiente;
  if (!task?.id || !pending?.tipo || !pending?.creado_en) return null;
  const type = String(pending.tipo);
  const destination = MIA_EVENT_DESTINATIONS[type] || (MIA_STATE_EVENT_LABELS[type] ? String(pending.destino || "") : "");
  if (!MIA_EVENT_GROUPS.has(destination)) return null;
  const eventId = `${task.id}:${pending.creado_en}:${type}`;
  const url = `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}`;
  let text;
  if (MIA_STATE_EVENT_LABELS[type]) {
    text = `${MIA_STATE_EVENT_LABELS[type]}: ${task.titulo}`;
  } else if (type === "confirmar_grabacion") {
    text = `Visita completa: ${task.titulo}\nUn líder debe confirmar el registro. La edición se asigna después por video desde Producciones.`;
  } else if (type === "correccion_grabacion") {
    text = `Se corrigió la producción de ${task.titulo}: ${pending.anterior} → ${pending.nuevo}.`;
  } else {
    const amount = Number(pending.cantidad) || 0;
    text = `Avance de producción: ${task.titulo}\nSe registraron ${amount} video${amount === 1 ? "" : "s"}. La visita continúa En proceso.`;
  }
  return { id: eventId, task_id: Number(task.id), type, destination, created_at: pending.creado_en, text, task_url: url };
}

// Only explicit write-boundary selections may resolve labels into IDs. Never
// reconstruct untouched membership from legacy task labels (including PATCH).
export async function resolveWilsonTaskAssignmentWrite(db, input, normalizedTask, currentTask = null) {
  const ownerSelected = ["responsable", "asignado_a", "responsables"].some(key => hasOwn(input, key));
  const collaboratorsSelected = ["colaboradores", "responsables"].some(key => hasOwn(input, key));
  if (currentTask && !ownerSelected && !collaboratorsSelected) return null;
  if (!currentTask) return resolveTaskAssignments(db, {
    asignado_a: normalizedTask.asignado_a, colaboradores: normalizedTask.colaboradores,
  });
  const [current] = await annotateTaskAssignments(db, [currentTask]);
  const selection = collaboratorsSelected ? { colaboradores: normalizedTask.colaboradores } : {};
  if (ownerSelected) selection.asignado_a = normalizedTask.asignado_a;
  const selected = await resolveTaskAssignments(db, selection, { requireOwner: ownerSelected });
  const ownerId = ownerSelected ? selected.ownerId : current.asignado_a_id;
  // Untouched bindings are not new selections: keep even renamed/inactive IDs
  // without revalidating them or resolving their historical display labels.
  return {
    ...selected,
    ownerId,
    collaboratorIds: (collaboratorsSelected ? selected.collaboratorIds : current.colaborador_ids)
      .filter(id => id !== ownerId),
  };
}

export function buildWilsonTaskUpdate(input, currentTask, catalog) {
  const appendDescription = String(input.append_descripcion || "").trim();
  const description = appendDescription
    ? appendWilsonDescription(currentTask.aclaraciones, appendDescription)
    : hasOwn(input, "descripcion")
      ? input.descripcion
      : currentTask.aclaraciones;
  const hasResponsables = hasOwn(input, "responsables");
  const ownerSelected = hasResponsables || hasOwn(input, "responsable") || hasOwn(input, "asignado_a");
  const collaboratorsSelected = hasResponsables || hasOwn(input, "colaboradores");
  const merged = {
    titulo: hasOwn(input, "titulo") ? input.titulo : currentTask.titulo,
    descripcion: description,
    cliente_id: hasOwn(input, "cliente_id")
      ? input.cliente_id
      : hasOwn(input, "cliente") ? undefined : currentTask.cliente_id,
    cliente: hasOwn(input, "cliente") ? input.cliente : currentTask.cliente_nombre,
    responsable: hasOwn(input, "responsable")
      ? input.responsable
      : hasOwn(input, "asignado_a") ? input.asignado_a : undefined,
    responsables: hasResponsables ? input.responsables : undefined,
    colaboradores: hasOwn(input, "colaboradores")
      ? input.colaboradores
      : undefined,
    fecha_vencimiento: hasOwn(input, "fecha_vencimiento") ? input.fecha_vencimiento : currentTask.fecha_vencimiento,
    sector: hasOwn(input, "sector") ? input.sector : currentTask.tipo_tarea,
    prioridad: hasOwn(input, "prioridad") ? input.prioridad : currentTask.prioridad,
    material: hasOwn(input, "material") ? input.material : currentTask.material_referencia,
    referencia: hasOwn(input, "referencia")
      ? input.referencia
      : currentTask.propiedades_extra?.referencia || "",
    subtipo: hasOwn(input, "subtipo") ? input.subtipo : currentTask.subtipo,
    produccion_videos_previstos: hasOwn(input, "produccion_videos_previstos")
      ? input.produccion_videos_previstos
      : currentTask.propiedades_extra?.produccion_videos_previstos,
  };
  const explicit = ownerSelected || collaboratorsSelected
    ? normalizedAssignees(merged, catalog.users) : { unknown: [] };
  return buildWilsonTaskFields(merged, catalog.clients, {
    primary: ownerSelected ? explicit.primary : { nombre: currentTask.asignado_a },
    collaborators: collaboratorsSelected ? explicit.collaborators : currentTask.propiedades_extra?.colaboradores || [],
    unknown: explicit.unknown,
  });
}

async function loadWilsonTask(db, taskId, { forUpdate = false, includeArchived = false } = {}) {
  const result = await db.query(
    `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.cliente_id,t.estado,t.propiedades_extra,
            to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
            t.tipo_tarea,t.subtipo,t.prioridad,t.aclaraciones,t.material_referencia,
            t.created_at,t.updated_at,c.nombre AS cliente_nombre
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
     WHERE t.id=$1
       AND t.propiedades_extra->>'workspace'='render_os'
       ${includeArchived ? '' : "AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true' AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'"}
     ${forUpdate ? "FOR UPDATE OF t" : ""}`,
    [taskId],
  );
  return (await annotateTaskAssignments(db, result.rows))[0] || null;
}

async function writeWilsonAudit(db, req, { action, taskId = null, outcome = "ok", details = {} }) {
  await db.query(
    `INSERT INTO integracion_auditoria
      (integracion,canal,actor_id,actor_nombre,grupo_id,accion,tarea_id,resultado,detalles)
     VALUES ('wilson',$1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [req.wilson.channel, req.wilson.actorId, req.wilson.actorName, req.wilson.groupId || null,
      action, taskId, outcome, JSON.stringify(details)],
  );
}

function requireLegacyConfirmation(req, res) {
  if (req.wilson.channel !== "whatsapp") {
    if (req.body?.confirmado === true) return true;
    res.status(400).json({ error: "La operación todavía no fue confirmada." });
    return false;
  }
  return true;
}

async function consumeWilsonConfirmation(db, req, res, operation, taskId = null) {
  if (req.wilson.channel !== "whatsapp") return requireLegacyConfirmation(req, res);
  const token = String(req.body?.confirmacion_token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Falta confirmar esta operación exacta en WhatsApp." });
    return false;
  }
  const payloadHash = buildWilsonConfirmationHash({ operation, taskId, payload: req.body });
  const result = await db.query(
    `UPDATE integracion_confirmaciones SET used_at=NOW()
     WHERE token=$1 AND integracion='wilson' AND canal='whatsapp'
       AND actor_id=$2 AND grupo_id=$3 AND operacion=$4
       AND tarea_id IS NOT DISTINCT FROM $5::integer AND payload_hash=$6
       AND used_at IS NULL AND expires_at>NOW()
     RETURNING token`,
    [token, req.wilson.actorId, req.wilson.groupId, operation, taskId, payloadHash],
  );
  if (result.rows[0]) return true;
  res.status(409).json({ error: "La confirmación no corresponde a esta operación, ya fue usada o venció." });
  return false;
}

function requireFeedbackHuman(wilson, operation = null) {
  if (!validUserId(wilson?.userId) || wilson.systemActor || !SYSTEM_USER_ROLES.includes(wilson.actorRole)) {
    throw Object.assign(new Error('Necesitás una identidad humana activa con rol autorizado.'), {status:403});
  }
  if(operation && !canWilsonGroupParticipantPropose(wilson,operation))throw Object.assign(new Error('Este participante no puede modificar feedback desde este grupo.'),{status:403});
}

export async function consumeFeedbackConfirmation(db, req, intent, key) {
  const token=req.body?.confirmacion_token;
  if(typeof token!=='string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) throw Object.assign(new Error('Falta una confirmación exacta de feedback.'),{status:400});
  const params=[token,req.wilson.channel,req.wilson.actorId,req.wilson.groupId||'',intent.operation,intent.target_id,
    feedbackConfirmationHash({intent,userId:req.wilson.userId,key})];
  // Acquire the exact token first: UPDATE predicates can run before waiting for
  // an unchanged row lock. Expiry must be evaluated only AFTER that wait.
  const locked=await db.query(`SELECT token FROM integracion_confirmaciones
    WHERE token=$1 AND integracion='wilson' AND canal=$2 AND actor_id=$3 AND grupo_id=$4
      AND operacion=$5 AND tarea_id IS NOT DISTINCT FROM $6::integer AND payload_hash=$7
    FOR UPDATE`,params);
  if(!locked.rows.length)throw Object.assign(new Error('La confirmación no corresponde a esta intención. Renovála.'),{status:409});
  const result=await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
    WHERE token=$1 AND integracion='wilson' AND canal=$2 AND actor_id=$3 AND grupo_id=$4
      AND operacion=$5 AND tarea_id IS NOT DISTINCT FROM $6::integer AND payload_hash=$7
      AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING token`,
  params);
  if(!result.rows.length)throw Object.assign(new Error('La confirmación no corresponde a esta intención, ya fue usada o venció. Renovála.'),{status:409});
}

export function isWilsonLeader(req) {
  return validUserId(req.wilson?.userId) && req.wilson.actorRole === "admin" && !req.wilson.systemActor;
}

export async function resolveWilsonPersonFilter(db, value) {
  const rows = (await db.query(`SELECT id,nombre,usuario,rol FROM usuarios
    WHERE activo IS TRUE AND (lower(nombre)=lower($1) OR lower(usuario)=lower($1))`, [value])).rows;
  if (rows.length !== 1 || !validUserId(Number(rows[0].id))) {
    throw Object.assign(new Error("La persona debe corresponder a un único usuario activo."), { status: 404 });
  }
  return { ...rows[0], id: Number(rows[0].id) };
}

function taskAssignees(task = {}) {
  const collaborators = Array.isArray(task.colaboradores)
    ? task.colaboradores
    : Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
  const seen = new Set();
  const declared = Array.isArray(task.responsables) ? task.responsables : [];
  return [task.asignado_a, ...collaborators, ...declared].filter((name) => {
    const key = canonicalWilsonPerson(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function privateAssignmentListError(req, env, task, db) {
  const assignment = Object.hasOwn(task, "ownerId") ? task : await resolveTaskAssignments(db, {
    asignado_a: task.asignado_a, colaboradores: task.colaboradores || [],
  });
  const ids = [assignment.ownerId, ...assignment.collaboratorIds].filter(id => id !== null);
  return !ids.length || ids.some(id => !canWilsonAssignPrivately(req.wilson, id))
    ? "Solo podés asignar tareas a tu identidad vinculada; otras asignaciones requieren admin."
    : null;
}

function privateCurrentTaskError(req, env, task) {
  return isWilsonLeader(req) || reviewTaskOwnedBy(task, req.wilson.userId)
    ? null
    : "Desde el chat privado solo podés crear o modificar tareas permitidas para tu rol.";
}

const taskOperationHidden=task=>['archivada_render_os','papelera_render_os'].some(key=>[true,'true'].includes(task.propiedades_extra?.[key]));
const taskOperationError=(message,status=409)=>Object.assign(new Error(message),{status});
function requireTaskOperationHuman(wilson,operation) {
  requireFeedbackHuman(wilson,operation);
  if(operation==='eliminar'&&wilson.actorRole!=='admin')throw taskOperationError('Solo admin puede eliminar definitivamente tareas.',403);
}
async function lockTaskOperationActor(db,req,operation,env) {
  requireTaskOperationHuman(req.wilson,operation);
  const actor=await lockFeedbackActor(db,req.wilson,{telegramUserId:telegramWilsonUserId(env,req.wilson.actorId)});
  Object.assign(req.wilson,{actorName:actor.nombre,actorRole:actor.rol,confirmedBy:actor.nombre});
  requireTaskOperationHuman(req.wilson,operation);
  return actor;
}
async function lockTaskOperationRow(db,id) {
  const result=await db.query(`SELECT t.*,c.nombre cliente_nombre,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.id=$1 FOR UPDATE OF t`,[id]);
  return (await annotateTaskAssignments(db,result.rows))[0]??null;
}
function assertTaskOperationAccess(req,task) {
  if(task.propiedades_extra?.workspace!=='render_os'||privateCurrentTaskError(req,null,task))throw taskOperationError('No tenés acceso actual a esta tarea.',403);
}
async function taskOperationReplay(db,req,receipt) {
  const task=await lockTaskOperationRow(db,receipt.task_id);
  const result={idempotent:true,created:false,updated:false,archived:false,deleted:false,task_id:receipt.task_id,
    receipt:taskOperationReceiptDto(receipt),task:null};
  if(!task)return{...result,task_deleted:true};
  assertTaskOperationAccess(req,task);
  if(taskOperationHidden(task))return{...result,task_archived:true};
  return{...result,task:taskWithUrl(task,wilsonOperationalAuth(req.wilson)),result_current:true};
}

/** Resolve ONLY explicit selectors; untouched historic labels never establish IDs. */
export async function prepareWilsonTaskOperation(db,intent,current=null) {
  const b=intent.business,catalog=await loadCatalog(db),selections={};
  const ownerSelected=hasOwn(b,'asignado_a_id')||hasOwn(b,'asignado_a');
  const collaboratorsSelected=hasOwn(b,'colaborador_ids')||hasOwn(b,'colaboradores');
  let clientId=current?.cliente_id,clientName=current?.cliente_nombre;
  if(hasOwn(b,'cliente_id')||hasOwn(b,'cliente')) {
    const matches=hasOwn(b,'cliente_id')?catalog.clients.filter(row=>row.id===b.cliente_id)
      :catalog.clients.filter(row=>normalizeWilsonText(row.nombre)===normalizeWilsonText(b.cliente));
    if(matches.length!==1)throw taskOperationError('Elegí un único cliente activo.',422);
    const row=(await db.query('SELECT id,nombre FROM clientes WHERE id=$1 AND activo IS TRUE FOR SHARE',[matches[0].id])).rows[0];
    if(!row || (!hasOwn(b,'cliente_id')&&normalizeWilsonText(row.nombre)!==normalizeWilsonText(b.cliente)))throw taskOperationError('El cliente seleccionado cambió. Renová la confirmación.');
    clientId=row.id;clientName=row.nombre;selections.cliente_id=row.id;
  }
  const labelSelections=[];
  function person(value,byId) {
    const selected=byId?catalog.users.find(user=>user.id===value):exactWilsonUser(catalog.users,value);
    if(!selected)throw taskOperationError('La selección debe coincidir con un único usuario activo.',422);
    if(!byId)labelSelections.push({label:value,id:selected.id});
    return selected.id;
  }
  let resolved=null;
  if(ownerSelected||collaboratorsSelected) {
    const selected={};
    if(ownerSelected)selected.asignado_a_id=person(b.asignado_a_id??b.asignado_a,hasOwn(b,'asignado_a_id'));
    if(collaboratorsSelected)selected.colaborador_ids=(b.colaborador_ids??b.colaboradores).map(value=>person(value,hasOwn(b,'colaborador_ids')));
    resolved=await resolveTaskAssignments(db,selected,{requireOwner:ownerSelected});
    if(labelSelections.length) {
      // The catalogue was read before waiting on selected users. Recheck the
      // original labels against fresh rows AFTER those identity locks, never
      // silently adopt an ID whose name/username no longer matches the choice.
      const fresh=(await db.query('SELECT id,usuario,nombre,rol FROM usuarios WHERE activo IS TRUE ORDER BY nombre')).rows;
      if(labelSelections.some(choice=>exactWilsonUser(fresh,choice.label)?.id!==choice.id))throw taskOperationError('Los responsables seleccionados cambiaron. Renová la confirmación.');
    }
    if(ownerSelected)selections.asignado_a_id=resolved.ownerId;
    if(collaboratorsSelected)selections.colaborador_ids=[...resolved.collaboratorIds].sort((a,c)=>a-c);
  }
  if(!current&&!ownerSelected)throw taskOperationError('Elegí un responsable activo por ID o etiqueta inequívoca.',422);
  let assignment=null;
  if(!current||ownerSelected||collaboratorsSelected) {
    const ownerId=ownerSelected?resolved.ownerId:current.asignado_a_id;
    const collaboratorIds=(collaboratorsSelected?resolved.collaboratorIds:(current?.colaborador_ids??[])).filter(id=>id!==ownerId);
    assignment={ownerId,collaboratorIds};
  }
  let ownerName=ownerSelected?resolved.ownerName:current?.asignado_a;
  let collaboratorNames=collaboratorsSelected?resolved.collaboratorNames:current?.propiedades_extra?.colaboradores??[];
  if(assignment) {
    const ids=[...new Set([assignment.ownerId,...assignment.collaboratorIds].filter(validUserId))];
    const people=ids.length?(await db.query('SELECT id,nombre FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id',[ids])).rows:[];
    ownerName=people.find(user=>user.id===assignment.ownerId)?.nombre??ownerName;
    collaboratorNames=assignment.collaboratorIds.map(id=>people.find(user=>user.id===id)?.nombre).filter(Boolean);
  }
  const choose=(key,fallback)=>hasOwn(b,key)?b[key]:fallback;
  const raw={titulo:choose('titulo',current?.titulo),cliente_id:clientId,sector:choose('sector',current?.tipo_tarea),
    fecha_vencimiento:choose('fecha_vencimiento',current?.fecha_vencimiento),subtipo:choose('subtipo',current?.subtipo),
    prioridad:choose('prioridad',current?.prioridad??'media'),material:choose('material',current?.material_referencia),
    referencia:choose('referencia',current?.propiedades_extra?.referencia),
    produccion_videos_previstos:choose('produccion_videos_previstos',current?.propiedades_extra?.produccion_videos_previstos),
    descripcion:hasOwn(b,'append_descripcion')?appendWilsonDescription(current?.aclaraciones,b.append_descripcion):choose('descripcion',current?.aclaraciones)};
  const clients=[...catalog.clients];
  if(current&&!clients.some(client=>client.id===clientId))clients.push({id:clientId,nombre:clientName});
  const result=buildWilsonTaskFields(raw,clients,{primary:ownerName?{nombre:ownerName}:null,collaborators:collaboratorNames,unknown:[]});
  if(result.errors.length)throw taskOperationError(result.errors.join(' '),422);
  return{task:result.task,assignment,selections};
}

function assertTaskOperationSelectionPermission(req,selections) {
  const ids=[selections.asignado_a_id,...(selections.colaborador_ids??[])].filter(validUserId);
  if(ids.some(id=>!canWilsonAssignPrivately(req.wilson,id)))throw taskOperationError('Solo podés seleccionar tu identidad; otras asignaciones requieren admin.',403);
}

async function prepareTaskOperationTarget(db,req,intent) {
  await lockProductionObjectiveLinks(db);
  if(intent.operation==='crear')return null;
  await lockTaskOperationResources(db,intent.target_id);
  const task=await lockTaskOperationRow(db,intent.target_id);
  if(!task)throw taskOperationError('La tarea no existe.',404);
  assertTaskOperationAccess(req,task);
  if(task.revision!==intent.expected_revision)throw taskOperationError('La tarea cambió. Recargá su revisión y confirmá nuevamente.');
  if(intent.operation==='eliminar'?!taskOperationHidden(task):taskOperationHidden(task))throw taskOperationError(intent.operation==='eliminar'?'Archivá la tarea antes de eliminarla.':'La tarea está archivada o en papelera.');
  return task;
}

function isWilsonSystemActor(req, env) {
  const systemActorId = String(env.WILSON_SYSTEM_ACTOR_ID || "").trim();
  return Boolean(systemActorId) && req.wilson.systemActor === true && req.wilson.actorId === systemActorId;
}

export function createWilsonRouter({ pool, notifyAssignment, notifyTaskReceiptEmail, notifyFeedback, confirmProduction, env = process.env }) {
  const router = express.Router();
  if (env.NODE_ENV !== "test") {
    const whatsapp = whatsappConfig(env);
    console.info("Wilson WhatsApp config", {
      allowedAccounts: whatsapp.allowedIds.length || DEFAULT_ALLOWED_WHATSAPP_ID_HASHES.length,
      allowedGroups: whatsapp.groupIds.length || DEFAULT_WHATSAPP_GROUP_HASHES.length,
      leaderAccounts: whatsapp.leaderIds.length || DEFAULT_LEADER_WHATSAPP_ID_HASHES.length,
    });
  }
  router.use(requireWilsonService(env, () => Date.now(), { allowSignedUnknownWhatsappPrivate: true }));
  router.use(resolveWilsonUser(pool, env));
  router.use("/lista-personal", createMiaPersonalListsRouter({ express, pool,
    lockActor: (db, req) => lockFeedbackActor(db, req.wilson, {
      telegramUserId: telegramWilsonUserId(env, req.wilson.actorId),
    }),
  }));
  // Supervisor routes revalidate the linked actor and normalized membership;
  // employee follow-ups must remain available after the ID migration.
  router.use("/supervisor", createMiaSupervisorRouter({ express, pool, env, isSystemActor: (req) => isWilsonSystemActor(req, env) }));

  router.get("/catalogo", async (_req, res, next) => {
    try {
      const catalog = await loadCatalog(pool);
      res.json({
        ...catalog, clients: catalog.clients.map(client => clientOperationalDto(client, wilsonOperationalAuth(_req.wilson))),
        sectors: [...new Set(SECTORS.values())],
        priorities: [...PRIORITIES],
        assignment_contract: {
          field: "responsables",
          minimum: 1,
          equivalent: true,
          label: "Responsables",
          instruction: "Usá una sola lista de responsables. Todas las personas están a cargo por igual; nunca comuniques un responsable principal ni colaboradores.",
        },
        personal_list_contract: {
          visibility: "private",
          operations: ["crear", "editar", "completar", "reabrir", "eliminar", "recordar", "reprogramar_recordatorio", "cancelar_recordatorio"],
          confirmation_expires: false,
          instruction: "Tarea es visible para el equipo; Lista es privada. Si no está claro, preguntá: tarea, lista o ambas. En grupos continuá todo lo relativo a Lista por privado. Nunca modifiques sin mostrar resumen y recibir confirmación. Si hay coincidencias, enumeralas y no adivines. Si pide recordatorio sin hora, preguntá a qué hora.",
        },
        supervisor_contract: {
          coordinator: "Mía", scope: "render_os", private_followups: true,
          work_days: "lunes a sábado", work_windows: ["08:00–13:00", "17:00–21:30"],
          timezone: "America/Argentina/Buenos_Aires", max_attempts: 3, retry_work_minutes: 180,
          instruction: "Usá supervisor/contexto para seguimiento. Una fecha sugerida necesita aceptación del responsable. Respuestas operativas requieren el texto real, estado, motivo, fecha si posterga e ID original del mensaje. Nunca inventes esos datos. Las respuestas de seguimiento son exclusivamente privadas; los clientes no reciben información de empleados ni líderes.",
        },
      });
    } catch (error) { next(error); }
  });

  router.post("/feedback/validar", async (req, res, next) => {
    try {
      requireFeedbackHuman(req.wilson);
      const intent=canonicalFeedbackIntent(req.body||{}, {operation:'crear_feedback'});
      const result = await validateWilsonFeedback(pool, intent.business);
      return res.status(result.errors.length ? 422 : 200).json(result);
    } catch (error) { if(error.status)return res.status(error.status).json({error:error.message});return next(error); }
  });

  router.get("/feedback/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Feedback inválido." });
    try {
      requireFeedbackHuman(req.wilson);
      const result = await pool.query(
        `SELECT id,titulo,contenido,categoria,feedback,creado_por,modificado_por,created_at,updated_at
         FROM notas_compartidas WHERE id=$1 AND eliminado_at IS NULL`, [id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Feedback no encontrado." });
      return res.json({ feedback: feedbackNoteDto(result.rows[0]) });
    } catch (error) { if(error.status)return res.status(error.status).json({error:error.message});return next(error); }
  });

  router.patch("/feedback/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!validUserId(id)) return res.status(400).json({ error: "Feedback inválido." });
    let client;
    try {
      requireFeedbackHuman(req.wilson,'editar_feedback');
      const intent=canonicalFeedbackIntent(req.body||{}, {operation:'editar_feedback',targetId:id});
      const key=feedbackIdempotencyKey(req.headers,req.body);
      const payloadHash=feedbackIntentHash(intent);
      client=await pool.connect();
      await client.query("BEGIN");
      const actor=await lockFeedbackActor(client,req.wilson,{telegramUserId:telegramWilsonUserId(env,req.wilson.actorId)});
      Object.assign(req.wilson,{actorName:actor.nombre,actorRole:actor.rol,confirmedBy:actor.nombre});
      const prior=await findFeedbackReceipt(client,{userId:actor.id,operation:intent.operation,key,payloadHash});
      if(prior) {const replay=await feedbackReplayResponse(client,prior);await client.query('COMMIT');return res.json(replay);}
      const current = await client.query(
        `SELECT id,titulo,contenido,categoria,feedback,updated_at,
           date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$2::timestamptz) AS version_matches FROM notas_compartidas
         WHERE id=$1 AND eliminado_at IS NULL FOR UPDATE`, [id,intent.expected_updated_at],
      );
      if (!current.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Feedback no encontrado." }); }
      if(current.rows[0].version_matches!==true)throw Object.assign(new Error('El feedback cambió. Recargá y confirmá la nueva versión.'),{status:409});
      const merged = {
        seccion: current.rows[0].feedback?.cliente ? "cliente" : "equipo",
        cliente: current.rows[0].feedback?.cliente,
        titulo: current.rows[0].titulo,
        contenido: current.rows[0].contenido,
        responsables: current.rows[0].feedback?.responsables || [current.rows[0].feedback?.responsable].filter(Boolean),
        vigencia: current.rows[0].feedback?.vigencia || "puntual",
        estado: current.rows[0].feedback?.estado || "pendiente",
        referencia: current.rows[0].feedback?.referencia || "",
        ...intent.business,
      };
      if(Object.hasOwn(intent.business,'cliente_id'))delete merged.cliente;
      if((Object.hasOwn(intent.business,'cliente_id')||Object.hasOwn(intent.business,'cliente')) && !Object.hasOwn(intent.business,'seccion'))merged.seccion='cliente';
      if(merged.seccion==='equipo') {merged.cliente='';delete merged.cliente_id;}
      const validation = await validateWilsonFeedback(client, merged,{patch:intent.business,current:current.rows[0].feedback??{}});
      const duplicates = validation.duplicates.filter((item) => Number(item.id) !== id);
      if (validation.errors.length) { await client.query("ROLLBACK"); return res.status(422).json(validation); }
      if (duplicates.length && !intent.permitir_duplicado) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Encontré otro feedback parecido. Revisalo antes de actualizar.", duplicates });
      }
      const entry = validation.feedback;
      await consumeFeedbackConfirmation(client,req,intent,key);
      entry.feedback = withServerFeedbackProvenance(entry.feedback,{userId:actor.id,name:actor.nombre,channel:req.wilson.channel});
      const updated = await client.query(
        `UPDATE notas_compartidas SET titulo=$1,contenido=$2,categoria=$3,feedback=$4::jsonb,
           modificado_por=$5,updated_at=NOW() WHERE id=$6
         RETURNING id,titulo,contenido,categoria,feedback,creado_por,modificado_por,created_at,updated_at`,
        [entry.titulo, entry.contenido, entry.categoria, JSON.stringify(entry.feedback), req.wilson.actorName, id],
      );
      await writeWilsonAudit(client, req, { action: "editar_feedback", details: { feedback_id: id } });
      const receipt=await insertFeedbackReceipt(client,{userId:actor.id,operation:intent.operation,key,payloadHash,note:updated.rows[0]});
      await client.query("COMMIT");
      return res.json({ updated: true,idempotent:false,feedback_id:id,receipt,feedback:feedbackNoteDto(updated.rows[0]),text: `Listo. Actualicé “${updated.rows[0].titulo}”.` });
    } catch (error) {
      if(client)await client.query("ROLLBACK").catch(() => {});
      if(error.status)return res.status(error.status).json({error:error.message});
      return next(error);
    } finally { client?.release(); }
  });

  router.post("/feedback", async (req, res, next) => {
    let client;
    try {
      requireFeedbackHuman(req.wilson,'crear_feedback');
      const intent=canonicalFeedbackIntent(req.body||{}, {operation:'crear_feedback'});
      const key=feedbackIdempotencyKey(req.headers,req.body);
      const payloadHash=feedbackIntentHash(intent);
      client=await pool.connect();
      await client.query("BEGIN");
      const actor=await lockFeedbackActor(client,req.wilson,{telegramUserId:telegramWilsonUserId(env,req.wilson.actorId)});
      Object.assign(req.wilson,{actorName:actor.nombre,actorRole:actor.rol,confirmedBy:actor.nombre});
      const prior=await findFeedbackReceipt(client,{userId:actor.id,operation:intent.operation,key,payloadHash});
      if(prior) {const replay=await feedbackReplayResponse(client,prior);await client.query('COMMIT');return res.json(replay);}
      const result = await validateWilsonFeedback(client, intent.business);
      if (result.errors.length) { await client.query("ROLLBACK"); return res.status(422).json(result); }
      if (result.duplicates.length && !intent.permitir_duplicado) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Encontré un feedback parecido. Podés modificar el anterior o confirmar uno nuevo.", duplicates: result.duplicates });
      }
      const entry = result.feedback;
      await consumeFeedbackConfirmation(client,req,intent,key);
      entry.feedback = withServerFeedbackProvenance(entry.feedback,{userId:actor.id,name:actor.nombre,channel:req.wilson.channel});
      const inserted = await client.query(
        `INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback)
         VALUES($1,$2,$3,$4,$4,$5::jsonb)
         RETURNING id,titulo,contenido,categoria,feedback,creado_por,modificado_por,created_at,updated_at`,
        [entry.titulo, entry.contenido, entry.categoria, req.wilson.actorName, JSON.stringify(entry.feedback)],
      );
      await writeWilsonAudit(client, req, { action: "crear_feedback", details: { feedback_id: inserted.rows[0].id } });
      const saved=inserted.rows[0];
      await encolarNotificacionPrivadaFeedback({pool:client,nota:saved,actor:actor.nombre,actorId:actor.id,env});
      const receipt=await insertFeedbackReceipt(client,{userId:actor.id,operation:intent.operation,key,payloadHash,note:saved});
      await client.query("COMMIT");
      return res.status(201).json({ created: true,idempotent: false,feedback_id:saved.id,receipt,feedback:feedbackNoteDto(saved),text: `Listo. Guardé “${saved.titulo}” en Feedback.` });
    } catch (error) {
      if(client)await client.query("ROLLBACK").catch(() => {});
      if(error.status)return res.status(error.status).json({error:error.message});
      return next(error);
    } finally { client?.release(); }
  });

  router.post("/tareas/validar", async (req, res, next) => {
    try {
      const result = await validate(pool, req.body, req.wilson);
      const permissionError = result.task
        ? await privateAssignmentListError(req, env, result.task, pool)
        : null;
      if (permissionError) {
        return res.status(403).json({
          ...result,
          task: null,
          duplicates: result.duplicates.map((task) => taskWithUrl(task, wilsonOperationalAuth(req.wilson))),
          errors: [...result.errors, permissionError],
        });
      }
      res.status(result.errors.length ? 422 : 200).json(wilsonTaskValidationResponse(result, wilsonOperationalAuth(req.wilson)));
    } catch (error) { next(error); }
  });

  router.post("/tareas/resolver-revision", async (req, res, next) => {
    try {
      const references = Array.isArray(req.body?.referencias) ? req.body.referencias : [];
      if (!references.length || references.length > REVIEW_BATCH_MAX_TASKS) {
        return res.status(400).json({ error: `Indicá entre 1 y ${REVIEW_BATCH_MAX_TASKS} tareas.` });
      }
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,t.prioridad,t.propiedades_extra,
          to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,t.updated_at,c.nombre cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
           AND t.estado IN ('pendiente','en_progreso')
         ORDER BY t.fecha_vencimiento NULLS LAST,t.id`,
      );
      const annotated = await annotateTaskAssignments(pool, result.rows);
      const allowed = isWilsonLeader(req, env)
        ? annotated
        : annotated.filter((task) => reviewTaskOwnedBy(task, req.wilson.userId));
      return res.json(resolveReviewTaskReferences(references, allowed, wilsonOperationalAuth(req.wilson)));
    } catch (error) { return next(error); }
  });

  router.post("/lotes/revision/previsualizar", async (req, res, next) => {
    if (req.wilson.channel !== "whatsapp") return res.status(400).json({ error: "Esta función se confirma desde WhatsApp." });
    const rawIds = Array.isArray(req.body?.task_ids) ? req.body.task_ids : [];
    const ids = normalizeReviewBatchIds(rawIds);
    if (!ids.length || ids.length !== rawIds.length) {
      return res.status(400).json({ error: `El listado debe contener entre 1 y ${REVIEW_BATCH_MAX_TASKS} tareas válidas y sin duplicados.` });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,
          t.material_referencia,t.propiedades_extra,t.updated_at,
          to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,c.nombre cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.id=ANY($1::int[]) AND t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
         ORDER BY array_position($1::int[],t.id) FOR UPDATE OF t`,
        [ids],
      );
      if (result.rows.length !== ids.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Una o más tareas ya no están disponibles. Volvé a preparar el listado." });
      }
      result.rows = await annotateTaskAssignments(client, result.rows);
      if (!isWilsonLeader(req) && result.rows.some(task => !reviewTaskOwnedBy(task, req.wilson.userId))) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Solo podés informar y confirmar tareas propias." });
      }
      const invalidState = result.rows.find((task) => !["pendiente", "en_progreso"].includes(task.estado));
      if (invalidState) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `“${invalidState.titulo}” ya no puede pasar a Revisar. Prepará nuevamente el listado.` });
      }
      const invalidHandoff = result.rows.find((task) => reviewHandoffError(task));
      if (invalidHandoff) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `“${invalidHandoff.titulo}” todavía no puede pasar a Revisar: ${reviewHandoffError(invalidHandoff)}`,
        });
      }
      const snapshots = result.rows.map((task) => ({
        id: Number(task.id), titulo: task.titulo, cliente_nombre: task.cliente_nombre,
        asignado_a: task.asignado_a, estado: task.estado, updated_at: new Date(task.updated_at).toISOString(),
      }));
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + CONFIRMATION_MAX_AGE_MS);
      await client.query(
        `UPDATE integracion_confirmaciones SET used_at=NOW()
         WHERE integracion='wilson' AND canal='whatsapp' AND actor_id=$1 AND grupo_id=$2
           AND operacion='revisar_lote' AND used_at IS NULL`,
        [req.wilson.actorId, req.wilson.groupId],
      );
      await client.query(
        `INSERT INTO integracion_confirmaciones
          (token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at,
           payload,informante_actor_id,informante_actor_nombre)
         VALUES($1,'wilson','whatsapp',$2,$3,'revisar_lote',NULL,$4,$5,$6::jsonb,$2,$7)`,
        [token, req.wilson.actorId, req.wilson.groupId,
          buildWilsonConfirmationHash({ operation: "revisar_lote", payload: { task_ids: ids } }),
          expiresAt, JSON.stringify({ tasks: snapshots }), req.wilson.actorName],
      );
      await client.query("COMMIT");
      const lines = snapshots.map((task, index) => `${index + 1}. ${task.titulo}${task.cliente_nombre ? ` — ${task.cliente_nombre}` : ""}`);
      return res.status(201).json({
        confirmacion_token: token, expires_at: expiresAt.toISOString(), task_ids: ids,
        tasks: snapshots.map(task => taskWithUrl(task, wilsonOperationalAuth(req.wilson))),
        text: `Entendí que terminaste:\n${lines.join("\n")}\n\nVoy a pasar ${ids.length === 1 ? "esta tarea" : `estas ${ids.length} tareas`} a Revisar. ¿Confirmás?`,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally { client.release(); }
  });

  router.post("/lotes/revision/confirmar", async (request, res, next) => {
    // Capture the verified transport identity before leasing. Never authorize
    // a queued write with a mutable request or its pre-transaction role.
    const req = { wilson: Object.freeze({ ...request.wilson }) };
    if (req.wilson.channel !== "whatsapp") return res.status(400).json({ error: "Esta función se confirma desde WhatsApp." });
    const token = String(request.body?.confirmacion_token || "").trim();
    if (!token) return res.status(400).json({ error: "Falta la confirmación del listado." });
    let client, discard;
    try {
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const actor = await lockFeedbackActor(client, req.wilson, {
        telegramUserId: telegramWilsonUserId(env, req.wilson.actorId),
      });
      req.wilson = Object.freeze({ ...req.wilson, actorName: actor.nombre,
        actorRole: actor.rol, confirmedBy: actor.nombre, isLeader: actor.rol === 'admin' });
      const confirmationResult = await client.query(
        `SELECT token,actor_id,grupo_id,payload,informante_actor_id,informante_actor_nombre,expires_at
         FROM integracion_confirmaciones
         WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND operacion='revisar_lote'
           AND grupo_id=$2 AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
        [token, req.wilson.groupId],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "La confirmación no existe, ya fue utilizada o venció después de 15 minutos." });
      }
      if (req.wilson.actorId !== confirmation.informante_actor_id && !isWilsonLeader(req, env)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Este listado solo puede confirmarlo quien informó el trabajo, Franco o Agustín." });
      }
      const snapshots = Array.isArray(confirmation.payload?.tasks) ? confirmation.payload.tasks : [];
      const ids = normalizeReviewBatchIds(snapshots.map((task) => task.id));
      const currentResult = ids.length ? await client.query(
        `SELECT id,titulo,asignado_a,estado,tipo_tarea,subtipo,material_referencia,
          cliente_id,fecha_vencimiento,prioridad,propiedades_extra,updated_at
         FROM tareas WHERE id=ANY($1::int[]) FOR UPDATE`, [ids],
      ) : { rows: [] };
      currentResult.rows = await annotateTaskAssignments(client, currentResult.rows);
      if (!isWilsonLeader(req) && currentResult.rows.some(task => !reviewTaskOwnedBy(task, req.wilson.userId))) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "La asignación del listado cambió. Prepará una confirmación nueva." });
      }
      const currentById = new Map(currentResult.rows.map((task) => [Number(task.id), task]));
      const changed = snapshots.filter((snapshot) => {
        const task = currentById.get(Number(snapshot.id));
        return !task || reviewBatchSnapshotChanged(task, snapshot);
      });
      // Lock waits can outlive the token. Authorize at this atomic wall-clock
      // claim, immediately before the first domain write, never at BEGIN.
      // A later failure rolls back both consumption and the domain changes.
      const claimConfirmation = async () => {
        const claim = await client.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
          WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND operacion='revisar_lote'
            AND grupo_id=$2 AND used_at IS NULL AND expires_at>clock_timestamp()
          RETURNING 1 AS claimed`, [token, req.wilson.groupId]);
        if (claim.rows.length !== 1) throw Object.assign(new Error('La confirmación venció o ya fue utilizada. Prepará un listado nuevo.'), { status: 409 });
      };
      if (changed.length || currentResult.rows.length !== snapshots.length) {
        await claimConfirmation();
        await writeWilsonAudit(client, req, {
          action: "cancelar_lote_revision", outcome: "conflicto",
          details: { token, informante: confirmation.informante_actor_nombre, changed_task_ids: changed.map((task) => task.id) },
        });
        await client.query("COMMIT");
        return res.status(409).json({
          error: "El listado cambió antes de confirmarse. No modifiqué ninguna tarea. Prepará un resumen nuevo.",
          changed_task_ids: changed.map((task) => task.id),
        });
      }
      const invalidHandoff = currentResult.rows.find((task) => reviewHandoffError(task));
      if (invalidHandoff) {
        await claimConfirmation();
        await writeWilsonAudit(client, req, {
          action: "cancelar_lote_revision", outcome: "validacion",
          details: { token, informante: confirmation.informante_actor_nombre, task_id: Number(invalidHandoff.id) },
        });
        await client.query("COMMIT");
        return res.status(409).json({
          error: `“${invalidHandoff.titulo}” todavía no puede pasar a Revisar: ${reviewHandoffError(invalidHandoff)} No modifiqué ninguna tarea.`,
        });
      }
      const confirmedAt = new Date().toISOString();
      await claimConfirmation();
      await client.query(
        `UPDATE tareas SET estado='en_revision',
          propiedades_extra=propiedades_extra||$2::jsonb,updated_at=NOW()
         WHERE id=ANY($1::int[])`,
        [ids, JSON.stringify({
          origen_integracion: "wilson", mia_revision_confirmada_at: confirmedAt,
          mia_revision_informada_por: confirmation.informante_actor_nombre,
          mia_revision_confirmada_por: req.wilson.actorName,
        })],
      );
      for (const snapshot of snapshots) {
        await writeWilsonAudit(client, req, {
          action: "pasar_a_revision_desde_mia", taskId: Number(snapshot.id),
          details: { token, informante: confirmation.informante_actor_nombre, confirmado_por: req.wilson.actorName, estado_anterior: snapshot.estado },
        });
      }
      await client.query("COMMIT");
      for (const task of currentResult.rows) {
        const event = getStateNotification({ ...task, estado: "en_revision" }, task.estado);
        if (event) {
          notifyAssignment?.({
            pool,
            tarea: { ...task, estado: "en_revision" },
            motivo: event.motivo,
            nombresDestinatarios: event.recipients,
            actor: req.wilson.actorName,
            actorId: req.wilson.userId,
          });
        }
      }
      return res.json({
        updated: true, task_ids: ids,
        text: `Listo. ${req.wilson.actorName} confirmó y pasé ${ids.length} tarea${ids.length === 1 ? "" : "s"} a Revisar.`,
      });
    } catch (error) {
      if (client) try { await client.query("ROLLBACK"); } catch (rollbackError) { discard = rollbackError; }
      return next(error);
    } finally { client?.release(discard); }
  });

  router.post("/confirmaciones", async (req, res, next) => {
    try {
      const operation = String(req.body?.operacion || "").trim().toLowerCase();
      if (!CONFIRMABLE_OPERATIONS.has(operation)) return res.status(422).json({ error: "Operación no confirmable." });
      if(TASK_RECEIPT_OPERATIONS.includes(operation)) {
        requireTaskOperationHuman(req.wilson,operation);
        const payload=req.body?.payload;
        const intent=canonicalTaskOperationIntent(payload,{operation,targetId:operation==='crear'?null:Number(req.body?.tarea_id)});
        const key=taskOperationKey(req.headers,{idempotency_key:payload.idempotency_key??req.body.idempotency_key});
        if(payload.idempotency_key!==undefined&&req.body.idempotency_key!==undefined)taskOperationKey({'idempotency-key':payload.idempotency_key},{idempotency_key:req.body.idempotency_key});
        const db=await pool.connect();
        try {
          await db.query('BEGIN');
          const actor=await lockTaskOperationActor(db,req,operation,env);
          const current=await prepareTaskOperationTarget(db,req,intent);
          const prepared=['crear','editar'].includes(operation)?await prepareWilsonTaskOperation(db,intent,current):{selections:{}};
          assertTaskOperationSelectionPermission(req,prepared.selections);
          const token=crypto.randomUUID(),expiresAt=new Date(Date.now()+CONFIRMATION_MAX_AGE_MS);
          await db.query(`INSERT INTO integracion_confirmaciones(token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at)
            VALUES($1,'wilson',$2,$3,$4,$5,$6,$7,$8)`,[token,req.wilson.channel,req.wilson.actorId,req.wilson.groupId||'',operation,intent.target_id,
            taskOperationConfirmationHash({intent,userId:actor.id,key,selections:prepared.selections}),expiresAt]);
          await db.query('COMMIT');
          return res.status(201).json({confirmacion_token:token,operacion:operation,tarea_id:intent.target_id,expires_at:expiresAt.toISOString()});
        } catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
      }
      if(['crear_feedback','editar_feedback'].includes(operation)) {
        requireFeedbackHuman(req.wilson,operation);
        const payload=req.body?.payload;
        const targetId=operation==='crear_feedback'?null:Number(req.body?.tarea_id);
        const intent=canonicalFeedbackIntent(payload,{operation,targetId});
        const key=feedbackIdempotencyKey(req.headers,{idempotency_key:payload.idempotency_key??req.body.idempotency_key});
        if(payload.idempotency_key!==undefined && req.body.idempotency_key!==undefined)feedbackIdempotencyKey({'idempotency-key':payload.idempotency_key},{idempotency_key:req.body.idempotency_key});
        const db=await pool.connect();
        try {
          await db.query('BEGIN');
          const actor=await lockFeedbackActor(db,req.wilson,{telegramUserId:telegramWilsonUserId(env,req.wilson.actorId)});
          if(targetId!==null) {
            const note=(await db.query(`SELECT id,date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$2::timestamptz) AS version_matches
              FROM notas_compartidas WHERE id=$1 AND eliminado_at IS NULL FOR SHARE`,[targetId,intent.expected_updated_at])).rows[0];
            if(!note)throw Object.assign(new Error('Feedback no encontrado.'),{status:404});
            if(note.version_matches!==true)throw Object.assign(new Error('El feedback cambió. Recargá antes de confirmar.'),{status:409});
          }
          const token=crypto.randomUUID(),expiresAt=new Date(Date.now()+CONFIRMATION_MAX_AGE_MS);
          await db.query(`INSERT INTO integracion_confirmaciones
            (token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at)
            VALUES($1,'wilson',$2,$3,$4,$5,$6,$7,$8)`,
          [token,req.wilson.channel,req.wilson.actorId,req.wilson.groupId||'',operation,targetId,
            feedbackConfirmationHash({intent,userId:actor.id,key}),expiresAt]);
          await db.query('COMMIT');
          return res.status(201).json({confirmacion_token:token,operacion:operation,tarea_id:targetId,expires_at:expiresAt.toISOString()});
        } catch(error) {await db.query('ROLLBACK').catch(()=>{});throw error;}
        finally {db.release();}
      }
      if (req.wilson.channel !== "whatsapp") return res.status(400).json({ error: "Esta confirmación es exclusiva de WhatsApp." });
      if (!canWilsonGroupParticipantPropose(req.wilson, operation)) {
        return res.status(403).json({ error: "Este participante puede crear tareas, pero no modificar operaciones existentes." });
      }
      const createsWithoutTarget = new Set(["crear", "crear_feedback"]);
      const taskId = createsWithoutTarget.has(operation) ? null : Number(req.body?.tarea_id);
      if (!createsWithoutTarget.has(operation) && (!Number.isInteger(taskId) || taskId <= 0)) {
        return res.status(422).json({ error: "Falta un elemento válido para confirmar." });
      }
      if (operation === "eliminar" && !isWilsonLeader(req, env)) {
        return res.status(403).json({ error: "Solo Agustín o Franco pueden eliminar definitivamente una tarea." });
      }
      if (["editar", "archivar", "confirmar_grabacion"].includes(operation)) {
        const task = await loadWilsonTask(pool, taskId);
        if (!task || privateCurrentTaskError(req, env, task)
          || (operation === "confirmar_grabacion" && !isWilsonLeader(req))) {
          return res.status(403).json({ error: "No tenés permiso para confirmar esta tarea." });
        }
      }
      const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + CONFIRMATION_MAX_AGE_MS);
      await pool.query(
        `INSERT INTO integracion_confirmaciones
          (token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at)
         VALUES ($1,'wilson','whatsapp',$2,$3,$4,$5,$6,$7)`,
        [token, req.wilson.actorId, req.wilson.groupId, operation, taskId,
          buildWilsonConfirmationHash({ operation, taskId, payload }), expiresAt],
      );
      return res.status(201).json({ confirmacion_token: token, operacion: operation, tarea_id: taskId, expires_at: expiresAt.toISOString() });
    } catch (error) { if(error.status)return res.status(error.status).json({error:error.message});return next(error); }
  });

  // Read-only, keyset-paginated intake. Comments need not update tareas.updated_at.
  router.get("/visitas-material", async (req, res, next) => {
    if (!isWilsonLeader(req, env)) return res.status(403).json({ error: "Consulta exclusiva de líderes." });
    const after = Number(req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: "Cursor inválido." });
    try {
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,
                t.propiedades_extra,t.aclaraciones,t.material_referencia,
                to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                t.created_at,t.updated_at,c.nombre AS cliente_nombre,
                COALESCE((SELECT json_agg(json_build_object('id',e.id,'titulo',e.titulo,'estado',e.estado))
                  FROM tareas e WHERE e.propiedades_extra->>'origen_visita_id'=t.id::text
                  AND e.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
                  AND e.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'), '[]'::json) AS ediciones_vinculadas,
                COALESCE((SELECT json_agg(json_build_object('id',tc.id,'contenido',tc.contenido,
                  'created_at',tc.created_at) ORDER BY tc.id)
                  FROM tarea_comentarios tc WHERE tc.tarea_id=t.id), '[]'::json) AS comentarios
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
           AND t.tipo_tarea='produccion' AND t.id>$1
         ORDER BY t.id ASC LIMIT 101`,
        [after],
      );
      const page = result.rows.slice(0, 100);
      return res.json({ tasks: page.filter(isProductionVisitTask).map(task => taskWithUrl(task, wilsonOperationalAuth(req.wilson))),
        next_after: result.rows.length > 100 ? Number(page.at(-1).id) : null });
    } catch (error) { return next(error); }
  });

  // Bounded, filtered task reads for Wilson; preserve actor scope.
  router.get("/consulta-tareas", async (req, res, next) => {
    const after = Number(req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({error:"Cursor inválido"});
    const person = String(req.query.persona || "").trim();
    const clients = String(req.query.clientes || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if (person.length > 100 || clients.length > 10 || clients.some(x=>x.length>100)) return res.status(400).json({error:"Filtros demasiado extensos"});
    const limit = 50;
    try {
      const target = person ? await resolveWilsonPersonFilter(pool, person) : null;
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.aclaraciones,t.material_referencia,
                t.propiedades_extra,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                c.nombre AS cliente_nombre,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('contenido',tc.contenido,'created_at',tc.created_at))
                          FROM tarea_comentarios tc WHERE tc.tarea_id=t.id),'[]'::jsonb) AS comentarios
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
           AND ($1::boolean OR EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$2))
           AND ($3::boolean OR EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$4))
           AND ($5::boolean OR LOWER(COALESCE(c.nombre,'')) LIKE ANY($6::text[]))
           AND ($7::boolean OR t.estado NOT IN ('finalizada','publicada','completada','cancelada','archivada'))
           AND t.id>$8 ORDER BY t.id ASC LIMIT $9`,
        [isWilsonLeader(req,env),req.wilson.userId,!person,target?.id || null,
         clients.length===0,clients.map(x=>'%'+x+'%'),req.query.pendientes==='false',after,limit+1]);
      const rows=result.rows.slice(0,limit);
      return res.json({tasks:rows.map(task => taskWithUrl(task, wilsonOperationalAuth(req.wilson))),next_after:result.rows.length>limit?rows.at(-1).id:null});
    } catch(error){return next(error);}
  });

  router.get("/tareas", async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
      const restrictToOwn = !isWilsonLeader(req, env);
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,t.prioridad,
                t.propiedades_extra,t.aclaraciones,t.material_referencia,
                to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                t.created_at,t.updated_at,c.nombre AS cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND ($2::boolean IS FALSE OR EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$3))
         ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id ASC LIMIT $1`,
        [limit, restrictToOwn, req.wilson.userId],
      );
      return res.json({ tasks: result.rows.map(task => taskWithUrl(task, wilsonOperationalAuth(req.wilson))), limit });
    } catch (error) { return next(error); }
  });

  router.get("/reporte-personal", async (req, res, next) => {
    if (!req.wilson.privateChat) return res.status(400).json({ error: "Este reporte se consulta únicamente por chat privado." });
    try {
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.estado,t.prioridad,t.tipo_tarea,
                to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                c.nombre AS cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$1)
           AND (t.estado NOT IN ('finalizada','publicada')
             OR t.fecha_vencimiento >= date_trunc('month', CURRENT_DATE)
             OR t.updated_at >= date_trunc('month', CURRENT_DATE))
         ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id ASC LIMIT 100`,
        [req.wilson.userId],
      );
      const today = argentinaDate();
      const nextWeek = new Date(`${today}T00:00:00Z`);
      nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
      const nextWeekValue = nextWeek.toISOString().slice(0, 10);
      const buckets = { vencidas: [], hoy: [], revision: [], proximas: [], pendientes: [] };
      for (const task of result.rows) {
        const item = taskWithUrl(task, wilsonOperationalAuth(req.wilson));
        if (task.fecha_vencimiento && task.fecha_vencimiento < today) buckets.vencidas.push(item);
        else if (task.fecha_vencimiento === today) buckets.hoy.push(item);
        else if (normalizeWilsonText(task.estado).includes("revision")) buckets.revision.push(item);
        else if (task.fecha_vencimiento && task.fecha_vencimiento <= nextWeekValue) buckets.proximas.push(item);
        else buckets.pendientes.push(item);
      }
      return res.json({
        empleado: req.wilson.actorName,
        resumen: Object.fromEntries(Object.entries(buckets).map(([key, items]) => [key, items.length])),
        prioridades: buckets,
      });
    } catch (error) { return next(error); }
  });

  router.get("/contexto-rapido", async (req, res, next) => {
    if (!req.wilson.privateChat) return res.status(400).json({ error: "Este contexto se consulta únicamente por chat privado." });
    try {
      const selected = req.query.persona ? await resolveWilsonPersonFilter(pool, String(req.query.persona).trim())
        : { id: req.wilson.userId, nombre: req.wilson.actorName, rol: req.wilson.actorRole };
      if (selected.id !== req.wilson.userId && !isWilsonLeader(req)) {
        return res.status(403).json({ error: "Solo admin puede consultar el contexto de otra persona." });
      }
      const target = { name: selected.nombre || selected.usuario, role: selected.rol || "equipo" };
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,t.prioridad,
                t.propiedades_extra,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                t.created_at,t.updated_at,c.nombre AS cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
           AND EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$1)
           AND t.estado NOT IN ('finalizada','publicada')
         ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id ASC LIMIT 150`,
        [selected.id],
      );
      return res.json(buildMiaFastContext(result.rows, target));
    } catch (error) { return next(error); }
  });

  router.get("/tareas/:id", async (req, res, next) => {
    try {
      if(req.query?.include_archived!==undefined&&!['true','false'].includes(req.query.include_archived))return res.status(400).json({error:'include_archived inválido.'});
      const includeArchived=req.query?.include_archived==='true';
      if(includeArchived&&!isWilsonLeader(req))return res.status(403).json({error:'Solo admin puede consultar tareas archivadas.'});
      const task = await loadWilsonTask(pool, req.params.id,{includeArchived});
      if (!task) return res.status(404).json({ error: "La tarea no existe en RENDER OS o está archivada." });
      if (!isWilsonLeader(req, env) && !reviewTaskOwnedBy(task, req.wilson.userId)) {
        return res.status(403).json({ error: "Esta tarea no pertenece a tu reporte personal." });
      }
      return res.json({ task: taskWithUrl(task, wilsonOperationalAuth(req.wilson)) });
    } catch (error) { return next(error); }
  });

  router.get("/eventos-pendientes", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Esta cola es exclusiva del proceso automático de MIA." });
    try {
      const result = await pool.query(
        `SELECT id,titulo,propiedades_extra
         FROM tareas
         WHERE propiedades_extra->>'workspace'='render_os'
           AND propiedades_extra->'mia_notificacion_pendiente' IS NOT NULL
           AND jsonb_typeof(propiedades_extra->'mia_notificacion_pendiente')='object'
         ORDER BY updated_at ASC,id ASC LIMIT 50`,
      );
      return res.json({ events: result.rows.map(buildMiaPendingEvent).filter(Boolean) });
    } catch (error) { return next(error); }
  });

  router.get("/notificaciones-privadas", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Esta cola es exclusiva del proceso automático de MIA." });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 50));
    try {
      if (req.query.dry_run === "true") {
        const preview = await pool.query(`SELECT id,fingerprint,destinatario,destinatario_clave,tarea_id,feedback_id,motivo,mensaje,tarea_url,intentos,created_at
          FROM mia_private_task_notifications n WHERE cancelled_at IS NULL AND batch_parent_id IS NULL AND estado='pending'
          AND (not_before IS NULL OR not_before<=NOW()) AND ${buildTaskNotificationEligibilityPredicate('n')}
          ORDER BY created_at,id LIMIT $1`, [limit]);
        return res.json({ notifications: preview.rows, dry_run: true });
      }
      await enqueueDuePersonalListReminders(pool, { limit });
      const result = await pool.query(
        `WITH candidates AS (
           SELECT id FROM mia_private_task_notifications n
           WHERE cancelled_at IS NULL AND batch_parent_id IS NULL AND (not_before IS NULL OR not_before<=NOW())
             AND ${buildTaskNotificationEligibilityPredicate('n')}
             AND NOT EXISTS(SELECT 1 FROM mia_private_contact_limits l WHERE l.actor_hash=COALESCE(
               (SELECT actor_hash FROM mia_whatsapp_identities WHERE notification_key=destinatario_clave AND enabled IS TRUE),
               (SELECT whatsapp_id_hash FROM usuarios WHERE LOWER(usuario)=destinatario_clave LIMIT 1))
               AND (l.last_delivered_at>NOW()-INTERVAL '10 minutes' OR detalles->>'supervisor'='true' AND l.supervisor_window=
                 to_char(NOW() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD')||':'||CASE WHEN
                 (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::time<TIME '13:00' THEN 'am' ELSE 'pm' END))
             AND (estado='pending' OR (estado='sending' AND claimed_at < NOW()-INTERVAL '10 minutes'))
             AND (detalles->>'supervisor' IS DISTINCT FROM 'true' OR ($2::boolean
               AND EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'America/Argentina/Cordoba')<=6
               AND ((NOW() AT TIME ZONE 'America/Argentina/Cordoba')::time >= TIME '08:00' AND (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::time < TIME '13:00'
                 OR (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::time >= TIME '17:00' AND (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::time < TIME '21:30')))
           ORDER BY created_at,id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE mia_private_task_notifications notification
         SET estado='sending',claimed_at=NOW(),intentos=intentos+1
         FROM candidates
         WHERE notification.id=candidates.id
         RETURNING notification.id,notification.fingerprint,notification.destinatario,
           notification.destinatario_clave,notification.tarea_id,notification.feedback_id,notification.motivo,
           notification.mensaje,notification.tarea_url,notification.intentos,notification.created_at,notification.detalles`,
        [limit, env.MIA_SUPERVISOR_ENABLED === "true"],
      );
      return res.json({ notifications: result.rows });
    } catch (error) { return next(error); }
  });

  router.get("/notificaciones-privadas/:id/verificar", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Verificación exclusiva del proceso automático de Mía." });
    try {
      const result = await pool.query(`SELECT * FROM mia_private_task_notifications WHERE id=$1 AND fingerprint=$2`, [req.params.id,req.query.fingerprint]);
      const notification = result.rows[0];
      const deliverable = notification && notification.estado !== "delivered" && !notification.cancelled_at
        && await supervisorNotificationDeliverable(pool, notification, { env });
      return res.json({ deliverable: Boolean(deliverable) });
    } catch(error) { return next(error); }
  });

  router.post("/notificaciones-privadas/:id/entregada", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Esta cola es exclusiva del proceso automático de MIA." });
    const id = Number(req.params.id);
    const fingerprint = String(req.body?.fingerprint || "").trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return res.status(400).json({ error: "Notificación privada inválida." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE mia_private_task_notifications
         SET estado='delivered',delivered_at=NOW()
         WHERE id=$1 AND fingerprint=$2 AND estado='sending'
           AND cancelled_at IS NULL
         RETURNING *`,
        [id, fingerprint],
      );
      if (!result.rows[0]) {
        const previous = await client.query(`SELECT estado FROM mia_private_task_notifications WHERE id=$1 AND fingerprint=$2`, [id,fingerprint]);
        await client.query("COMMIT");
        if (previous.rows[0]?.estado === "delivered") return res.json({ delivered: true, id, idempotent: true });
        return res.status(409).json({ error: "La notificación cambió o fue cancelada." });
      }
      await acknowledgeSupervisorDelivery(client, result.rows[0]);
      await client.query("COMMIT");
      return res.json({ delivered: true, id });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); return next(error); }
    finally { client.release(); }
  });

  router.get("/resumenes-grupos", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Estos resúmenes son exclusivos del proceso automático de MIA." });
    try {
      const window = miaGroupDigestWindow();
      if (!window) return res.json({ digests: [], window: null });
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const result = await pool.query(
        `SELECT t.id,t.revision,t.titulo,t.estado,t.asignado_a,t.prioridad,t.tipo_tarea,t.subtipo,t.propiedades_extra,
          to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,c.nombre cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND c.activo IS TRUE
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
           AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
           AND t.estado IN ('pendiente','en_progreso','en_revision','aprobada','finalizada','publicada')
         ORDER BY t.fecha_vencimiento NULLS LAST,t.id`,
      );
      const weeklyWindow = ["semanal", "semanal_mensual", "control_semanal_tarde"].includes(window.type);
      const weeklyDigests = weeklyWindow
        ? buildMiaWeeklyCarruselDigest(result.rows, { today, followUp: window.type === "control_semanal_tarde" })
        : [];
      const includeGeneral = !["semanal", "control_semanal_tarde"].includes(window.type);
      const generalDigests = includeGeneral ? buildMiaGroupDigests(result.rows, { today })
        .filter((digest) => !window.criticalOnly || digest.level === "critico")
        .filter((digest) => !(window.type === "semanal_mensual" && digest.destination === "comunicacion")) : [];
      const digests = [...weeklyDigests, ...generalDigests]
        .map((digest) => ({ ...digest, schedule_type: window.type }));
      if (req.query.dry_run === "true") return res.json({ digests, dry_run: true });
      if (!digests.length) return res.json({ digests: [] });
      const claimed = [];
      for (const digest of digests) {
        const reservation = await pool.query(
          `INSERT INTO mia_group_digest_deliveries(fingerprint,destino,periodo,nivel,detalles,delivered_at)
           VALUES($1,$2,$3,$4,$5::jsonb,NOW())
           ON CONFLICT(fingerprint) DO UPDATE
             SET destino=EXCLUDED.destino,periodo=EXCLUDED.periodo,nivel=EXCLUDED.nivel,
                 detalles=EXCLUDED.detalles,delivered_at=NOW()
           WHERE (mia_group_digest_deliveries.detalles->>'status'='sending'
                    AND mia_group_digest_deliveries.delivered_at < NOW()-INTERVAL '10 minutes')
              OR (mia_group_digest_deliveries.detalles->>'status' IS DISTINCT FROM 'sending'
                    AND mia_group_digest_deliveries.delivered_at < NOW()-INTERVAL '24 hours')
           RETURNING fingerprint`,
          [digest.id, digest.destination, digest.period, digest.level,
            JSON.stringify({ status: "sending", task_ids: digest.task_ids, clients: digest.clients })],
        );
        if (reservation.rows[0]) claimed.push(digest);
      }
      return res.json({ digests: claimed });
    } catch (error) { return next(error); }
  });

  router.post("/resumenes-grupos/:fingerprint/entregado", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Esta confirmación es exclusiva del proceso automático de MIA." });
    const fingerprint = String(req.params.fingerprint || "").trim().toLowerCase();
    const destination = String(req.body?.destination || "").trim();
    const period = String(req.body?.period || "").trim();
    const level = String(req.body?.level || "").trim();
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !MIA_EVENT_GROUPS.has(destination)
      || !/^\d{4}-\d{2}$/.test(period) || !["riesgo", "critico"].includes(level)) {
      return res.status(400).json({ error: "Resumen de grupo inválido." });
    }
    try {
      await pool.query(
        `INSERT INTO mia_group_digest_deliveries(fingerprint,destino,periodo,nivel,detalles)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(fingerprint) DO UPDATE SET destino=EXCLUDED.destino,periodo=EXCLUDED.periodo,
           nivel=EXCLUDED.nivel,detalles=EXCLUDED.detalles,delivered_at=NOW()`,
        [fingerprint, destination, period, level, JSON.stringify({ status: "delivered", task_ids: req.body?.task_ids || [], clients: req.body?.clients || [] })],
      );
      return res.json({ delivered: true, fingerprint });
    } catch (error) { return next(error); }
  });

  router.post("/eventos/:taskId/entregado", async (req, res, next) => {
    if (!isWilsonSystemActor(req, env)) return res.status(403).json({ error: "Esta cola es exclusiva del proceso automático de MIA." });
    const taskId = Number(req.params.taskId);
    const eventId = String(req.body?.evento_id || "").trim();
    if (!Number.isInteger(taskId) || taskId <= 0 || !eventId) return res.status(400).json({ error: "Evento inválido." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT id,titulo,propiedades_extra FROM tareas
         WHERE id=$1 AND propiedades_extra->>'workspace'='render_os' FOR UPDATE`, [taskId],
      );
      const task = current.rows[0];
      const event = buildMiaPendingEvent(task);
      if (!event || event.id !== eventId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El evento cambió, ya fue entregado o no existe." });
      }
      const properties = {
        ...task.propiedades_extra,
        mia_notificacion_pendiente: null,
        mia_notificacion_ultima: {
          evento_id: event.id,
          tipo: event.type,
          entregado_en: new Date().toISOString(),
          destino: event.destination,
        },
      };
      await client.query(`UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1`, [taskId, JSON.stringify(properties)]);
      await writeWilsonAudit(client, req, { action: "entregar_evento_mia", taskId, details: { eventId, destination: event.destination } });
      await client.query("COMMIT");
      return res.json({ delivered: true, event_id: event.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  router.post("/tareas/:id/confirmar-grabacion", async (req, res, next) => {
    if (req.wilson.channel !== "whatsapp") return res.status(400).json({ error: "Esta confirmación se realiza desde WhatsApp." });
    if (!isWilsonLeader(req, env)) return res.status(403).json({ error: "Solo Agustín o Franco pueden confirmar la grabación." });
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: "Tarea inválida." });
    const expectedRevision = req.body?.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({ error: "Recargá la visita: falta una revisión válida para confirmar la grabación." });
    }
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      if (!await consumeWilsonConfirmation(client, req, res, "confirmar_grabacion", taskId)) {
        await client.query("ROLLBACK");
        return undefined;
      }
      result = await confirmProduction({
        taskId, actor: req.wilson.actorName, db: client,
        expectedRevision, actorId: req.wilson.userId,
      });
      await writeWilsonAudit(client, req, { action: "confirmar_grabacion", taskId });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally { client.release(); }
    // The external-transaction callback does not notify. Do so only after the
    // token, production work and audit have committed on this same client.
    if (result?.created && result.editing_task) {
      try {
        await notifyAssignment?.({ pool, tarea: result.editing_task, motivo: "creada", actor: req.wilson.actorName, actorId: req.wilson.userId });
      } catch { /* Notification failure cannot undo an already committed task. */ }
    }
    return res.json({ ...result,
      task: taskWithUrl(result.task, wilsonOperationalAuth(req.wilson)),
      editing_task: result.editing_task ? taskWithUrl(result.editing_task, wilsonOperationalAuth(req.wilson)) : result.editing_task,
    });
  });

  // The four receipt-backed operations share atomic identity/CAS/token rules.
  async function executeTaskReceiptOperation(req,res,next,operation) {
    let client,response,status=200,email=null;
    try {
      requireTaskOperationHuman(req.wilson,operation);
      const intent=canonicalTaskOperationIntent(req.body||{}, {operation,targetId:operation==='crear'?null:Number(req.params.id)});
      const key=taskOperationKey(req.headers,req.body),payloadHash=taskOperationIntentHash(intent);
      client=await pool.connect();
      await client.query('BEGIN');
      const actor=await lockTaskOperationActor(client,req,operation,env);
      const prior=await findTaskOperationReceipt(client,{userId:actor.id,operation,key,payloadHash});
      // Both replay and first execution acquire the established global lock
      // before any task lock. No registry-to-existing-task lock inversion.
      if(prior) {
        await lockProductionObjectiveLinks(client);
        response=await taskOperationReplay(client,req,prior);
        await client.query('COMMIT');
        return res.json(response);
      }
      const current=await prepareTaskOperationTarget(client,req,intent);
      const prepared=['crear','editar'].includes(operation)?await prepareWilsonTaskOperation(client,intent,current):{selections:{}};
      assertTaskOperationSelectionPermission(req,prepared.selections);
      const changedFields=[];
      const desired=prepared.task;
      if(operation==='editar') {
        const comparisons={
          titulo:[current.titulo,desired.titulo],asignado_a:[current.asignado_a,desired.asignado_a],
          colaboradores:[JSON.stringify(current.propiedades_extra?.colaboradores||[]),JSON.stringify(desired.colaboradores||[])],
          cliente_id:[current.cliente_id,desired.cliente_id],fecha_vencimiento:[current.fecha_vencimiento,desired.fecha_vencimiento],
          tipo_tarea:[current.tipo_tarea,desired.tipo_tarea],subtipo:[current.subtipo||null,desired.subtipo],
          prioridad:[current.prioridad,desired.prioridad],aclaraciones:[current.aclaraciones||null,desired.aclaraciones],
          material_referencia:[current.material_referencia||null,desired.material_referencia],
          referencia:[current.propiedades_extra?.referencia||null,desired.referencia],
          produccion_videos_previstos:[current.propiedades_extra?.produccion_videos_previstos??null,desired.produccion_videos_previstos],
        };
        for(const [field,[before,after]] of Object.entries(comparisons))if(before!==after)changedFields.push(field);
        if(prepared.assignment) {
          if(current.asignado_a_id!==prepared.assignment.ownerId)changedFields.push('asignado_a_id');
          if(JSON.stringify([...current.colaborador_ids].sort((a,b)=>a-b))!==JSON.stringify([...prepared.assignment.collaboratorIds].sort((a,b)=>a-b)))changedFields.push('colaborador_ids');
        }
      }
      if(operation==='crear'&&!intent.permitir_duplicado) {
        const existing=await client.query(`SELECT t.id,t.revision,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.material_referencia,
          to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,c.nombre cliente_nombre
          FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.propiedades_extra->>'workspace'='render_os'
          AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
          AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true' AND t.cliente_id=$1
          AND ($2::boolean OR EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$3))
          ORDER BY t.id DESC LIMIT 100`,[desired.cliente_id,isWilsonLeader(req),actor.id]);
        const duplicates=findWilsonDuplicates(desired,existing.rows);
        if(duplicates.length)throw Object.assign(taskOperationError('Encontré una posible tarea duplicada.'),{duplicates});
      }
      await consumeTaskOperationConfirmation(client,req,intent,key,prepared.selections);
      let task=current,outcome;
      if(operation==='crear') {
        const properties={workspace:'render_os',Origen:`Creada por Wilson desde ${req.wilson.channel==='whatsapp'?'WhatsApp':'Telegram'}`,
          origen_integracion:'wilson',wilson_channel:req.wilson.channel,wilson_actor_id:req.wilson.actorId,
          wilson_confirmado_por:actor.nombre,colaboradores:desired.colaboradores};
        if(desired.referencia)properties.referencia=desired.referencia;
        if(desired.produccion_videos_previstos!==null)properties.produccion_videos_previstos=desired.produccion_videos_previstos;
        task=(await client.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,requiere_aprobacion,propiedades_extra,
          fecha_vencimiento,tipo_tarea,subtipo,prioridad,aclaraciones,material_referencia)
          VALUES($1,$2,$3,'pendiente',false,$4::jsonb,$5,$6,$7,$8,$9,$10)
          RETURNING *,to_char(fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento`,
        [desired.titulo,desired.asignado_a,desired.cliente_id,JSON.stringify(properties),desired.fecha_vencimiento,
          desired.tipo_tarea,desired.subtipo,desired.prioridad,desired.aclaraciones,desired.material_referencia])).rows[0];
        await replaceTaskAssignments(client,task.id,prepared.assignment);
        await syncProductionVisitFromTask(client,task,actor.id);
        outcome='created';status=201;
      } else if(operation==='editar') {
        outcome=changedFields.length?'updated':'unchanged';
        if(changedFields.length) {
          const properties={...current.propiedades_extra,origen_integracion:'wilson'};
          if(prepared.assignment)properties.colaboradores=desired.colaboradores;
          if(desired.referencia)properties.referencia=desired.referencia;else delete properties.referencia;
          if(desired.produccion_videos_previstos!==null)properties.produccion_videos_previstos=desired.produccion_videos_previstos;else delete properties.produccion_videos_previstos;
          task=(await client.query(`UPDATE tareas SET titulo=$2,asignado_a=$3,cliente_id=$4,fecha_vencimiento=$5,tipo_tarea=$6,
            subtipo=$7,prioridad=$8,aclaraciones=$9,material_referencia=$10,propiedades_extra=$11::jsonb,updated_at=NOW()
            WHERE id=$1 AND revision=$12 RETURNING *,to_char(fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento`,
          [current.id,desired.titulo,desired.asignado_a,desired.cliente_id,desired.fecha_vencimiento,desired.tipo_tarea,desired.subtipo,
            desired.prioridad,desired.aclaraciones,desired.material_referencia,JSON.stringify(properties),intent.expected_revision])).rows[0];
          if(!task)throw taskOperationError('La tarea cambió.');
          if(prepared.assignment)await replaceTaskAssignments(client,task.id,prepared.assignment);
          await syncProductionVisitFromTask(client,task,actor.id);
        }
      } else if(operation==='archivar') {
        task=(await client.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||'{"archivada_render_os":true}'::jsonb,updated_at=NOW()
          WHERE id=$1 AND revision=$2 RETURNING *,to_char(fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento`,[current.id,intent.expected_revision])).rows[0];
        if(!task)throw taskOperationError('La tarea cambió.');
        await syncProductionVisitFromTask(client,task,actor.id);
        outcome='archived';
      } else {
        await client.query('DELETE FROM tareas WHERE id=$1 AND revision=$2',[current.id,intent.expected_revision]);
        outcome='deleted';
      }
      await writeWilsonAudit(client,req,{action:{crear:'crear_tarea',editar:'editar_tarea',archivar:'archivar_tarea',eliminar:'eliminar_tarea'}[operation],
        taskId:task.id,details:{outcome,changed_fields:changedFields}});
      if(['created','updated'].includes(outcome)) {
        const assigned=(await annotateTaskAssignments(client,[task]))[0];
        const beforeIds=new Set(current?[current.asignado_a_id,...current.colaborador_ids].filter(validUserId):[]);
        const recipientIds=[...new Set([assigned.asignado_a_id,...assigned.colaborador_ids].filter(id=>validUserId(id)&&!beforeIds.has(id)&&id!==actor.id))];
        if(recipientIds.length) {
          const options={pool:client,tarea:assigned,motivo:operation==='crear'?'creada':'reasignada',destinatarioIds:recipientIds,actorId:actor.id,actor:actor.nombre,env};
          await encolarNotificacionPrivadaTarea(options);
          email={...options,pool};
        }
        task=assigned;
      }
      const receipt=await insertTaskOperationReceipt(client,{userId:actor.id,operation,key,payloadHash,task,outcome,changedFields});
      response={idempotent:false,created:outcome==='created',updated:outcome==='updated',archived:outcome==='archived',deleted:outcome==='deleted',
        task_id:task.id,id:task.id,receipt:taskOperationReceiptDto(receipt),changed_fields:changedFields,
        task:outcome==='deleted'?null:taskWithUrl(task,wilsonOperationalAuth(req.wilson))};
      await client.query('COMMIT');
    } catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      if(error.status)return res.status(error.status).json({error:error.message,...(error.duplicates?{duplicates:error.duplicates.map(task=>taskWithUrl(task,wilsonOperationalAuth(req.wilson)))}:{})});
      if(productionEditorialConflict(error)||(error.code==='23503'&&['produccion_visitas_tarea_origen_id_fkey','produccion_videos_tarea_edicion_id_fkey'].includes(error.constraint)))return res.status(409).json({error:'La tarea conserva vínculos de Producciones/editorial. No se pueden borrar o cambiar sus relaciones.'});
      return next(error);
    } finally {client?.release();}
    // Email-only, best effort: a failure cannot roll back an already committed
    // receipt and must never enqueue another private notification.
    if(email)try{await notifyTaskReceiptEmail?.(email);}catch{/* Delivery remains uncertified. */}
    return res.status(status).json(response);
  }
  router.post("/tareas",(req,res,next)=>executeTaskReceiptOperation(req,res,next,'crear'));
  router.patch("/tareas/:id",(req,res,next)=>executeTaskReceiptOperation(req,res,next,'editar'));
  router.post("/tareas/:id/archivar",(req,res,next)=>executeTaskReceiptOperation(req,res,next,'archivar'));
  router.delete("/tareas/:id",(req,res,next)=>executeTaskReceiptOperation(req,res,next,'eliminar'));
  return router;
}
