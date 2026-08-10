import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";

const DEFAULT_PUBLIC_KEY = fs.readFileSync(new URL("./wilson-public-key.pem", import.meta.url), "utf8");
const DEFAULT_ALLOWED_TELEGRAM_IDS = ["1826333320", "1890547269"];
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000;
const usedNonces = new Map();

const SECTORS = new Map([
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

export function validateWilsonConfirmation({ confirmed, confirmedAt, now = Date.now(), maxAgeMs = CONFIRMATION_MAX_AGE_MS }) {
  if (confirmed !== true) return "La operación todavía no fue confirmada.";
  const timestamp = Date.parse(String(confirmedAt || ""));
  if (!Number.isFinite(timestamp)) return "Falta la fecha de confirmación.";
  if (timestamp > now + 30_000 || now - timestamp > maxAgeMs) {
    return "La confirmación venció. Volvé a revisar y confirmar la operación.";
  }
  return null;
}

export function requireWilsonService(env = process.env, now = () => Date.now()) {
  return (req, res, next) => {
    const timestamp = String(req.headers?.["x-wilson-timestamp"] || "").trim();
    const nonce = String(req.headers?.["x-wilson-nonce"] || "").trim();
    const signature = String(req.headers?.["x-wilson-signature"] || "").trim();
    const channel = String(req.headers?.["x-wilson-channel"] || "telegram").trim().toLowerCase();
    const actorId = String(req.headers?.["x-wilson-actor-id"] || req.headers?.["x-telegram-user-id"] || req.body?.telegram_user_id || "").trim();
    const groupId = String(req.headers?.["x-wilson-group-id"] || "").trim();
    const actorName = String(req.headers?.["x-wilson-actor-name"] || "").trim();
    const allowedIds = channel === "whatsapp"
      ? csv(env.WILSON_ALLOWED_WHATSAPP_IDS)
      : csv(env.WILSON_ALLOWED_TELEGRAM_IDS || DEFAULT_ALLOWED_TELEGRAM_IDS.join(","));
    if (!allowedIds.includes(actorId)) return res.status(403).json({ error: `Esta cuenta de ${channel === "whatsapp" ? "WhatsApp" : "Telegram"} no puede operar tareas.` });
    if (channel === "whatsapp" && !csv(env.WILSON_ALLOWED_WHATSAPP_GROUP_IDS).includes(groupId)) {
      return res.status(403).json({ error: "Este grupo de WhatsApp no puede operar tareas." });
    }
    const timestampMs = Number(timestamp) * 1000;
    if (!timestamp || !nonce || !signature || !Number.isFinite(timestampMs)
      || Math.abs(now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Firma de Wilson ausente o vencida." });
    }
    for (const [savedNonce, expiresAt] of usedNonces) if (expiresAt <= now()) usedNonces.delete(savedNonce);
    if (usedNonces.has(nonce)) return res.status(409).json({ error: "La solicitud de Wilson ya fue utilizada." });
    const path = `${req.baseUrl}${req.path}`;
    const signatureVersion = String(req.headers?.["x-wilson-signature-version"] || "").trim();
    const message = signatureVersion === "2"
      ? buildWilsonSignatureMessage({ timestamp, nonce, channel, actorId, groupId, actorName, method: req.method, path, body: req.body })
      : buildWilsonSignatureMessage({ timestamp, nonce, telegramUserId: actorId, method: req.method, path, body: req.body });
    const publicKey = env.WILSON_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    let valid = false;
    try {
      valid = crypto.verify("sha256", Buffer.from(message), publicKey, Buffer.from(signature, "base64"));
    } catch { valid = false; }
    if (!valid) return res.status(401).json({ error: "Firma de Wilson inválida." });
    usedNonces.set(nonce, now() + SIGNATURE_MAX_AGE_MS);
    req.wilson = {
      channel, actorId, groupId,
      actorName: actorName || (channel === "telegram" ? "Usuario de Telegram" : "Usuario de WhatsApp"),
      telegramUserId: channel === "telegram" ? actorId : "",
      confirmedBy: actorName || (channel === "telegram" ? "Usuario de Telegram" : "Usuario de WhatsApp"),
    };
    return next();
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

export function buildWilsonTask(input, { clients, users }) {
  const title = String(input.titulo || "").trim();
  const dueDate = String(input.fecha_vencimiento || input.vencimiento || "").trim();
  const client = input.cliente_id
    ? clients.find((item) => String(item.id) === String(input.cliente_id))
    : exactMatch(clients, input.cliente, ["nombre"]);
  const user = exactMatch(users, input.responsable || input.asignado_a, ["nombre", "usuario"]);
  const sector = SECTORS.get(String(input.sector || input.lista || input.tipo_tarea || "").trim().toLowerCase());
  const priority = String(input.prioridad || "media").trim().toLowerCase();
  const errors = [];
  if (!title) errors.push("Falta el título.");
  if (!client) errors.push("El cliente no coincide con un cliente del sistema.");
  if (!user) errors.push("El responsable no coincide con un usuario del sistema.");
  if (!validDate(dueDate)) errors.push("Falta una fecha válida con formato YYYY-MM-DD.");
  if (!sector) errors.push("El sector debe ser Diseño, Edición, Producción, Community o Administración.");
  if (!PRIORITIES.has(priority)) errors.push("La prioridad debe ser baja, media o alta.");
  const description = String(input.descripcion || input.aclaraciones || "").trim();
  const reference = String(input.referencia || "").trim();
  const notes = [description, reference && !description.includes(reference) ? `Referencia: ${reference}` : ""].filter(Boolean).join("\n");
  return {
    errors,
    task: errors.length ? null : {
      titulo: title,
      asignado_a: user.nombre,
      cliente_id: client.id,
      cliente_nombre: client.nombre,
      estado: "pendiente",
      fecha_vencimiento: dueDate,
      tipo_tarea: sector,
      subtipo: String(input.subtipo || "").trim() || null,
      prioridad: priority,
      aclaraciones: notes || null,
      material_referencia: String(input.material || input.material_referencia || "").trim() || null,
      referencia: reference || null,
    },
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
      asignado_a: task.asignado_a, fecha_vencimiento: task.fecha_vencimiento,
      estado: task.estado, razones: reasons,
      url: `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}`,
    }] : [];
  });
}

async function loadCatalog(db) {
  const [clients, users] = await Promise.all([
    db.query("SELECT id,nombre FROM clientes ORDER BY nombre"),
    db.query("SELECT id,usuario,nombre,rol FROM usuarios ORDER BY nombre"),
  ]);
  return { clients: clients.rows, users: users.rows };
}

async function validate(db, body) {
  const normalized = buildWilsonTask(body, await loadCatalog(db));
  if (normalized.errors.length) return { ...normalized, duplicates: [] };
  const task = normalized.task;
  const existing = await db.query(
    `SELECT t.id,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.material_referencia,
            to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,c.nombre AS cliente_nombre
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
     WHERE t.propiedades_extra->>'workspace'='render_os'
       AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
       AND t.cliente_id=$1 ORDER BY t.id DESC LIMIT 100`,
    [task.cliente_id],
  );
  return { ...normalized, duplicates: findWilsonDuplicates(task, existing.rows) };
}

function taskWithUrl(task) {
  return { ...task, url: `https://sistema.rendercorrientes.com/workspace/tareas?task=${task.id}` };
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

export function buildWilsonTaskUpdate(input, currentTask, catalog) {
  const appendDescription = String(input.append_descripcion || "").trim();
  const description = appendDescription
    ? appendWilsonDescription(currentTask.aclaraciones, appendDescription)
    : hasOwn(input, "descripcion")
      ? input.descripcion
      : currentTask.aclaraciones;
  const merged = {
    titulo: hasOwn(input, "titulo") ? input.titulo : currentTask.titulo,
    descripcion: description,
    cliente_id: hasOwn(input, "cliente_id")
      ? input.cliente_id
      : hasOwn(input, "cliente") ? undefined : currentTask.cliente_id,
    cliente: hasOwn(input, "cliente") ? input.cliente : currentTask.cliente_nombre,
    responsable: hasOwn(input, "responsable") ? input.responsable : currentTask.asignado_a,
    fecha_vencimiento: hasOwn(input, "fecha_vencimiento") ? input.fecha_vencimiento : currentTask.fecha_vencimiento,
    sector: hasOwn(input, "sector") ? input.sector : currentTask.tipo_tarea,
    prioridad: hasOwn(input, "prioridad") ? input.prioridad : currentTask.prioridad,
    material: hasOwn(input, "material") ? input.material : currentTask.material_referencia,
    referencia: hasOwn(input, "referencia")
      ? input.referencia
      : currentTask.propiedades_extra?.referencia || "",
    subtipo: hasOwn(input, "subtipo") ? input.subtipo : currentTask.subtipo,
  };
  return buildWilsonTask(merged, catalog);
}

async function loadWilsonTask(db, taskId, { forUpdate = false } = {}) {
  const result = await db.query(
    `SELECT t.id,t.titulo,t.asignado_a,t.cliente_id,t.estado,t.propiedades_extra,
            to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
            t.tipo_tarea,t.subtipo,t.prioridad,t.aclaraciones,t.material_referencia,
            t.created_at,t.updated_at,c.nombre AS cliente_nombre
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
     WHERE t.id=$1
       AND t.propiedades_extra->>'workspace'='render_os'
       AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
     ${forUpdate ? "FOR UPDATE OF t" : ""}`,
    [taskId],
  );
  return result.rows[0] || null;
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

function requireRecentConfirmation(req, res) {
  if (req.wilson.channel !== "whatsapp") {
    if (req.body?.confirmado === true) return true;
    res.status(400).json({ error: "La operación todavía no fue confirmada." });
    return false;
  }
  const error = validateWilsonConfirmation({ confirmed: req.body?.confirmado, confirmedAt: req.body?.confirmado_en });
  if (!error) return true;
  res.status(400).json({ error });
  return false;
}

function isWilsonLeader(req, env) {
  if (req.wilson.channel === "telegram") return csv(env.WILSON_LEADER_TELEGRAM_IDS || DEFAULT_ALLOWED_TELEGRAM_IDS.join(",")).includes(req.wilson.actorId);
  return csv(env.WILSON_LEADER_WHATSAPP_IDS).includes(req.wilson.actorId);
}

export function createWilsonRouter({ pool, notifyAssignment, env = process.env }) {
  const router = express.Router();
  router.use(requireWilsonService(env));

  router.get("/catalogo", async (_req, res, next) => {
    try {
      const catalog = await loadCatalog(pool);
      res.json({ ...catalog, sectors: [...new Set(SECTORS.values())], priorities: [...PRIORITIES] });
    } catch (error) { next(error); }
  });

  router.post("/tareas/validar", async (req, res, next) => {
    try {
      const result = await validate(pool, req.body);
      res.status(result.errors.length ? 422 : 200).json(result);
    } catch (error) { next(error); }
  });

  router.get("/tareas", async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
      const result = await pool.query(
        `SELECT t.id,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,t.prioridad,
                t.propiedades_extra,t.aclaraciones,t.material_referencia,
                to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
                t.created_at,t.updated_at,c.nombre AS cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
         ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id ASC LIMIT $1`,
        [limit],
      );
      return res.json({ tasks: result.rows.map(taskWithUrl), limit });
    } catch (error) { return next(error); }
  });

  router.get("/tareas/:id", async (req, res, next) => {
    try {
      const task = await loadWilsonTask(pool, req.params.id);
      if (!task) return res.status(404).json({ error: "La tarea no existe en RENDER OS o está archivada." });
      return res.json({ task: taskWithUrl(task) });
    } catch (error) { return next(error); }
  });

  router.patch("/tareas/:id", async (req, res, next) => {
    if (!requireRecentConfirmation(req, res)) return undefined;
    const key = String(req.headers?.["idempotency-key"] || req.body?.idempotency_key || "").trim();
    if (!key) return res.status(400).json({ error: "Falta idempotency_key." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wilson:update:${req.params.id}:${key}`]);
      const current = await loadWilsonTask(client, req.params.id, { forUpdate: true });
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "La tarea no existe en RENDER OS o está archivada." });
      }
      if (current.propiedades_extra?.wilson_last_update_key === key) {
        await client.query("COMMIT");
        return res.json({ updated: false, idempotent: true, changed_fields: [], task: taskWithUrl(current) });
      }

      const result = buildWilsonTaskUpdate(req.body, current, await loadCatalog(client));
      if (result.errors.length) {
        await client.query("ROLLBACK");
        return res.status(422).json(result);
      }
      const task = result.task;
      const comparisons = {
        titulo: [current.titulo, task.titulo],
        asignado_a: [current.asignado_a, task.asignado_a],
        cliente_id: [String(current.cliente_id), String(task.cliente_id)],
        fecha_vencimiento: [current.fecha_vencimiento, task.fecha_vencimiento],
        tipo_tarea: [current.tipo_tarea, task.tipo_tarea],
        subtipo: [current.subtipo || "", task.subtipo || ""],
        prioridad: [current.prioridad, task.prioridad],
        aclaraciones: [current.aclaraciones || "", task.aclaraciones || ""],
        material_referencia: [current.material_referencia || "", task.material_referencia || ""],
        referencia: [current.propiedades_extra?.referencia || "", task.referencia || ""],
      };
      const changedFields = Object.entries(comparisons)
        .filter(([, [before, after]]) => before !== after)
        .map(([field]) => field);
      if (!changedFields.length) {
        await client.query("COMMIT");
        return res.json({ updated: false, idempotent: false, changed_fields: [], task: taskWithUrl(current) });
      }

      const properties = {
        ...current.propiedades_extra,
        origen_integracion: "wilson",
        wilson_last_update_key: key,
        wilson_last_update_channel: req.wilson.channel,
        wilson_last_update_actor_id: req.wilson.actorId,
        wilson_last_update_confirmado_por: req.wilson.confirmedBy,
        wilson_last_update_at: new Date().toISOString(),
      };
      if (task.referencia) properties.referencia = task.referencia;
      else delete properties.referencia;
      const updated = await client.query(
        `UPDATE tareas SET titulo=$2,asignado_a=$3,cliente_id=$4,fecha_vencimiento=$5,
          tipo_tarea=$6,subtipo=$7,prioridad=$8,aclaraciones=$9,material_referencia=$10,
          propiedades_extra=$11::jsonb,updated_at=NOW()
         WHERE id=$1
         RETURNING id,titulo,asignado_a,cliente_id,estado,propiedades_extra,
          to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,
          prioridad,aclaraciones,material_referencia,created_at,updated_at`,
        [current.id,task.titulo,task.asignado_a,task.cliente_id,task.fecha_vencimiento,
          task.tipo_tarea,task.subtipo,task.prioridad,task.aclaraciones,task.material_referencia,
          JSON.stringify(properties)],
      );
      await writeWilsonAudit(client, req, { action: "editar_tarea", taskId: current.id, details: { changedFields, idempotencyKey: key } });
      await client.query("COMMIT");
      const updatedTask = { ...updated.rows[0], cliente_nombre: task.cliente_nombre };
      res.json({ updated: true, idempotent: false, changed_fields: changedFields, task: taskWithUrl(updatedTask) });
      if (changedFields.includes("asignado_a")) notifyAssignment?.({ pool, tarea: updatedTask, motivo: "reasignada" });
      return undefined;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally { client.release(); }
  });

  router.post("/tareas", async (req, res, next) => {
    if (!requireRecentConfirmation(req, res)) return undefined;
    const key = String(req.headers?.["idempotency-key"] || req.body?.idempotency_key || "").trim();
    if (!key) return res.status(400).json({ error: "Falta idempotency_key." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wilson:${key}`]);
      const prior = await client.query(
        `SELECT t.*,c.nombre AS cliente_nombre,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.propiedades_extra->>'workspace'='render_os'
           AND t.propiedades_extra->>'wilson_idempotency_key'=$1 LIMIT 1`, [key],
      );
      if (prior.rows[0]) {
        await client.query("COMMIT");
        return res.json({ created: false, idempotent: true, task: taskWithUrl(prior.rows[0]) });
      }
      const result = await validate(client, req.body);
      if (result.errors.length) { await client.query("ROLLBACK"); return res.status(422).json(result); }
      if (result.duplicates.length && req.body.permitir_duplicado !== true) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Encontré una posible tarea duplicada.", duplicates: result.duplicates });
      }
      const task = result.task;
      const properties = {
        workspace: "render_os", Origen: `Creada por Wilson desde ${req.wilson.channel === "whatsapp" ? "WhatsApp" : "Telegram"}`, origen_integracion: "wilson",
        wilson_idempotency_key: key, wilson_channel: req.wilson.channel, wilson_actor_id: req.wilson.actorId,
        wilson_confirmado_por: req.wilson.confirmedBy, ...(task.referencia ? { referencia: task.referencia } : {}),
      };
      const inserted = await client.query(
        `INSERT INTO tareas (titulo,asignado_a,cliente_id,estado,requiere_aprobacion,propiedades_extra,
          fecha_vencimiento,tipo_tarea,subtipo,prioridad,aclaraciones,material_referencia)
         VALUES ($1,$2,$3,'pendiente',false,$4::jsonb,$5,$6,$7,$8,$9,$10)
         RETURNING id,titulo,asignado_a,cliente_id,estado,propiedades_extra,
          to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,prioridad,
          aclaraciones,material_referencia,created_at,updated_at`,
        [task.titulo,task.asignado_a,task.cliente_id,JSON.stringify(properties),task.fecha_vencimiento,
          task.tipo_tarea,task.subtipo,task.prioridad,task.aclaraciones,task.material_referencia],
      );
      await writeWilsonAudit(client, req, { action: "crear_tarea", taskId: inserted.rows[0].id, details: { idempotencyKey: key } });
      await client.query("COMMIT");
      const createdTask = { ...inserted.rows[0], cliente_nombre: task.cliente_nombre };
      res.status(201).json({ created: true, idempotent: false, task: taskWithUrl(createdTask) });
      notifyAssignment?.({ pool, tarea: createdTask, motivo: "creada" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  router.post("/tareas/:id/archivar", async (req, res, next) => {
    if (!requireRecentConfirmation(req, res)) return undefined;
    const key = String(req.headers?.["idempotency-key"] || req.body?.idempotency_key || "").trim();
    if (!key) return res.status(400).json({ error: "Falta idempotency_key." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wilson:archive:${req.params.id}:${key}`]);
      const current = await loadWilsonTask(client, req.params.id, { forUpdate: true });
      if (!current) { await client.query("ROLLBACK"); return res.status(404).json({ error: "La tarea no existe en RENDER OS o ya está archivada." }); }
      const properties = { ...current.propiedades_extra, archivada_render_os: true, wilson_archive_key: key };
      const updated = await client.query(
        `UPDATE tareas SET propiedades_extra=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id,titulo,estado,propiedades_extra,updated_at`,
        [current.id, JSON.stringify(properties)],
      );
      await writeWilsonAudit(client, req, { action: "archivar_tarea", taskId: current.id, details: { idempotencyKey: key } });
      await client.query("COMMIT");
      return res.json({ archived: true, task: taskWithUrl(updated.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally { client.release(); }
  });

  router.delete("/tareas/:id", async (req, res, next) => {
    if (!isWilsonLeader(req, env)) return res.status(403).json({ error: "Solo Agustín o Franco pueden eliminar definitivamente una tarea." });
    if (!requireRecentConfirmation(req, res)) return undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id,titulo FROM tareas WHERE id=$1
           AND propiedades_extra->>'workspace'='render_os'
           AND propiedades_extra->>'archivada_render_os'='true' FOR UPDATE`,
        [req.params.id],
      );
      const task = result.rows[0];
      if (!task) { await client.query("ROLLBACK"); return res.status(404).json({ error: "La tarea no existe en la Papelera de RENDER OS." }); }
      await writeWilsonAudit(client, req, { action: "eliminar_tarea", taskId: task.id, details: { titulo: task.titulo } });
      await client.query("DELETE FROM tareas WHERE id=$1", [task.id]);
      await client.query("COMMIT");
      return res.json({ deleted: true, id: task.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally { client.release(); }
  });

  return router;
}
