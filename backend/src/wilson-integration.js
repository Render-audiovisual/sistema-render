import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";

const DEFAULT_PUBLIC_KEY = fs.readFileSync(new URL("./wilson-public-key.pem", import.meta.url), "utf8");
const DEFAULT_ALLOWED_TELEGRAM_IDS = ["1826333320", "1890547269"];
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
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

export function buildWilsonSignatureMessage({ timestamp, nonce, telegramUserId, method, path, body }) {
  const bodyHash = crypto.createHash("sha256").update(body === undefined ? "" : canonicalJson(body)).digest("hex");
  return [timestamp, nonce, telegramUserId, method.toUpperCase(), path, bodyHash].join("\n");
}

export function requireWilsonService(env = process.env, now = () => Date.now()) {
  return (req, res, next) => {
    const timestamp = String(req.headers?.["x-wilson-timestamp"] || "").trim();
    const nonce = String(req.headers?.["x-wilson-nonce"] || "").trim();
    const signature = String(req.headers?.["x-wilson-signature"] || "").trim();
    const telegramUserId = String(req.headers?.["x-telegram-user-id"] || req.body?.telegram_user_id || "").trim();
    const allowedIds = String(env.WILSON_ALLOWED_TELEGRAM_IDS || DEFAULT_ALLOWED_TELEGRAM_IDS.join(","))
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (!allowedIds.includes(telegramUserId)) return res.status(403).json({ error: "Esta cuenta de Telegram no puede crear tareas." });
    const timestampMs = Number(timestamp) * 1000;
    if (!timestamp || !nonce || !signature || !Number.isFinite(timestampMs)
      || Math.abs(now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({ error: "Firma de Wilson ausente o vencida." });
    }
    for (const [savedNonce, expiresAt] of usedNonces) if (expiresAt <= now()) usedNonces.delete(savedNonce);
    if (usedNonces.has(nonce)) return res.status(409).json({ error: "La solicitud de Wilson ya fue utilizada." });
    const path = `${req.baseUrl}${req.path}`;
    const message = buildWilsonSignatureMessage({ timestamp, nonce, telegramUserId, method: req.method, path, body: req.body });
    const publicKey = env.WILSON_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    let valid = false;
    try {
      valid = crypto.verify("sha256", Buffer.from(message), publicKey, Buffer.from(signature, "base64"));
    } catch { valid = false; }
    if (!valid) return res.status(401).json({ error: "Firma de Wilson inválida." });
    usedNonces.set(nonce, now() + SIGNATURE_MAX_AGE_MS);
    req.wilson = {
      telegramUserId,
      confirmedBy: String(req.headers?.["x-wilson-confirmed-by"] || req.body?.confirmado_por || "").trim() || "Franco o Agustín",
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

  router.post("/tareas", async (req, res, next) => {
    if (req.body?.confirmado !== true) return res.status(400).json({ error: "La tarea todavía no fue confirmada." });
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
        workspace: "render_os", Origen: "Creada por Wilson desde Telegram", origen_integracion: "wilson",
        wilson_idempotency_key: key, wilson_telegram_user_id: req.wilson.telegramUserId,
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
      await client.query(
        "INSERT INTO tarea_comentarios (tarea_id,autor,contenido) VALUES ($1,'Wilson',$2)",
        [inserted.rows[0].id, `[Actividad] Creó esta tarea desde Telegram. Confirmado por ${req.wilson.confirmedBy}.`],
      );
      await client.query("COMMIT");
      const createdTask = { ...inserted.rows[0], cliente_nombre: task.cliente_nombre };
      res.status(201).json({ created: true, idempotent: false, task: taskWithUrl(createdTask) });
      notifyAssignment?.({ pool, tarea: createdTask, motivo: "creada" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  return router;
}
