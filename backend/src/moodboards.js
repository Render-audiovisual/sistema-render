import fs from "node:fs";
import path from "node:path";
import express from "express";
import { mutateMoodboardTaskLink } from './moodboard-task-access.js';
import { readMoodboardTaskPage, readMoodboardTaskContext } from './moodboard-task-pages.js';
import { createMoodboardCategoriesRouter } from './moodboard-categories.js';
import {applyMoodboardReferenceOperation,readMoodboardReferences,readMoodboardReference} from './moodboard-reference-write.js';
import {moodboardReferenceAliasInput,moodboardReferenceAliasBody} from './moodboard-reference-compat.js';

const DEFAULT_CATEGORIES = ["Fotografía", "Tipografía", "Color", "Composición", "Historias", "Carrusel", "Flyer"];

function sharedBoardName(name) {
  const value = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (value.includes("angel azul")) return "El Ángel Azul";
  if (value.includes("lavalle")) return "Lavalle";
  return String(name || "Cliente").trim();
}

async function ensureBoards(pool) {
  const { rows: clients } = await pool.query("SELECT id, nombre FROM clientes WHERE COALESCE(activo, true) = true ORDER BY nombre FOR SHARE");
  for (const client of clients) {
    const linked = await pool.query("SELECT board_id FROM moodboard_board_clients WHERE cliente_id = $1", [client.id]);
    if (linked.rowCount) continue;
    const boardName = sharedBoardName(client.nombre);
    let board = await pool.query("SELECT id FROM moodboard_boards WHERE lower(nombre) = lower($1) ORDER BY id LIMIT 1", [boardName]);
    if (!board.rowCount) board = await pool.query("INSERT INTO moodboard_boards(nombre) VALUES ($1) RETURNING id", [boardName]);
    const boardId = board.rows[0].id;
    // Match category batches: serialize a board before touching its categories.
    // Non-key lock allows normal FK references without locking their rows first.
    await pool.query('SELECT id FROM moodboard_boards WHERE id=$1 FOR NO KEY UPDATE', [boardId]);
    await pool.query("INSERT INTO moodboard_board_clients(board_id, cliente_id) VALUES ($1, $2) ON CONFLICT (cliente_id) DO NOTHING", [boardId, client.id]);
    for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
      await pool.query("INSERT INTO moodboard_categories(board_id, nombre, orden) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [boardId, category, index + 1]);
    }
  }
}

export async function initializeMoodboards(pool, auth) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1 || !Number.isSafeInteger(auth.session_version)) {
    throw Object.assign(new Error('Volvé a iniciar sesión.'), { status: 401 });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One explicit initializer at a time; no duplicate board creation when two
    // team members initialize simultaneously. Never seed fictional references.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['render:moodboards:initialize']);
    const actor = (await client.query('SELECT id,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [auth.id])).rows[0];
    if (!actor || actor.activo !== true || Number(actor.session_version) !== auth.session_version) {
      throw Object.assign(new Error('La sesión ya no está vigente.'), { status: 401 });
    }
    await ensureBoards(client);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function createMoodboardsRouter({ pool }) {
  const router = express.Router();
  router.use(createMoodboardCategoriesRouter({ pool }));
  const hostingerVersionsMarker = `${path.sep}hbuilds${path.sep}versions${path.sep}`;
  const persistentRoot = process.cwd().includes(hostingerVersionsMarker)
    ? process.cwd().split(hostingerVersionsMarker)[0]
    : process.cwd();
  const uploadDir = path.resolve(process.env.MOODBOARD_UPLOAD_DIR || path.join(persistentRoot, "storage", "moodboards"));
  fs.mkdirSync(uploadDir, { recursive: true });

  router.get("/boards", async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT b.id, b.nombre,
        COALESCE(json_agg(json_build_object('id', c.id, 'nombre', c.nombre) ORDER BY c.nombre) FILTER (WHERE c.id IS NOT NULL), '[]') AS clientes,
        COALESCE(inventory.total_referencias,0)::int AS total_referencias
        FROM moodboard_boards b
        JOIN moodboard_board_clients bc ON bc.board_id = b.id
        JOIN clientes c ON c.id = bc.cliente_id AND COALESCE(c.activo, true) = true
        LEFT JOIN (SELECT board_id,count(*)::int AS total_referencias
          FROM moodboard_references GROUP BY board_id) inventory ON inventory.board_id=b.id
        GROUP BY b.id,inventory.total_referencias ORDER BY b.nombre,b.id`);
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.post('/boards/initialize', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).length)) return res.status(400).json({ error: 'No se necesitan datos adicionales.' });
    try { res.json(await initializeMoodboards(pool, req.auth)); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  const referenceFailure=(error,res,next)=>{
    if([400,401,403,404,409,413,422,428].includes(error.status))return res.status(error.status).json({error:error.message,...(error.code?{code:error.code}:{})});
    next(error);
  };
  router.get("/boards/:id/references", async (req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await readMoodboardReferences(pool,req.auth,req.params.id,req.query));}
    catch(error){referenceFailure(error,res,next);}
  });
  router.get('/references/:id/detail',async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{res.json({version:1,reference:await readMoodboardReference(pool,req.auth,req.params.id,req.query)});}
    catch(error){referenceFailure(error,res,next);}
  });

  router.get("/boards/:id/categories", async (req, res, next) => {
    try { const { rows } = await pool.query("SELECT id, nombre, orden FROM moodboard_categories WHERE board_id = $1 ORDER BY orden, nombre", [req.params.id]); res.json(rows); }
    catch (error) { next(error); }
  });

  router.get("/boards/:id/tasks/:taskId", async (req, res, next) => {
    res.set('Cache-Control','no-store');
    try { res.json(await readMoodboardTaskContext(pool,req.auth,req.params.id,req.params.taskId,req.query)); }
    catch (error) { if(error.status)return res.status(error.status).json({error:error.message});next(error); }
  });

  router.get("/boards/:id/tasks", async (req, res, next) => {
    res.set('Cache-Control','no-store');
    try {
      res.json(await readMoodboardTaskPage(pool,req.auth,req.params.id,req.query));
    } catch (error) { if(error.status)return res.status(error.status).json({error:error.message});next(error); }
  });

  router.get("/assets/:filename", async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename || !/^[a-f0-9-]+\.(jpg|png)$/.test(filename)) return res.sendStatus(404);
    const {id,session_version,rol}=req.auth??{};
    if(!Number.isSafeInteger(id)||id<1||id>2147483647||!Number.isSafeInteger(session_version)||session_version<1||typeof rol!=='string')return res.sendStatus(401);
    try {
      // A retained file from an uncertain COMMIT is not a published asset.
      // Shared visibility still requires a current account and surviving row.
      const result=await pool.query(`SELECT EXISTS (
        SELECT 1 FROM usuarios u WHERE u.id=$1 AND u.activo IS TRUE
          AND u.session_version=$2 AND u.rol=$3
          AND EXISTS (SELECT 1 FROM moodboard_references r WHERE r.archivo_nombre=$4)
      ) AS allowed`,[id,session_version,rol,filename]);
      if(result.rows?.[0]?.allowed!==true)return res.sendStatus(404);
      const target = path.join(uploadDir, filename);
      if (!fs.existsSync(target)) return res.sendStatus(404);
      return res.sendFile(target);
    } catch(error) { next(error); }
  });

  const referenceWrite=(aliasAction=null)=>async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{
      const input=aliasAction?moodboardReferenceAliasInput(aliasAction,req):req.body;
      const result=await applyMoodboardReferenceOperation(pool,req.auth,input,{uploadDir},aliasAction?{}:req.query);
      res.status(result.status).json(aliasAction?moodboardReferenceAliasBody(result):result.body);
    }catch(error){referenceFailure(error,res,next);}
  };
  router.post('/reference-operations',referenceWrite());
  router.post("/boards/:id/references",referenceWrite('create'));
  router.patch("/references/:id",referenceWrite('edit'));
  router.delete("/references/:id",referenceWrite('delete'));

  router.post("/references/:id/tasks/:taskId", async (req, res, next) => {
    try { await mutateMoodboardTaskLink(pool,req.auth,req.params.id,req.params.taskId); res.status(204).end(); }
    catch (error) { if(error.status)return res.status(error.status).json({error:error.message});next(error); }
  });
  router.delete("/references/:id/tasks/:taskId", async (req, res, next) => {
    try { await mutateMoodboardTaskLink(pool,req.auth,req.params.id,req.params.taskId,{remove:true}); res.status(204).end(); }
    catch (error) { if(error.status)return res.status(error.status).json({error:error.message});next(error); }
  });

  router.post("/boards/:id/categories", async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.status(410).json({ error: 'Actualizá las categorías y usá el guardado conjunto con revisión.' });
  });
  router.patch("/categories/:id", async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.status(410).json({ error: 'Actualizá las categorías y usá el guardado conjunto con revisión.' });
  });
  router.delete("/categories/:id", async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.status(410).json({ error: 'Actualizá las categorías y usá el guardado conjunto con revisión.' });
  });
  return router;
}
