import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CATEGORIES = ["Fotografía", "Tipografía", "Color", "Composición", "Historias", "Carrusel", "Flyer"];

function sharedBoardName(name) {
  const value = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (value.includes("angel azul")) return "El Ángel Azul";
  if (value.includes("lavalle")) return "Lavalle";
  return String(name || "Cliente").trim();
}

async function ensureBoards(pool) {
  const { rows: clients } = await pool.query("SELECT id, nombre FROM clientes WHERE COALESCE(activo, true) = true ORDER BY nombre");
  for (const client of clients) {
    const linked = await pool.query("SELECT board_id FROM moodboard_board_clients WHERE cliente_id = $1", [client.id]);
    if (linked.rowCount) continue;
    const boardName = sharedBoardName(client.nombre);
    let board = await pool.query("SELECT id FROM moodboard_boards WHERE lower(nombre) = lower($1) ORDER BY id LIMIT 1", [boardName]);
    if (!board.rowCount) board = await pool.query("INSERT INTO moodboard_boards(nombre) VALUES ($1) RETURNING id", [boardName]);
    const boardId = board.rows[0].id;
    await pool.query("INSERT INTO moodboard_board_clients(board_id, cliente_id) VALUES ($1, $2) ON CONFLICT (cliente_id) DO NOTHING", [boardId, client.id]);
    for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
      await pool.query("INSERT INTO moodboard_categories(board_id, nombre, orden) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [boardId, category, index + 1]);
    }
    const existing = await pool.query("SELECT 1 FROM moodboard_references WHERE board_id = $1 LIMIT 1", [boardId]);
    if (!existing.rowCount) {
      const category = await pool.query("SELECT id FROM moodboard_categories WHERE board_id = $1 ORDER BY orden LIMIT 1", [boardId]);
      await pool.query(`INSERT INTO moodboard_references
        (board_id, category_id, titulo, nota, etiquetas, estado, tipo_fuente, enlace_externo, autor_nombre)
        VALUES ($1, $2, 'Referencia visual de ejemplo', $3, ARRAY['ejemplo','inspiración'], 'libre', 'enlace', $4, 'Equipo RENDER')`,
      [boardId, category.rows[0]?.id || null, "Esta imagen es un ejemplo para empezar el moodboard. Podés editarla o eliminarla cuando la marca tenga referencias propias.", "https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=82"]);
    }
  }
}

function parseImage(dataUrl) {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { buffer, extension: match[1] === "jpeg" ? "jpg" : "png" };
}

export function createMoodboardsRouter({ pool }) {
  const router = express.Router();
  const uploadDir = process.env.MOODBOARD_UPLOAD_DIR || path.join(process.cwd(), "storage", "moodboards");
  fs.mkdirSync(uploadDir, { recursive: true });

  router.get("/boards", async (_req, res, next) => {
    try {
      await ensureBoards(pool);
      const { rows } = await pool.query(`SELECT b.id, b.nombre,
        COALESCE(json_agg(json_build_object('id', c.id, 'nombre', c.nombre) ORDER BY c.nombre) FILTER (WHERE c.id IS NOT NULL), '[]') AS clientes,
        count(DISTINCT r.id)::int AS total_referencias
        FROM moodboard_boards b
        JOIN moodboard_board_clients bc ON bc.board_id = b.id
        JOIN clientes c ON c.id = bc.cliente_id AND COALESCE(c.activo, true) = true
        LEFT JOIN moodboard_references r ON r.board_id = b.id
        GROUP BY b.id ORDER BY b.nombre`);
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.get("/boards/:id/references", async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT r.*, c.nombre AS categoria,
        COALESCE(json_agg(json_build_object('id', t.id, 'titulo', t.titulo)) FILTER (WHERE t.id IS NOT NULL), '[]') AS tareas
        FROM moodboard_references r
        LEFT JOIN moodboard_categories c ON c.id = r.category_id
        LEFT JOIN moodboard_reference_tasks rt ON rt.reference_id = r.id
        LEFT JOIN tareas t ON t.id = rt.tarea_id
        WHERE r.board_id = $1 GROUP BY r.id, c.nombre
        ORDER BY CASE r.estado WHEN 'aprobada' THEN 0 WHEN 'libre' THEN 1 ELSE 2 END, r.created_at DESC`, [req.params.id]);
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.get("/boards/:id/categories", async (req, res, next) => {
    try { const { rows } = await pool.query("SELECT id, nombre, orden FROM moodboard_categories WHERE board_id = $1 ORDER BY orden, nombre", [req.params.id]); res.json(rows); }
    catch (error) { next(error); }
  });

  router.get("/boards/:id/tasks", async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT DISTINCT t.id, t.titulo FROM tareas t
        JOIN moodboard_board_clients bc ON bc.cliente_id = t.cliente_id
        WHERE bc.board_id = $1
        ORDER BY t.titulo LIMIT 150`, [req.params.id]);
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.get("/assets/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename || !/^[a-f0-9-]+\.(jpg|png)$/.test(filename)) return res.sendStatus(404);
    const target = path.join(uploadDir, filename);
    if (!fs.existsSync(target)) return res.sendStatus(404);
    return res.sendFile(target);
  });

  router.post("/boards/:id/references", async (req, res, next) => {
    try {
      const { title, note, category_id, tags = [], external_url, image_data } = req.body || {};
      if (!String(note || "").trim() || !category_id) return res.status(400).json({ error: "La nota y la categoría son obligatorias." });
      let fileName = null;
      let sourceType = "enlace";
      let link = String(external_url || "").trim() || null;
      if (image_data) {
        const image = parseImage(image_data);
        if (!image) return res.status(400).json({ error: "Usá una imagen JPG o PNG de hasta 10 MB." });
        fileName = `${crypto.randomUUID()}.${image.extension}`;
        fs.writeFileSync(path.join(uploadDir, fileName), image.buffer, { flag: "wx" });
        sourceType = "imagen";
        link = null;
      } else if (!link || !/^https?:\/\//i.test(link)) return res.status(400).json({ error: "Ingresá una imagen o un enlace válido." });
      else if (/pinterest\.|pin\.it/i.test(link)) sourceType = "pinterest";
      const { rows } = await pool.query(`INSERT INTO moodboard_references
        (board_id, category_id, titulo, nota, etiquetas, estado, tipo_fuente, enlace_externo, archivo_nombre, autor_id, autor_nombre)
        VALUES ($1,$2,$3,$4,$5,'libre',$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, category_id, String(title || "").trim() || "Referencia sin título", String(note).trim(), Array.isArray(tags) ? tags : [], sourceType, link, fileName, req.auth.id, req.auth.nombre || req.auth.usuario || "Equipo RENDER"]);
      res.status(201).json(rows[0]);
    } catch (error) { next(error); }
  });

  router.patch("/references/:id", async (req, res, next) => {
    try {
      const allowed = { title: "titulo", note: "nota", category_id: "category_id", tags: "etiquetas", status: "estado" };
      const entries = Object.entries(req.body || {}).filter(([key]) => allowed[key]);
      if (!entries.length) return res.status(400).json({ error: "No hay cambios para guardar." });
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`);
      values.push(req.params.id);
      const { rows } = await pool.query(`UPDATE moodboard_references SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values);
      if (!rows.length) return res.status(404).json({ error: "Referencia no encontrada." });
      res.json(rows[0]);
    } catch (error) { next(error); }
  });

  router.delete("/references/:id", async (req, res, next) => {
    try {
      const { rows } = await pool.query("DELETE FROM moodboard_references WHERE id = $1 RETURNING archivo_nombre", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Referencia no encontrada." });
      if (rows[0].archivo_nombre) fs.rm(path.join(uploadDir, rows[0].archivo_nombre), { force: true }, () => {});
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.post("/references/:id/tasks/:taskId", async (req, res, next) => {
    try { await pool.query("INSERT INTO moodboard_reference_tasks(reference_id, tarea_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.params.id, req.params.taskId]); res.status(204).end(); }
    catch (error) { next(error); }
  });
  router.delete("/references/:id/tasks/:taskId", async (req, res, next) => {
    try { await pool.query("DELETE FROM moodboard_reference_tasks WHERE reference_id = $1 AND tarea_id = $2", [req.params.id, req.params.taskId]); res.status(204).end(); }
    catch (error) { next(error); }
  });

  router.post("/boards/:id/categories", async (req, res, next) => {
    try {
      const name = String(req.body?.name || "").trim(); if (!name) return res.status(400).json({ error: "Escribí un nombre." });
      const { rows } = await pool.query("INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES ($1,$2,(SELECT COALESCE(max(orden),0)+1 FROM moodboard_categories WHERE board_id=$1)) RETURNING *", [req.params.id, name]);
      res.status(201).json(rows[0]);
    } catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Esa categoría ya existe." }); next(error); }
  });
  router.patch("/categories/:id", async (req, res, next) => {
    try { const name = String(req.body?.name || "").trim(); const { rows } = await pool.query("UPDATE moodboard_categories SET nombre=$1 WHERE id=$2 RETURNING *", [name, req.params.id]); res.json(rows[0]); }
    catch (error) { next(error); }
  });
  router.delete("/categories/:id", async (req, res, next) => {
    try { await pool.query("DELETE FROM moodboard_categories WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (error) { next(error); }
  });
  return router;
}
