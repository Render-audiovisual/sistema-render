import { normalizeBlockContent, normalizeBlocks, normalizeBlockType } from "./personal-list-blocks.js";
import { createPersonalListWithReceipt, findPersonalListCreation, personalListCreationRequestId } from './personal-list-create-receipts.js';

const MAX_SECTIONS_PER_LIST = 100;
const MAX_ITEMS_PER_SECTION = 500;
const MAX_BLOCKS_PER_LIST = 80;
const MAX_TEMPLATES_PER_USER = 30;

export function normalizePersonalListCreateInput(body) {
  if (body === undefined) personalListCreationRequestId(undefined);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['request_id', 'titulo', 'emoji', 'bloques'].includes(key))) {
    throw httpError(400, 'Los campos de la creación no son válidos.');
  }
  const requestId = personalListCreationRequestId(body.request_id);
  return { requestId, payload: {
    titulo: normalizePersonalListText(body.titulo, { field: 'El título', max: 120, fallback: 'Sin título' }),
    emoji: normalizePersonalListEmoji(body.emoji),
    bloques: body.bloques === undefined ? [{ tipo: 'checklist', contenido: { titulo: 'Pendientes', items: [] } }]
      : normalizeBlocks(body.bloques),
  } };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw httpError(400, "expected_version debe ser un entero positivo válido.");
  }
  return value;
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

export function personalRecordId(value) {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
  if(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n)return value;
  throw httpError(400,'El identificador personal no es válido.');
}

function normalizeIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) {
    throw httpError(400, "El orden enviado no es válido.");
  }
  const ids = value.map(personalRecordId);
  if (new Set(ids).size !== ids.length) {
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

export function nestPersonalLists(lists, sections, items, blocks) {
  const itemGroups = new Map();
  items.forEach((item) => {
    const key = String(item.seccion_id);
    itemGroups.set(key, [...(itemGroups.get(key) || []), item]);
  });
  const sectionGroups = new Map();
  sections.forEach((section) => {
    const key = String(section.lista_id);
    sectionGroups.set(key, [...(sectionGroups.get(key) || []), {
      ...section,
      items: itemGroups.get(String(section.id)) || [],
    }]);
  });
  const blockGroups = new Map();
  blocks.forEach((block) => {
    const key = String(block.lista_id);
    blockGroups.set(key, [...(blockGroups.get(key) || []), block]);
  });
  return lists.map((list) => ({
    ...list,
    secciones: sectionGroups.get(String(list.id)) || [],
    bloques: blockGroups.get(String(list.id)) || [],
  }));
}

async function loadPersonalLists(pool, userId) {
  const [lists, sections, items, blocks] = await Promise.all([
    pool.query(`SELECT id,titulo,emoji,posicion,version,created_at,updated_at
      FROM listas_personales WHERE usuario_id=$1 ORDER BY posicion,id`, [userId]),
    pool.query(`SELECT s.id,s.lista_id,s.titulo,s.posicion,s.version,s.created_at,s.updated_at
      FROM lista_secciones s JOIN listas_personales l ON l.id=s.lista_id
      WHERE l.usuario_id=$1 ORDER BY s.posicion,s.id`, [userId]),
    pool.query(`SELECT i.id,i.seccion_id,i.texto,i.completado,i.posicion,i.version,i.created_at,i.updated_at
      FROM lista_items i JOIN lista_secciones s ON s.id=i.seccion_id
      JOIN listas_personales l ON l.id=s.lista_id
      WHERE l.usuario_id=$1 ORDER BY i.posicion,i.id`, [userId]),
    pool.query(`SELECT b.id,b.lista_id,b.tipo,b.contenido,b.posicion,b.version,b.created_at,b.updated_at
      FROM lista_bloques b JOIN listas_personales l ON l.id=b.lista_id
      WHERE l.usuario_id=$1 ORDER BY b.posicion,b.id`, [userId]),
  ]);
  return nestPersonalLists(lists.rows, sections.rows, items.rows, blocks.rows);
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

  router.get('/creaciones/:requestId', handler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await findPersonalListCreation(pool, req.auth, req.params.requestId));
  }));

  router.get("/plantillas", handler(async (req, res) => {
    const result = await pool.query(`SELECT id,titulo,emoji,bloques,created_at,updated_at
      FROM lista_plantillas_personales WHERE usuario_id=$1 ORDER BY updated_at DESC,id DESC`, [Number(req.auth.id)]);
    res.json(result.rows);
  }));

  router.post("/plantillas", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const title = normalizePersonalListText(req.body?.titulo, { field: "El nombre de la plantilla", max: 120 });
    const emoji = normalizePersonalListEmoji(req.body?.emoji || "🧩");
    const blocks = normalizeBlocks(req.body?.bloques || []);
    const count = await pool.query("SELECT COUNT(*)::int total FROM lista_plantillas_personales WHERE usuario_id=$1", [userId]);
    if (count.rows[0].total >= MAX_TEMPLATES_PER_USER) throw httpError(409, "Alcanzaste el límite de plantillas personales.");
    const result = await pool.query(`INSERT INTO lista_plantillas_personales(usuario_id,titulo,emoji,bloques)
      VALUES($1,$2,$3,$4::jsonb) RETURNING id,titulo,emoji,bloques,created_at,updated_at`,
    [userId, title, emoji, JSON.stringify(blocks)]);
    res.status(201).json(result.rows[0]);
  }));

  router.delete("/plantillas/:id", handler(async (req, res) => {
    const result = await pool.query(`DELETE FROM lista_plantillas_personales
      WHERE id=$1 AND usuario_id=$2 RETURNING id`, [req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Plantilla no encontrada.");
    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.post("/", handler(async (req, res) => {
    const result = await createPersonalListWithReceipt(pool, req.auth, normalizePersonalListCreateInput(req.body));
    res.status(result.replayed ? 200 : 201).json(result.list);
  }));

  router.patch("/:id", handler(async (req, res) => {
    const version = expectedVersion(req.body?.expected_version);
    const userId = Number(req.auth.id);
    const title = req.body?.titulo === undefined ? null : normalizePersonalListText(req.body.titulo, { field: "El título", max: 120 });
    const emoji = req.body?.emoji === undefined ? null : normalizePersonalListEmoji(req.body.emoji);
    if (title === null && emoji === null) throw httpError(400, "No hay cambios para guardar.");
    const result = await pool.query(`UPDATE listas_personales SET titulo=COALESCE($1,titulo),emoji=COALESCE($2,emoji),
      version=version+1,updated_at=NOW() WHERE id=$3 AND usuario_id=$4 AND version=$5
      RETURNING id,titulo,emoji,posicion,version,created_at,updated_at`, [title, emoji, req.params.id, userId, version]);
    if (!result.rowCount) {
      await requireOwnedList(pool, req.params.id, userId);
      throw httpError(409, "La lista cambió. Volvé a cargarla antes de guardar.");
    }
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

  router.post("/:listId/bloques", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const type = normalizeBlockType(req.body?.tipo);
    const content = normalizeBlockContent(type, req.body?.contenido);
    await requireOwnedList(pool, req.params.listId, userId);
    const count = await pool.query("SELECT COUNT(*)::int total FROM lista_bloques WHERE lista_id=$1", [req.params.listId]);
    if (count.rows[0].total >= MAX_BLOCKS_PER_LIST) throw httpError(409, "Esta página ya tiene demasiados bloques.");
    const result = await pool.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion)
      VALUES($1,$2,$3::jsonb,(SELECT COALESCE(MAX(posicion),-1)+1 FROM lista_bloques WHERE lista_id=$1))
      RETURNING id,lista_id,tipo,contenido,posicion,version,created_at,updated_at`,
    [req.params.listId, type, JSON.stringify(content)]);
    res.status(201).json(result.rows[0]);
  }));

  router.patch("/bloques/:id", handler(async (req, res) => {
    const version = expectedVersion(req.body?.expected_version);
    const type = normalizeBlockType(req.body?.tipo);
    const content = normalizeBlockContent(type, req.body?.contenido);
    const result = await pool.query(`UPDATE lista_bloques b SET tipo=$1,contenido=$2::jsonb,
      version=b.version+1,updated_at=NOW() FROM listas_personales l
      WHERE b.id=$3 AND l.id=b.lista_id AND l.usuario_id=$4 AND b.version=$5
      RETURNING b.id,b.lista_id,b.tipo,b.contenido,b.posicion,b.version,b.created_at,b.updated_at`,
    [type, JSON.stringify(content), req.params.id, Number(req.auth.id), version]);
    if (!result.rowCount) {
      const owned = await pool.query(`SELECT b.id FROM lista_bloques b
        JOIN listas_personales l ON l.id=b.lista_id WHERE b.id=$1 AND l.usuario_id=$2`,
      [req.params.id, Number(req.auth.id)]);
      if (!owned.rowCount) throw httpError(404, "Bloque no encontrado.");
      throw httpError(409, "El bloque cambió. Volvé a cargarlo antes de guardar.");
    }
    res.json(result.rows[0]);
  }));

  router.delete("/bloques/:id", handler(async (req, res) => {
    const result = await pool.query(`DELETE FROM lista_bloques b USING listas_personales l
      WHERE b.id=$1 AND l.id=b.lista_id AND l.usuario_id=$2 RETURNING b.id`,
    [req.params.id, Number(req.auth.id)]);
    if (!result.rowCount) throw httpError(404, "Bloque no encontrado.");
    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.patch("/orden/reordenar", handler(async (req, res) => {
    const userId = Number(req.auth.id);
    const kind = String(req.body?.tipo || "");
    const ids = normalizeIds(req.body?.ids);
    const parentId = kind==='listas'?null:personalRecordId(req.body?.parent_id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let valid;
      if (kind === "listas") {
        valid = await client.query("SELECT id FROM listas_personales WHERE usuario_id=$1 AND id=ANY($2::bigint[])", [userId, ids]);
      } else if (kind === "bloques") {
        await requireOwnedList(client, parentId, userId);
        valid = await client.query("SELECT id FROM lista_bloques WHERE lista_id=$1 AND id=ANY($2::bigint[])", [parentId, ids]);
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
      const table = kind === "listas" ? "listas_personales" : kind === "bloques" ? "lista_bloques" : kind === "secciones" ? "lista_secciones" : "lista_items";
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
