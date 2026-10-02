import crypto from "node:crypto";

const OPERATIONS = new Set(["crear", "editar", "completar", "reabrir", "eliminar", "recordar", "reprogramar_recordatorio", "cancelar_recordatorio"]);
const REPEATS = new Set(["una_vez", "diario", "dias_habiles", "semanal", "cada_n_dias"]);

function clean(value, max = 500) {
  const result = String(value || "").replace(/\s+/g, " ").trim();
  if ([...result].length > max) throw Object.assign(new Error("El texto es demasiado largo."), { status: 400 });
  return result;
}

function normalized(value) {
  return clean(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function actorHash(actorId) {
  return crypto.createHash("sha256").update(String(actorId || "").replace(/^\+/, "")).digest("hex");
}

function validReminderDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now() - 60_000 ? date : null;
}

function checklistItems(rows) {
  return rows.flatMap((row) => (Array.isArray(row.contenido?.items) ? row.contenido.items : []).map((item) => ({
    ...item, bloque_id: Number(row.id), lista_id: Number(row.lista_id), lista_titulo: row.lista_titulo,
    bloque_titulo: row.contenido?.titulo || "Pendientes", bloque_version: Number(row.version),
  })));
}

export function resolveListItem(reference, rows) {
  const query = normalized(reference);
  if (!query) return { status: "missing", matches: [] };
  const words = query.split(" ").filter((word) => word.length > 1);
  const matches = checklistItems(rows).filter((item) => {
    const text = normalized(`${item.texto} ${item.lista_titulo} ${item.bloque_titulo}`);
    return normalized(item.id) === query || text === query || text.includes(query) || words.every((word) => text.includes(word));
  });
  return { status: matches.length === 1 ? "resolved" : matches.length > 1 ? "ambiguous" : "not_found", matches };
}

export function nextReminderDate(current, repeat, intervalDays = null) {
  const date = new Date(current);
  if (repeat === "una_vez") return null;
  let days = repeat === "semanal" ? 7 : repeat === "cada_n_dias" ? Number(intervalDays) : 1;
  if (repeat === "dias_habiles") {
    const day = date.getUTCDay();
    days = day === 5 ? 3 : day === 6 ? 2 : 1;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function loadChecklistRows(db, userId, { lock = false } = {}) {
  const result = await db.query(`SELECT b.id,b.lista_id,b.contenido,b.version,l.titulo lista_titulo
    FROM lista_bloques b JOIN listas_personales l ON l.id=b.lista_id
    WHERE l.usuario_id=$1 AND b.tipo='checklist' ORDER BY l.posicion,b.posicion,b.id${lock ? " FOR UPDATE OF b" : ""}`, [userId]);
  return result.rows;
}

async function resolveTargetUser(db, req, requestedUserId) {
  const ownId = Number(req.wilson.userId);
  const targetId = requestedUserId ? Number(requestedUserId) : ownId;
  if (!Number.isInteger(targetId) || targetId <= 0) throw Object.assign(new Error("No pude vincular este WhatsApp con un usuario de Render OS."), { status: 403 });
  if (targetId !== ownId && !req.wilson.isLeader) throw Object.assign(new Error("La lista es privada. Solo podés modificar la tuya."), { status: 403 });
  const result = await db.query("SELECT id,usuario,nombre,rol FROM usuarios WHERE id=$1", [targetId]);
  if (!result.rows[0]) throw Object.assign(new Error("El usuario indicado no existe."), { status: 404 });
  return result.rows[0];
}

function numbered(matches) {
  return matches.slice(0, 10).map((item, index) => `${index + 1}. ${item.texto} — ${item.lista_titulo}`).join("\n");
}

async function chooseDestination(rows, payload) {
  const listId = Number(payload.lista_id || 0);
  const blockId = Number(payload.bloque_id || 0);
  let row = blockId ? rows.find((item) => Number(item.id) === blockId) : null;
  if (!row && listId) row = rows.find((item) => Number(item.lista_id) === listId);
  if (!row && payload.lista) {
    const name = normalized(payload.lista);
    const choices = rows.filter((item) => normalized(item.lista_titulo).includes(name));
    if (choices.length > 1) throw Object.assign(new Error(`Encontré varias listas. Elegí una:\n${choices.map((item, i) => `${i + 1}. ${item.lista_titulo}`).join("\n")}`), { status: 409, code: "ambiguous_list" });
    row = choices[0] || null;
  }
  return row || rows[0] || null;
}

function reminderFields(payload) {
  const requested = payload.recordar_en || payload.proximo_envio_at;
  if (!requested) throw Object.assign(new Error("¿A qué hora querés que te lo recuerde?"), { status: 422, code: "missing_reminder_time" });
  const date = validReminderDate(requested);
  if (!date) throw Object.assign(new Error("La fecha u hora del recordatorio no es válida."), { status: 422 });
  const repeat = String(payload.repeticion || "una_vez");
  if (!REPEATS.has(repeat)) throw Object.assign(new Error("La repetición del recordatorio no es válida."), { status: 422 });
  const interval = repeat === "cada_n_dias" ? Number(payload.intervalo_dias) : null;
  if (repeat === "cada_n_dias" && (!Number.isInteger(interval) || interval < 1 || interval > 365)) {
    throw Object.assign(new Error("Indicá cada cuántos días querés repetirlo."), { status: 422 });
  }
  return { proximo_envio_at: date.toISOString(), repeticion: repeat, intervalo_dias: interval };
}

export function createMiaPersonalListsRouter({ express, pool }) {
  const router = express.Router();
  const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((error) => {
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
    return next(error);
  });

  router.use((req, res, next) => {
    if (!req.wilson.privateChat) return res.status(409).json({
      error: "Te escribo por privado para cuidar tu lista personal. Continuemos ahí.",
      code: "continue_in_private", requires_private_chat: true,
    });
    if (!req.wilson.userId) return res.status(403).json({ error: "Este WhatsApp todavía no está vinculado a Render OS.", code: "unlinked_whatsapp" });
    return next();
  });

  router.get("/", handler(async (req, res) => {
    const target = await resolveTargetUser(pool, req, req.query.usuario_id);
    const rows = await loadChecklistRows(pool, target.id);
    const reminders = await pool.query(`SELECT id,lista_id,bloque_id,item_uid,texto,proximo_envio_at,repeticion,intervalo_dias,activo
      FROM lista_recordatorios_personales WHERE usuario_id=$1 AND activo IS TRUE ORDER BY proximo_envio_at`, [target.id]);
    return res.json({ usuario: target, items: checklistItems(rows), recordatorios: reminders.rows, privado: true });
  }));

  router.post("/propuestas", handler(async (req, res) => {
    const operation = String(req.body?.operacion || "").trim().toLowerCase();
    if (!OPERATIONS.has(operation)) throw Object.assign(new Error("La acción de Lista no es válida."), { status: 422 });
    const target = await resolveTargetUser(pool, req, req.body?.usuario_id);
    const rows = await loadChecklistRows(pool, target.id);
    const payload = { ...(req.body?.payload || {}) };
    let summary;
    if (operation === "crear") {
      payload.texto = clean(payload.texto);
      if (!payload.texto) throw Object.assign(new Error("¿Qué querés que agregue a tu lista?"), { status: 422 });
      const destination = await chooseDestination(rows, payload);
      payload.lista_id = destination?.lista_id || null;
      payload.bloque_id = destination?.id || null;
      payload.bloque_version = destination?.version || null;
      if (payload.recordar === true || payload.recordar_en) Object.assign(payload, reminderFields(payload));
      summary = `Voy a agregar “${payload.texto}” a ${destination?.lista_titulo || "una nueva lista privada"}${payload.proximo_envio_at ? ` y recordártelo el ${new Date(payload.proximo_envio_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Cordoba" })}` : ""}.`;
    } else {
      const resolution = resolveListItem(payload.item_id || payload.referencia, rows);
      if (resolution.status === "ambiguous") return res.status(409).json({ error: `Encontré varias opciones. Decime cuál:\n${numbered(resolution.matches)}`, code: "ambiguous_item", choices: resolution.matches });
      if (resolution.status !== "resolved") return res.status(404).json({ error: "No encontré ese pendiente en tu lista privada.", code: "item_not_found" });
      const item = resolution.matches[0];
      Object.assign(payload, { item_id: item.id, lista_id: item.lista_id, bloque_id: item.bloque_id, bloque_version: item.bloque_version, texto_actual: item.texto });
      if (operation === "editar") {
        payload.texto = clean(payload.texto);
        if (!payload.texto) throw Object.assign(new Error("¿Cómo querés que quede escrito?"), { status: 422 });
      }
      if (["recordar", "reprogramar_recordatorio"].includes(operation)) Object.assign(payload, reminderFields(payload));
      const labels = { editar: `cambiar “${item.texto}” por “${payload.texto}”`, completar: `tachar “${item.texto}”`, reabrir: `volver a abrir “${item.texto}”`, eliminar: `eliminar “${item.texto}”`, recordar: `recordarte “${item.texto}”`, reprogramar_recordatorio: `cambiar el recordatorio de “${item.texto}”`, cancelar_recordatorio: `cancelar el recordatorio de “${item.texto}”` };
      summary = `Voy a ${labels[operation]} en tu lista privada.`;
    }
    const token = crypto.randomUUID();
    await pool.query(`UPDATE mia_lista_propuestas SET cancelled_at=NOW()
      WHERE actor_id_hash=$1 AND objetivo_usuario_id=$2 AND used_at IS NULL AND cancelled_at IS NULL`, [actorHash(req.wilson.actorId), target.id]);
    await pool.query(`INSERT INTO mia_lista_propuestas(token,actor_id_hash,solicitante_usuario_id,objetivo_usuario_id,operacion,payload,resumen)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [token, actorHash(req.wilson.actorId), req.wilson.userId, target.id, operation, JSON.stringify(payload), summary]);
    return res.status(201).json({ confirmacion_token: token, resumen: summary, text: `${summary}\n\n¿Confirmás?`, expires_at: null });
  }));

  router.post("/confirmar", handler(async (req, res) => {
    const token = String(req.body?.confirmacion_token || "").trim();
    if (!token) throw Object.assign(new Error("Falta la confirmación de Lista."), { status: 400 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`SELECT * FROM mia_lista_propuestas
        WHERE token=$1 AND actor_id_hash=$2 AND used_at IS NULL AND cancelled_at IS NULL FOR UPDATE`, [token, actorHash(req.wilson.actorId)]);
      const proposal = found.rows[0];
      if (!proposal) throw Object.assign(new Error("La propuesta no existe, ya fue usada o fue reemplazada por una más nueva."), { status: 409 });
      const payload = proposal.payload;
      let rows = await loadChecklistRows(client, proposal.objetivo_usuario_id, { lock: true });
      let row = rows.find((item) => Number(item.id) === Number(payload.bloque_id));
      if (proposal.operacion === "crear" && !row) {
        let list = await client.query(`SELECT id FROM listas_personales WHERE usuario_id=$1 ORDER BY posicion,id LIMIT 1 FOR UPDATE`, [proposal.objetivo_usuario_id]);
        if (!list.rows[0]) list = await client.query(`INSERT INTO listas_personales(usuario_id,titulo,emoji,posicion) VALUES($1,'Mi lista','📝',0) RETURNING id`, [proposal.objetivo_usuario_id]);
        const inserted = await client.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion) VALUES($1,'checklist',$2::jsonb,0)
          RETURNING id,lista_id,contenido,version`, [list.rows[0].id, JSON.stringify({ titulo: "Pendientes", items: [] })]);
        row = { ...inserted.rows[0], lista_titulo: "Mi lista" };
      }
      if (!row || (payload.bloque_version !== null && Number(row.version) !== Number(payload.bloque_version))) {
        throw Object.assign(new Error("Tu lista cambió desde el resumen. No modifiqué nada; pedime nuevamente el cambio."), { status: 409 });
      }
      const content = { ...row.contenido, items: Array.isArray(row.contenido?.items) ? [...row.contenido.items] : [] };
      let item;
      if (proposal.operacion === "crear") {
        item = { id: crypto.randomUUID(), texto: payload.texto, completado: false };
        content.items.push(item);
      } else {
        const index = content.items.findIndex((entry) => String(entry.id) === String(payload.item_id));
        if (index < 0) throw Object.assign(new Error("Ese pendiente cambió o ya no existe. No modifiqué nada."), { status: 409 });
        item = { ...content.items[index] };
        if (proposal.operacion === "editar") item.texto = payload.texto;
        if (proposal.operacion === "completar") item.completado = true;
        if (proposal.operacion === "reabrir") item.completado = false;
        if (proposal.operacion === "eliminar") content.items.splice(index, 1); else content.items[index] = item;
      }
      if (["crear", "editar", "completar", "reabrir", "eliminar"].includes(proposal.operacion)) {
        await client.query(`UPDATE lista_bloques SET contenido=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=$2`, [JSON.stringify(content), row.id]);
      }
      const itemId = item?.id || payload.item_id;
      if (proposal.operacion === "editar") {
        await client.query(`UPDATE lista_recordatorios_personales SET texto=$1,updated_at=NOW()
          WHERE usuario_id=$2 AND bloque_id=$3 AND item_uid=$4 AND activo IS TRUE`, [item.texto, proposal.objetivo_usuario_id, row.id, itemId]);
      }
      if (["recordar", "reprogramar_recordatorio"].includes(proposal.operacion) || (proposal.operacion === "crear" && payload.proximo_envio_at)) {
        await client.query(`INSERT INTO lista_recordatorios_personales(usuario_id,lista_id,bloque_id,item_uid,texto,proximo_envio_at,repeticion,intervalo_dias)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(usuario_id,bloque_id,item_uid) DO UPDATE SET texto=EXCLUDED.texto,proximo_envio_at=EXCLUDED.proximo_envio_at,
            repeticion=EXCLUDED.repeticion,intervalo_dias=EXCLUDED.intervalo_dias,activo=TRUE,updated_at=NOW()`,
        [proposal.objetivo_usuario_id, row.lista_id, row.id, itemId, item?.texto || payload.texto_actual, payload.proximo_envio_at, payload.repeticion, payload.intervalo_dias]);
      }
      if (["cancelar_recordatorio", "eliminar"].includes(proposal.operacion)) {
        await client.query(`UPDATE lista_recordatorios_personales SET activo=FALSE,updated_at=NOW()
          WHERE usuario_id=$1 AND bloque_id=$2 AND item_uid=$3`, [proposal.objetivo_usuario_id, row.id, itemId]);
      }
      await client.query(`UPDATE mia_lista_propuestas SET used_at=NOW() WHERE token=$1`, [token]);
      await client.query(`INSERT INTO mia_lista_auditoria(usuario_id,actor_usuario_id,operacion,lista_id,bloque_id,item_uid,detalles)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [proposal.objetivo_usuario_id, proposal.solicitante_usuario_id, proposal.operacion, row.lista_id, row.id, itemId, JSON.stringify({ token })]);
      await client.query("COMMIT");
      return res.json({ updated: true, operacion: proposal.operacion, text: `Listo. ${proposal.resumen.replace(/^Voy a /, "Ya pude ")}` });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }));

  return router;
}

export async function enqueueDuePersonalListReminders(pool, { limit = 50 } = {}) {
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    const due = await client.query(`SELECT r.*,u.usuario,u.nombre FROM lista_recordatorios_personales r
      JOIN usuarios u ON u.id=r.usuario_id WHERE r.activo IS TRUE AND r.proximo_envio_at<=NOW()
      ORDER BY r.proximo_envio_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT $1`, [limit]);
    for (const reminder of due.rows) {
      const fingerprint = crypto.createHash("sha256").update(`lista:${reminder.id}:${new Date(reminder.proximo_envio_at).toISOString()}`).digest("hex");
      const inserted = await client.query(`INSERT INTO mia_private_task_notifications
        (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
        VALUES($1,$2,$3,0,'recordatorio_lista',$4,'https://sistema.rendercorrientes.com/lista',$5::jsonb)
        ON CONFLICT(fingerprint) DO NOTHING RETURNING id`, [fingerprint, reminder.nombre, reminder.usuario.toLowerCase(), `⏰ Recordatorio personal\n${reminder.texto}\n\nCuando lo termines podés decirme “listo” y te pregunto cuál querés tachar.`, JSON.stringify({ recordatorio_id: reminder.id })]);
      count += inserted.rowCount;
      const next = nextReminderDate(reminder.proximo_envio_at, reminder.repeticion, reminder.intervalo_dias);
      await client.query(`UPDATE lista_recordatorios_personales SET ultimo_envio_at=proximo_envio_at,
        proximo_envio_at=COALESCE($1,proximo_envio_at),activo=$2,updated_at=NOW() WHERE id=$3`, [next?.toISOString() || null, Boolean(next), reminder.id]);
    }
    await client.query("COMMIT");
    return count;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
