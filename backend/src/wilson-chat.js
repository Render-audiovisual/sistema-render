import crypto from "node:crypto";
import { buildTaskAccessClause, getTaskActor } from "./task-access.js";
import { rankTaskPriorities } from "./task-priority.js";
import { canRecordProduction, getProductionProgress, isProductionVisitTask, isValidProductionDate, nextProductionPeriod } from "./production-visits.js";

const TZ = "America/Argentina/Cordoba";

function localParts(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(now).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
}

export function wilsonPeriod(now = new Date()) {
  const p = localParts(now);
  return `${p.year}-${p.month}`;
}

export function shouldSendWilsonDigest(now = new Date()) {
  const p = localParts(now);
  const hour = Number(p.hour);
  if (hour !== 10) return null;
  const friday = p.weekday.toLowerCase().startsWith("fri");
  const monthly = Number(p.day) === 28;
  if (!friday && !monthly) return null;
  return { date: `${p.year}-${p.month}-${p.day}`, type: friday && monthly ? "semanal_mensual" : monthly ? "mensual" : "semanal" };
}

async function conversation(pool, userId, period = wilsonPeriod()) {
  const result = await pool.query(
    `INSERT INTO wilson_conversaciones(usuario_id,periodo) VALUES($1,$2)
     ON CONFLICT(usuario_id,periodo) DO UPDATE SET updated_at=NOW() RETURNING id,usuario_id,periodo`,
    [userId, period],
  );
  return result.rows[0];
}

async function append(pool, conversationId, sender, content, type = "mensaje", metadata = {}) {
  const result = await pool.query(
    `INSERT INTO wilson_mensajes(conversacion_id,remitente,contenido,tipo,metadata)
     VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,remitente,contenido,tipo,metadata,created_at`,
    [conversationId, sender, content, type, JSON.stringify(metadata)],
  );
  return result.rows[0];
}

async function personalTasks(pool, auth) {
  // Incluso los líderes reciben una cola personal; su permiso global de
  // administración no debe convertir a Wilson en un resumen de todo el equipo.
  const access = buildTaskAccessClause({ ...auth, rol: auth.rol === "admin" ? "personal" : auth.rol }, "t", "$1");
  const values = access.value ? [access.value] : [];
  const result = await pool.query(
    `SELECT t.id,t.titulo,t.estado,t.asignado_a,t.prioridad,t.tipo_tarea,t.subtipo,t.propiedades_extra,
      t.created_at,t.updated_at,c.nombre AS cliente_nombre,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,
      to_char(p.fecha_programada,'YYYY-MM-DD') publicacion_fecha_programada
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id LEFT JOIN publicaciones p ON p.id=t.publicacion_id
     WHERE t.propiedades_extra->>'workspace'='render_os'
       AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
       AND t.estado<>'publicada'${access.sql}
     ORDER BY t.fecha_vencimiento NULLS LAST,t.id`, values,
  );
  const today = localParts().year + "-" + localParts().month + "-" + localParts().day;
  const ranked = rankTaskPriorities(result.rows, { today, limit: 50 });
  const isOriana = auth.rol === "community" || String(auth.nombre || auth.usuario || "").toLowerCase().includes("oriana");
  if (!isOriana) return ranked;
  const reviewTasks = ranked.recommendations
    .filter((task) => task.estado === "en_revision")
    .map((task) => ({ ...task, waiting_review: false, priority_reasons: ["Lista para que la revises o publiques", ...(task.priority_reasons || []).filter((reason) => reason !== "Está esperando revisión")].slice(0, 3) }));
  return { ...ranked, recommendations: reviewTasks, summary: { ...ranked.summary, total: reviewTasks.length, waiting_review: 0 } };
}

function taskSummary(tasks, limit = 5) {
  return tasks.slice(0, limit).map((task, index) => `${index + 1}. ${task.titulo}${task.cliente_nombre ? ` — ${task.cliente_nombre}` : ""}`).join("\n");
}

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isCarrusel(task) {
  return normalizeText(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`).includes("carrusel");
}

export function buildEmployeeSnapshot(tasks = [], user = {}, period = wilsonPeriod()) {
  const currentTasks = tasks.filter((task) => {
    const date = String(task.fecha_vencimiento || task.updated_at || "").slice(0, 7);
    return date === period || task.estado !== "publicada";
  });
  const productionRecords = currentTasks.flatMap((task) => {
    const records = Array.isArray(task.propiedades_extra?.produccion_registros) ? task.propiedades_extra.produccion_registros : [];
    return records.filter((record) => String(record.periodo_objetivo || record.fecha || "").slice(0, 7) === period)
      .map((record) => ({ ...record, task_id: task.id, titulo: task.titulo, cliente_nombre: task.cliente_nombre }));
  });
  const role = user.rol;
  const relevant = role === "diseno" ? currentTasks.filter(isCarrusel)
    : role === "edicion" ? currentTasks.filter((task) => task.tipo_tarea === "edicion")
      : role === "produccion" ? currentTasks.filter(isProductionVisitTask)
        : role === "community" ? currentTasks.filter((task) => task.estado === "en_revision" || task.estado === "publicada")
          : currentTasks;
  return {
    user,
    tasks: relevant,
    productionRecords,
    videosRecorded: productionRecords.reduce((total, record) => total + (Number(record.cantidad) || 0), 0),
    pending: relevant.filter((task) => ["pendiente", "en_progreso"].includes(task.estado)),
    review: relevant.filter((task) => task.estado === "en_revision"),
    completed: relevant.filter((task) => task.estado === "publicada"),
  };
}

export function buildEmployeeStatusReply(snapshot, question = "") {
  const name = snapshot.user.nombre || snapshot.user.usuario || "Esta persona";
  const firstName = name.split(/\s+/)[0];
  const asksRecords = /registr|video|grabo|grabacion|film/.test(normalizeText(question));
  if (snapshot.user.rol === "produccion") {
    if (asksRecords) {
      if (!snapshot.productionRecords.length) return { text: `${firstName} todavía no registró videos en el sistema durante este mes.`, tasks: snapshot.tasks.filter(isProductionVisitTask) };
      const byClient = new Map();
      for (const record of snapshot.productionRecords) {
        const key = record.cliente_nombre || record.titulo || "Sin cliente";
        byClient.set(key, (byClient.get(key) || 0) + (Number(record.cantidad) || 0));
      }
      const detail = [...byClient].map(([client, amount]) => `${client}: ${amount}`).join(" · ");
      return { text: `Sí. ${firstName} registró ${snapshot.videosRecorded} video${snapshot.videosRecorded === 1 ? "" : "s"} este mes. ${detail}.`, tasks: snapshot.tasks.filter((task) => snapshot.productionRecords.some((record) => Number(record.task_id) === Number(task.id))) };
    }
    return { text: `${firstName} tiene ${snapshot.pending.length} visita${snapshot.pending.length === 1 ? "" : "s"} abierta${snapshot.pending.length === 1 ? "" : "s"}, ${snapshot.review.length} en revisión y ${snapshot.videosRecorded} videos registrados este mes.`, tasks: snapshot.pending };
  }
  if (snapshot.user.rol === "diseno") {
    return { text: `${firstName} tiene ${snapshot.pending.length} carrusel${snapshot.pending.length === 1 ? "" : "es"} pendiente${snapshot.pending.length === 1 ? "" : "s"}, ${snapshot.review.length} en revisión y ${snapshot.completed.length} finalizado${snapshot.completed.length === 1 ? "" : "s"} este mes.`, tasks: [...snapshot.review, ...snapshot.pending] };
  }
  if (snapshot.user.rol === "edicion") {
    return { text: `${firstName} tiene ${snapshot.pending.length} edición${snapshot.pending.length === 1 ? "" : "es"} pendiente${snapshot.pending.length === 1 ? "" : "s"}, ${snapshot.review.length} en revisión y ${snapshot.completed.length} finalizada${snapshot.completed.length === 1 ? "" : "s"} este mes.`, tasks: [...snapshot.review, ...snapshot.pending] };
  }
  if (snapshot.user.rol === "community") {
    return { text: `${firstName} tiene ${snapshot.review.length} tarea${snapshot.review.length === 1 ? "" : "s"} para revisar o publicar y ${snapshot.completed.length} finalizada${snapshot.completed.length === 1 ? "" : "s"} este mes.`, tasks: snapshot.review };
  }
  return { text: `${name} tiene ${snapshot.pending.length} tareas abiertas, ${snapshot.review.length} en revisión y ${snapshot.completed.length} finalizadas este mes.`, tasks: [...snapshot.review, ...snapshot.pending] };
}

async function resolveTargetUser(pool, auth, text) {
  const users = await pool.query(`SELECT id,usuario,nombre,rol FROM usuarios ORDER BY nombre`);
  const normalized = normalizeText(text);
  const mentioned = users.rows.find((user) => {
    const names = [user.nombre, user.usuario, String(user.nombre || "").split(/\s+/)[0]].map(normalizeText).filter((value) => value.length > 2);
    return names.some((name) => new RegExp(`(^| )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(normalized));
  });
  if (!mentioned) return { target: { id: auth.id, usuario: auth.usuario, nombre: auth.nombre, rol: auth.rol }, denied: false };
  const own = Number(mentioned.id) === Number(auth.id);
  if (!own && auth.rol !== "admin") return { target: { id: auth.id, usuario: auth.usuario, nombre: auth.nombre, rol: auth.rol }, denied: true };
  return { target: mentioned, denied: false };
}

async function employeeTasks(pool, user) {
  const access = buildTaskAccessClause({ ...user, rol: "personal" }, "t", "$1");
  const result = await pool.query(
    `SELECT t.id,t.titulo,t.estado,t.asignado_a,t.prioridad,t.tipo_tarea,t.subtipo,t.propiedades_extra,
      t.created_at,t.updated_at,c.nombre cliente_nombre,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento
     FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
     WHERE t.propiedades_extra->>'workspace'='render_os'
       AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'${access.sql}
     ORDER BY t.fecha_vencimiento NULLS LAST,t.id`, [access.value],
  );
  return result.rows;
}

function naturalReply(text, ranked, auth, snapshot = null, denied = false) {
  const normalized = String(text || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const actionable = ranked.recommendations.filter((task) => !task.blocked && !task.waiting_review);
  const overdue = actionable.filter((task) => task.due_days < 0);
  const today = actionable.filter((task) => task.due_days === 0);
  const waiting = ranked.recommendations.filter((task) => task.waiting_review);
  if (denied) return { text: "Puedo ayudarte con tus tareas, pero no mostrarte el detalle personal de otro integrante.", tasks: [] };
  const asksEmployeeStatus = snapshot && (/registr|video|grabo|como viene|como va|reporte|rendimiento|que hizo|que le falta|cuanto hizo/.test(normalized)
    || Number(snapshot.user.id) !== Number(auth.id));
  if (asksEmployeeStatus) return buildEmployeeStatusReply(snapshot, text);
  if (/hola|buen dia|buenas/.test(normalized)) return { text: `Hola, ${String(auth.nombre || auth.usuario).split(" ")[0]}. ¿Querés que ordenemos lo de hoy?`, tasks: [] };
  if (/reporte|como vengo|rendimiento/.test(normalized)) {
    return { text: `Tenés ${overdue.length} vencidas, ${today.length} para hoy y ${waiting.length} esperando revisión.${overdue.length ? " Primero recuperemos las vencidas." : " Venís al día con los vencimientos."}`, tasks: actionable.slice(0, 5) };
  }
  if (/atras|vencid/.test(normalized)) return { text: overdue.length ? `Tenés ${overdue.length} atrasada${overdue.length === 1 ? "" : "s"}. Hacelas en este orden:` : "No tenés tareas vencidas.", tasks: overdue };
  if (/esperar|despues|margen/.test(normalized)) {
    const later = actionable.filter((task) => task.due_days === null || task.due_days > 1).slice(-5).reverse();
    return { text: later.length ? "Estas pueden esperar un poco más:" : "No dejaría ninguna para después por ahora.", tasks: later };
  }
  if (/que hago|primero|priori|orden|ahora|hoy/.test(normalized)) {
    return { text: actionable.length ? `Empezá por ${actionable[0].titulo}. Después seguí este orden:` : waiting.length ? "No tenés tareas accionables. Lo que terminaste está esperando revisión." : "No encontré tareas pendientes para vos.", tasks: actionable.slice(0, 6) };
  }
  const production = normalized.match(/(?:grabe|grabo|hice|registre)\s+(\d+)\s+videos?/);
  if (production) return { text: `Entendí que grabaste ${production[1]} videos. Decime el nombre del cliente o de la visita para registrarlo y pedirte confirmación.`, tasks: actionable.filter(isProductionVisitTask).slice(0, 6), intent: { type: "production", amount: Number(production[1]) } };
  return { text: "Te puedo ordenar el trabajo, mostrar lo atrasado, revisar cómo venís o preparar el registro de un avance.", tasks: [] };
}

export function createWilsonChatRouter({ express, pool }) {
  const router = express.Router();

  router.get("/conversacion", async (req, res, next) => {
    try {
      const current = await conversation(pool, req.auth.id);
      const messages = await pool.query(`SELECT id,remitente,contenido,tipo,metadata,created_at FROM wilson_mensajes WHERE conversacion_id=$1 ORDER BY created_at,id`, [current.id]);
      const priorities = await personalTasks(pool, req.auth);
      return res.json({ conversation: current, messages: messages.rows, priorities });
    } catch (error) { return next(error); }
  });

  router.post("/mensajes", async (req, res, next) => {
    try {
      const content = String(req.body.contenido || "").trim().slice(0, 2000);
      if (!content) return res.status(400).json({ error: "Escribí un mensaje." });
      const current = await conversation(pool, req.auth.id);
      const userMessage = await append(pool, current.id, "usuario", content);
      const { target, denied } = await resolveTargetUser(pool, req.auth, content);
      const priorities = await personalTasks(pool, denied ? req.auth : target);
      const snapshot = denied ? null : buildEmployeeSnapshot(await employeeTasks(pool, target), target);
      const reply = naturalReply(content, priorities, req.auth, snapshot, denied);
      const assistantMessage = await append(pool, current.id, "wilson", reply.text, "respuesta", { task_ids: reply.tasks.map((task) => task.id), intent: reply.intent || null });
      return res.status(201).json({ userMessage, assistantMessage, tasks: reply.tasks, priorities });
    } catch (error) { return next(error); }
  });

  router.post("/produccion/preparar", async (req, res, next) => {
    try {
      if (!canRecordProduction(req.auth)) return res.status(403).json({ error: "Solo Germán o un Líder pueden registrar videos." });
      const amount = Number(req.body.cantidad); const date = String(req.body.fecha || localParts().year + "-" + localParts().month + "-" + localParts().day);
      if (!Number.isInteger(amount) || amount <= 0 || !isValidProductionDate(date)) return res.status(400).json({ error: "Revisá la cantidad y la fecha." });
      const access = buildTaskAccessClause(req.auth, "t", "$2"); const values = [req.body.tarea_id]; if (access.value) values.push(access.value);
      const found = await pool.query(`SELECT t.* FROM tareas t WHERE t.id=$1 AND t.propiedades_extra->>'workspace'='render_os'${access.sql}`, values);
      const task = found.rows[0];
      if (!task || !isProductionVisitTask(task)) return res.status(404).json({ error: "No encontré esa visita entre tus tareas." });
      const current = await conversation(pool, req.auth.id); const token = crypto.randomUUID();
      await pool.query(`INSERT INTO wilson_acciones_pendientes(token,conversacion_id,usuario_id,accion,tarea_id,payload,expires_at) VALUES($1,$2,$3,'registrar_produccion',$4,$5::jsonb,NOW()+INTERVAL '30 minutes')`, [token, current.id, req.auth.id, task.id, JSON.stringify({ cantidad: amount, fecha: date })]);
      const message = await append(pool, current.id, "wilson", `Voy a registrar ${amount} video${amount === 1 ? "" : "s"} en “${task.titulo}” con fecha ${date}. ¿Confirmás?`, "confirmacion", { token, task_id: task.id });
      return res.status(201).json({ message, confirmation: { token, task_id: task.id } });
    } catch (error) { return next(error); }
  });

  router.post("/confirmaciones/:token", async (req, res, next) => {
    const client = await pool.connect();
    try {
      if (!canRecordProduction(req.auth)) { await client.query("ROLLBACK"); return res.status(403).json({ error: "No tenés permiso para confirmar este registro." }); }
      await client.query("BEGIN");
      const pending = await client.query(`SELECT * FROM wilson_acciones_pendientes WHERE token=$1 AND usuario_id=$2 AND confirmed_at IS NULL AND expires_at>NOW() FOR UPDATE`, [req.params.token, req.auth.id]);
      const action = pending.rows[0];
      if (!action) { await client.query("ROLLBACK"); return res.status(409).json({ error: "La confirmación venció o ya fue utilizada." }); }
      const taskResult = await client.query(`SELECT * FROM tareas WHERE id=$1 FOR UPDATE`, [action.tarea_id]); const task = taskResult.rows[0];
      if (!task || !isProductionVisitTask(task)) { await client.query("ROLLBACK"); return res.status(404).json({ error: "La visita ya no está disponible." }); }
      const progress = getProductionProgress(task); const amount = Number(action.payload.cantidad); const date = action.payload.fecha;
      if (!progress.planned) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Primero un Líder debe indicar cuántos videos están previstos." }); }
      const record = { id: crypto.randomUUID(), cantidad: amount, fecha: date, usuario: getTaskActor(req.auth), created_at: new Date().toISOString(), periodo_objetivo: date.slice(0, 7) };
      const regular = Math.min(amount, progress.remaining); if (amount > regular) Object.assign(record, { cantidad_mes_actual: regular, cantidad_adelanto: amount - regular, periodo_adelanto: nextProductionPeriod(date) });
      const records = Array.isArray(task.propiedades_extra?.produccion_registros) ? task.propiedades_extra.produccion_registros : [];
      await client.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||$2::jsonb,updated_at=NOW() WHERE id=$1`, [task.id, JSON.stringify({ produccion_registros: [...records, record], wilson_ultimo_registro: record, workspace: "render_os" })]);
      await client.query(`UPDATE wilson_acciones_pendientes SET confirmed_at=NOW() WHERE token=$1`, [action.token]);
      await client.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,tarea_id,detalles) VALUES('wilson','web',$1,$2,'registrar_produccion',$3,$4::jsonb)`, [String(req.auth.id), getTaskActor(req.auth), task.id, JSON.stringify(record)]);
      const message = await client.query(`INSERT INTO wilson_mensajes(conversacion_id,remitente,contenido,tipo,metadata) VALUES($1,'wilson',$2,'accion_confirmada',$3::jsonb) RETURNING *`, [action.conversacion_id, `Listo: registré ${amount} videos en “${task.titulo}”. Cuando termines la visita, pasá la tarea a Revisar.`, JSON.stringify({ task_id: task.id, record_id: record.id })]);
      await client.query("COMMIT"); return res.json({ message: message.rows[0], task_id: task.id });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); return next(error); } finally { client.release(); }
  });

  router.get("/conversaciones", async (req, res, next) => {
    if (req.auth.rol !== "admin") return res.status(403).json({ error: "Solo un Líder puede consultar las conversaciones." });
    try {
      const result = await pool.query(`SELECT u.id,u.nombre,u.usuario,u.rol,c.id conversacion_id,c.periodo,c.updated_at,(SELECT contenido FROM wilson_mensajes m WHERE m.conversacion_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) ultimo_mensaje FROM usuarios u LEFT JOIN wilson_conversaciones c ON c.usuario_id=u.id AND c.periodo=$1 ORDER BY u.nombre`, [wilsonPeriod()]);
      return res.json(result.rows);
    } catch (error) { return next(error); }
  });

  router.get("/conversaciones/:userId", async (req, res, next) => {
    if (req.auth.rol !== "admin") return res.status(403).json({ error: "Solo un Líder puede consultar las conversaciones." });
    try {
      const current = await conversation(pool, req.params.userId);
      const messages = await pool.query(`SELECT id,remitente,contenido,tipo,metadata,created_at FROM wilson_mensajes WHERE conversacion_id=$1 ORDER BY created_at,id`, [current.id]);
      return res.json({ conversation: current, messages: messages.rows });
    } catch (error) { return next(error); }
  });
  return router;
}

export function scheduleWilsonMessages(pool) {
  let running = false;
  const check = async () => {
    if (running) return;
    await pool.query(`DELETE FROM wilson_conversaciones WHERE periodo<>$1`, [wilsonPeriod()]);
    const trigger = shouldSendWilsonDigest(); if (!trigger) return; running = true;
    try {
      const users = await pool.query(`SELECT id,usuario,nombre,rol FROM usuarios ORDER BY nombre`);
      for (const user of users.rows) {
        const claimed = await pool.query(`INSERT INTO wilson_envios_programados(usuario_id,fecha,tipo) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING usuario_id`, [user.id, trigger.date, trigger.type]);
        if (!claimed.rowCount) continue;
        const ranked = await personalTasks(pool, user); const tasks = ranked.recommendations.filter((task) => !task.blocked && !task.waiting_review).slice(0, 5);
        if (!tasks.length) continue;
        const current = await conversation(pool, user.id);
        const prefix = trigger.type === "semanal_mensual" ? "Cierre semanal y mensual" : trigger.type === "mensual" ? "Cierre del mes" : "Cierre de semana";
        await append(pool, current.id, "wilson", `${prefix}: tenés que priorizar esto:\n${taskSummary(tasks)}\nSi algún registro está mal, decime y lo revisamos.`, "recordatorio", { task_ids: tasks.map((task) => task.id) });
      }
    } finally { running = false; }
  };
  void check(); const timer = setInterval(check, 60 * 60 * 1000); timer.unref?.(); return timer;
}
