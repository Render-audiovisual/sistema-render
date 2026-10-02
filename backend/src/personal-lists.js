const MAX_LISTS_PER_USER = 100;
const MAX_SECTIONS_PER_LIST = 100;
const MAX_ITEMS_PER_SECTION = 500;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizePersonalListText(value, { field = "texto", max = 500, fallback = "" } = {}) {
  const clean = String(value ?? fallback).replace(/\s+/g, " ").trim();
  if (!clean) throw httpError(400, `${field} no puede quedar vacío.`);
  if ([...clean].length > max) throw httpError(400, `${field} es demasiado largo.`);
  return clean;
}

export function normalizePersonalListEmoji(value) {
  const clean = String(value || "📝").trim();
  if (!clean || [...clean].length > 8) throw httpError(400, "Elegí un emoji válido.");
  return clean;
}

function normalizeIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) {
    throw httpError(400, "El orden enviado no es válido.");
  }
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw httpError(400, "El orden contiene elementos inválidos o repetidos.");
  }
  return ids;
}

function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch((error) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  });
}

function nestPersonalLists(lists, sections, items) {
  const itemGroups = new Map();
  items.forEach((item) => {
    const key = Number(item.seccion_id);
    itemGroups.set(key, [...(itemGroups.get(key) || []), item]);
  });
  const sectionGroups = new Map();
  sections.forEach((section) => {
    const key = Number(section.lista_id);
    sectionGroups.set(key, [...(sectionGroups.get(key) || []), {
      ...section,
      items: itemGroups.get(Number(section.id)) || [],
    }]);
  });
  return lists.map((list) => ({ ...list, secciones: sectionGroups.get(Number(list.id)) || [] }));
}

async function loadPersonalLists(pool, userId) {
  const [lists, sections, items] = await Promise.all([
    pool.query(`SELECT id,titulo,emoji,posicion,version,created_at,updated_at
      FROM listas_personales WHERE usuario_id=$1 ORDER BY posicion,id`, [userId]),
    pool.query(`SELECT s.id,s.lista_id,s.titulo,s.posicion,s.version,s.created_at,s.updated_at
      FROM lista_secciones s JOIN listas_personales l ON l.id=s.lista_id
      WHERE l.usuario_id=$1 ORDER BY s.posicion,s.id`, [userId]),
    pool.query(`SELECT i.id,i.seccion_id,i.texto,i.completado,i.posicion,i.version,i.created_at,i.updated_at
      FROM lista_items i JOIN lista_secciones s ON s.id=i.seccion_id
      JOIN listas_personales l ON l.id=s.lista_id
      WHERE l.usuario_id=$1 ORDER BY i.posicion,i.id`, [userId]),
  ]);
  return nestPersonalLists(lists.rows, sections.rows, items.rows);
}

async function requireOwnedList(db, listId, userId) {
  const result = await db.query("SELECT id FROM listas_personales WHERE id=$1 AND usuario_id=$2", [listId, userId]);
  if (!result.rowCount) throw httpError(404, "Lista no encontrada.");
}

async function requireOwnedSection(db, sectionId, userId) {
  const result = await db.query(`SELECT s.id,s.lista_id FROM lista_secciones s
    JOIN listas_personales l ON l.id=s.lista_id WHERE s.id=$1 AND l.usuario_id=$2`, [sectionId, userId]);
  if (!result.rowCount) throw httpError(404, "Sección no encontrada.");
  return result.rows[0];
}

export function createPersonalListsRouter({ express, pool }) {
  const router = express.Router();

  router.get("/", handler(async (req, res) => {
    res.json(await loadPersonalLists(pool, Number(req.auth.id)));
  }));

  router.post("/", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const title = normalizePersonalListText(req.body?.titulo, { field: "El título", max: 120, fallback: "Sin título" });
    const emoji = normalizePersonalListEmoji(req.body?.emoji);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const count = await client.query("SELECT COUNT(*)::int total FROM listas_personales WHERE usuario_id=$1", [userId]);
      if (count.rows[0].total >= MAX_LISTS_PER_USER) throw httpError(409, "Alcanzaste el límite de listas personales.");
      const list = await client.query(`INSERT INTO listas_personales(usuario_id,titulo,emoji,posicion)
        VALUES($1,$2,$3,(SELECT COALESCE(MAX(posicion),-1)+1 FROM listas_personales WHERE usuario_id=$1))
        RETURNING id,titulo,emoji,posicion,version,created_at,updated_at`, [userId, title, emoji]);
      const section = await client.query(`INSERT INTO lista_secciones(lista_id,titulo,posicion)
        VALUES($1,'Pendientes',0) RETURNING id,lista_id,titulo,posicion,version,created_at,updated_at`, [list.rows[0].id]);
      await client.query("COMMIT");
      res.status(201).json({ ...list.rows[0], secciones: [{ ...section.rows[0], items: [] }] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.patch("/:id", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const title = req.body?.titulo === undefined ? null : normalizePersonalListText(req.body.titulo, { field: "El título", max: 120 });
    const emoji = req.body?.emoji === undefined ? null : normalizePersonalListEmoji(req.body.emoji);
    if (title === null && emoji === null) throw httpError(400, "No hay cambios para guardar.");
    const result = await pool.query(`UPDATE listas_personales SET titulo=COALESCE($1,titulo),emoji=COALESCE($2,emoji),
      version=version+1,updated_at=NOW() WHERE id=$3 AND usuario_id=$4
      RETURNING id,titulo,emoji,posicion,version,created_at,updated_at`, [title, emoji, req.params.id, userId]);
    if (!result.rowCount) throw httpError(404, "Lista no encontrada.");
    res.json(result.rows[0]);
  }));

  router.delete("/:id", handler(async (req, res) => {
    const result = await pool.query("DELETE FROM listas_personales WHERE id=$1 AND usuario_id=$2 RETURNING id", [req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Lista no encontrada.");
    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.post("/:listId/secciones", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const title = normalizePersonalListText(req.body?.titulo, { field: "El título", max: 120, fallback: "Nueva sección" });
    await requireOwnedList(pool, req.params.listId, userId);
    const count = await pool.query("SELECT COUNT(*)::int total FROM lista_secciones WHERE lista_id=$1", [req.params.listId]);
    if (count.rows[0].total >= MAX_SECTIONS_PER_LIST) throw httpError(409, "Alcanzaste el límite de secciones.");
    const result = await pool.query(`INSERT INTO lista_secciones(lista_id,titulo,posicion)
      VALUES($1,$2,(SELECT COALESCE(MAX(posicion),-1)+1 FROM lista_secciones WHERE lista_id=$1))
      RETURNING id,lista_id,titulo,posicion,version,created_at,updated_at`, [req.params.listId, title]);
    res.status(201).json({ ...result.rows[0], items: [] });
  }));

  router.patch("/secciones/:id", handler(async (req, res) => {
    const title = normalizePersonalListText(req.body?.titulo, { field: "El título", max: 120 });
    const result = await pool.query(`UPDATE lista_secciones s SET titulo=$1,version=s.version+1,updated_at=NOW()
      FROM listas_personales l WHERE s.id=$2 AND l.id=s.lista_id AND l.usuario_id=$3
      RETURNING s.id,s.lista_id,s.titulo,s.posicion,s.version,s.created_at,s.updated_at`, [title, req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Sección no encontrada.");
    res.json(result.rows[0]);
  }));

  router.delete("/secciones/:id", handler(async (req, res) => {
    const result = await pool.query(`DELETE FROM lista_secciones s USING listas_personales l
      WHERE s.id=$1 AND l.id=s.lista_id AND l.usuario_id=$2 RETURNING s.id`, [req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Sección no encontrada.");
    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.post("/secciones/:sectionId/items", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const text = normalizePersonalListText(req.body?.texto, { field: "El pendiente", max: 500 });
    await requireOwnedSection(pool, req.params.sectionId, userId);
    const count = await pool.query("SELECT COUNT(*)::int total FROM lista_items WHERE seccion_id=$1", [req.params.sectionId]);
    if (count.rows[0].total >= MAX_ITEMS_PER_SECTION) throw httpError(409, "Esta sección ya tiene demasiados pendientes.");
    const result = await pool.query(`INSERT INTO lista_items(seccion_id,texto,posicion)
      VALUES($1,$2,(SELECT COALESCE(MAX(posicion),-1)+1 FROM lista_items WHERE seccion_id=$1))
      RETURNING id,seccion_id,texto,completado,posicion,version,created_at,updated_at`, [req.params.sectionId, text]);
    res.status(201).json(result.rows[0]);
  }));

  router.patch("/items/:id", handler(async (req, res) => {
    const text = req.body?.texto === undefined ? null : normalizePersonalListText(req.body.texto, { field: "El pendiente", max: 500 });
    const completed = req.body?.completado === undefined ? null : req.body.completado;
    if (text === null && completed === null) throw httpError(400, "No hay cambios para guardar.");
    if (completed !== null && typeof completed !== "boolean") throw httpError(400, "El estado del pendiente no es válido.");
    const result = await pool.query(`UPDATE lista_items i SET texto=COALESCE($1,i.texto),completado=COALESCE($2,i.completado),
      version=i.version+1,updated_at=NOW() FROM lista_secciones s,listas_personales l
      WHERE i.id=$3 AND s.id=i.seccion_id AND l.id=s.lista_id AND l.usuario_id=$4
      RETURNING i.id,i.seccion_id,i.texto,i.completado,i.posicion,i.version,i.created_at,i.updated_at`,
    [text, completed, req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Pendiente no encontrado.");
    res.json(result.rows[0]);
  }));

  router.delete("/items/:id", handler(async (req, res) => {
    const result = await pool.query(`DELETE FROM lista_items i USING lista_secciones s,listas_personales l
      WHERE i.id=$1 AND s.id=i.seccion_id AND l.id=s.lista_id AND l.usuario_id=$2 RETURNING i.id`,
    [req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Pendiente no encontrado.");
    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.patch("/orden/reordenar", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const kind = String(req.body?.tipo || "");
    const ids = normalizeIds(req.body?.ids);
    const parentId = Number(req.body?.parent_id || 0);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let valid;
      if (kind === "listas") {
        valid = await client.query("SELECT id FROM listas_personales WHERE usuario_id=$1 AND id=ANY($2::bigint[])", [userId, ids]);
      } else if (kind === "secciones") {
        await requireOwnedList(client, parentId, userId);
        valid = await client.query("SELECT id FROM lista_secciones WHERE lista_id=$1 AND id=ANY($2::bigint[])", [parentId, ids]);
      } else if (kind === "items") {
        await requireOwnedSection(client, parentId, userId);
        valid = await client.query("SELECT id FROM lista_items WHERE seccion_id=$1 AND id=ANY($2::bigint[])", [parentId, ids]);
      } else {
        throw httpError(400, "El tipo de orden no es válido.");
      }
      if (valid.rowCount !== ids.length) throw httpError(404, "No se pudo ordenar contenido ajeno o inexistente.");
      const table = kind === "listas" ? "listas_personales" : kind === "secciones" ? "lista_secciones" : "lista_items";
      for (let position = 0; position < ids.length; position += 1) {
        await client.query(`UPDATE ${table} SET posicion=$1,version=version+1,updated_at=NOW() WHERE id=$2`, [position, ids[position]]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, ids });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  return router;
}
