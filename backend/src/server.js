import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { checkDatabaseConnection, pool } from "./db.js";
import { setupDemoClientes } from "./setup-demo-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const router = express.Router();
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "2mb" }));

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.post("/login", async (req, res, next) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan usuario o contraseña." });
    }

    const result = await pool.query(
      "SELECT id, usuario, nombre, rol, foto_perfil, password_hash FROM usuarios WHERE lower(usuario) = lower($1)",
      [usuario],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    const usuarioDB = result.rows[0];
    const passwordValida = await bcrypt.compare(
      password,
      usuarioDB.password_hash,
    );

    if (!passwordValida) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    const token = jwt.sign(
      {
        id: usuarioDB.id,
        usuario: usuarioDB.usuario,
        nombre: usuarioDB.nombre,
        rol: usuarioDB.rol,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      token,
      usuario: {
        usuario: usuarioDB.usuario,
        nombre: usuarioDB.nombre,
        rol: usuarioDB.rol,
        foto_perfil: usuarioDB.foto_perfil,
      },
    });
  } catch (error) {
    next(error);
  }
});

const ROLES_VALIDOS = [
  "admin",
  "diseno",
  "edicion",
  "produccion",
  "community",
];

router.get("/usuarios", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, usuario, nombre, rol, foto_perfil, created_at FROM usuarios ORDER BY id",
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/usuarios", async (req, res, next) => {
  try {
    const { usuario, nombre, rol, password } = req.body;

    if (!usuario || !nombre || !rol || !password) {
      return res.status(400).json({ error: "Faltan datos del empleado." });
    }
    if (!ROLES_VALIDOS.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (usuario, nombre, rol, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, usuario, nombre, rol, foto_perfil, created_at`,
      [usuario, nombre, rol, passwordHash],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "Ya existe un usuario con ese nombre de acceso." });
    }
    next(error);
  }
});

router.delete("/usuarios/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM usuarios WHERE id = $1 RETURNING id",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch("/usuarios/perfil", async (req, res, next) => {
  try {
    const { usuario_actual, password_actual, usuario_nuevo } = req.body;
    const usuarioNuevo = (usuario_nuevo || "").trim();

    if (!usuario_actual || !password_actual || !usuarioNuevo) {
      return res
        .status(400)
        .json({ error: "Faltan el usuario actual, la contraseña actual y el usuario nuevo." });
    }

    const found = await pool.query(
      "SELECT id, usuario, nombre, rol, foto_perfil, password_hash FROM usuarios WHERE lower(usuario) = lower($1)",
      [usuario_actual],
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const usuarioDB = found.rows[0];
    const passwordValida = await bcrypt.compare(
      password_actual,
      usuarioDB.password_hash,
    );
    if (!passwordValida) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta." });
    }

    const duplicado = await pool.query(
      "SELECT id FROM usuarios WHERE lower(usuario) = lower($1) AND id <> $2",
      [usuarioNuevo, usuarioDB.id],
    );
    if (duplicado.rows.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese nombre de acceso." });
    }

    const updated = await pool.query(
      `UPDATE usuarios
       SET usuario = $1
       WHERE id = $2
       RETURNING id, usuario, nombre, rol, foto_perfil, created_at`,
      [usuarioNuevo, usuarioDB.id],
    );

    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/usuarios/foto", async (req, res, next) => {
  try {
    const { usuario, foto_perfil } = req.body;
    const foto = typeof foto_perfil === "string" ? foto_perfil.trim() : "";

    if (!usuario) {
      return res.status(400).json({ error: "Falta el usuario." });
    }
    if (foto && !foto.startsWith("data:image/")) {
      return res.status(400).json({ error: "La foto debe ser una imagen válida." });
    }
    if (foto.length > 1500000) {
      return res.status(400).json({ error: "La foto es demasiado pesada." });
    }

    const updated = await pool.query(
      `UPDATE usuarios
       SET foto_perfil = $1
       WHERE lower(usuario) = lower($2)
       RETURNING id, usuario, nombre, rol, foto_perfil, created_at`,
      [foto || null, usuario],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/usuarios/password", async (req, res, next) => {
  try {
    const { usuario, password_actual, password_nueva } = req.body;

    if (!usuario || !password_actual || !password_nueva) {
      return res
        .status(400)
        .json({ error: "Faltan la contraseña actual y la nueva." });
    }

    const found = await pool.query(
      "SELECT id, password_hash FROM usuarios WHERE lower(usuario) = lower($1)",
      [usuario],
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const passwordValida = await bcrypt.compare(
      password_actual,
      found.rows[0].password_hash,
    );
    if (!passwordValida) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta." });
    }

    const passwordHash = await bcrypt.hash(password_nueva, 10);
    await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      found.rows[0].id,
    ]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ── WORKFLOW DE HISTORIAS [DEPRECATED - CONSOLIDADO EN HISTORIAS] ─────────────
// Estos endpoints fueron consolidados en GET/PATCH /historias
// Ver migration 002_consolidate_historias_workflow.sql para detalles

// Mantener para retrocompatibilidad temporal - redirigen a historias
router.get("/workflow-historias", async (req, res, next) => {
  try {
    res.status(410).json({
      error: "Endpoint deprecated. Use GET /historias instead.",
      deprecated_since: "2026-07-19",
      migration: "See migration 002_consolidate_historias_workflow.sql"
    });
  } catch (error) {
    next(error);
  }
});

router.post("/workflow-historias", async (req, res, next) => {
  res.status(410).json({
    error: "Endpoint deprecated. Use POST /historias instead.",
    deprecated_since: "2026-07-19"
  });
});

router.patch("/workflow-historias/:id", async (req, res, next) => {
  res.status(410).json({
    error: "Endpoint deprecated. Use PATCH /historias/:id instead.",
    deprecated_since: "2026-07-19"
  });
});

// ── ESTRUCTURA BASE POR CLIENTE ──────────────────────────────────────────────

router.get("/estructura", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.cliente_id,
        c.nombre AS cliente_nombre,
        e.dia_semana,
        e.tema,
        e.horario,
        e.cta_fijo,
        e.tipo,
        e.activo
      FROM estructura_cliente e
      JOIN clientes c ON c.id = e.cliente_id
      WHERE e.activo = true
      ORDER BY c.nombre, e.dia_semana
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/estructura", async (req, res, next) => {
  try {
    const { cliente_id, dia_semana, tema, horario, cta_fijo, tipo } = req.body;

    if (!cliente_id || dia_semana === undefined) {
      return res.status(400).json({ error: "Faltan cliente_id o dia_semana." });
    }

    const result = await pool.query(
      `INSERT INTO estructura_cliente (cliente_id, dia_semana, tema, horario, cta_fijo, tipo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [cliente_id, dia_semana, tema || null, horario || null, cta_fijo || null, tipo || null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── CHECK DE PUBLICACIÓN DIARIO ───────────────────────────────────────────────

router.get("/check-publicacion", async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;

    const result = await pool.query(`
      SELECT
        cp.id,
        cp.cliente_id,
        c.nombre AS cliente_nombre,
        to_char(cp.fecha, 'YYYY-MM-DD') AS fecha,
        cp.publicado,
        cp.confirmado_por,
        cp.confirmado_at
      FROM check_publicacion cp
      JOIN clientes c ON c.id = cp.cliente_id
      WHERE
        ($1::date IS NULL OR cp.fecha >= $1::date) AND
        ($2::date IS NULL OR cp.fecha <= $2::date)
      ORDER BY cp.fecha, c.nombre
    `, [desde || null, hasta || null]);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/check-publicacion", async (req, res, next) => {
  try {
    const { cliente_id, fecha, publicado, confirmado_por } = req.body;

    if (!cliente_id || !fecha) {
      return res.status(400).json({ error: "Faltan cliente_id o fecha." });
    }

    const result = await pool.query(
      `INSERT INTO check_publicacion (cliente_id, fecha, publicado, confirmado_por, confirmado_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cliente_id, fecha)
       DO UPDATE SET
         publicado = EXCLUDED.publicado,
         confirmado_por = EXCLUDED.confirmado_por,
         confirmado_at = EXCLUDED.confirmado_at,
         updated_at = now()
       RETURNING id, cliente_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, publicado, confirmado_por, confirmado_at`,
      [
        cliente_id,
        fecha,
        Boolean(publicado),
        confirmado_por || null,
        publicado ? new Date().toISOString() : null,
      ],
    );

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── FECHAS ESPECIALES ─────────────────────────────────────────────────────────

router.get("/fechas-especiales", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        fe.id,
        fe.cliente_id,
        c.nombre AS cliente_nombre,
        to_char(fe.fecha, 'YYYY-MM-DD') AS fecha,
        fe.evento,
        fe.tipo,
        fe.anticipacion_dias,
        fe.idea,
        fe.estado
      FROM fechas_especiales fe
      LEFT JOIN clientes c ON c.id = fe.cliente_id
      ORDER BY fe.fecha NULLS LAST, fe.evento
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch("/fechas-especiales/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, idea } = req.body;

    const estadosValidos = ["pendiente", "en_curso", "hecho"];
    if (estado && !estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }

    const result = await pool.query(
      `UPDATE fechas_especiales
       SET
         estado = COALESCE($1, estado),
         idea = COALESCE($2, idea),
         updated_at = now()
       WHERE id = $3
       RETURNING id, to_char(fecha, 'YYYY-MM-DD') AS fecha, evento, tipo, anticipacion_dias, idea, estado`,
      [estado || null, idea || null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Fecha especial no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/clientes", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, nombre, cuota_reels, cuota_carruseles
      FROM clientes
      ORDER BY id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch("/clientes/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cuota_reels, cuota_carruseles } = req.body;

    const cuotaReelsValida =
      cuota_reels === undefined ||
      (Number.isInteger(cuota_reels) && cuota_reels >= 0);
    const cuotaCarruselesValida =
      cuota_carruseles === undefined ||
      (Number.isInteger(cuota_carruseles) && cuota_carruseles >= 0);

    if (!cuotaReelsValida || !cuotaCarruselesValida) {
      return res.status(400).json({
        error: "cuota_reels y cuota_carruseles deben ser enteros ≥ 0.",
      });
    }

    const result = await pool.query(
      `UPDATE clientes
       SET
         cuota_reels = COALESCE($1, cuota_reels),
         cuota_carruseles = COALESCE($2, cuota_carruseles)
       WHERE id = $3
       RETURNING id, nombre, cuota_reels, cuota_carruseles`,
      [cuota_reels ?? null, cuota_carruseles ?? null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/historias/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      estado,
      idea,
      copy,
      material_referencia,
      aclaraciones,
      prioridad,
      fecha_programada,
      responsable,
      responsable_planificacion,
      responsable_diseño,
      responsable_revisión,
      responsable_publicacion,
      fecha_diseño_entrega,
      fecha_revisión_aprobación,
      notas_planificacion,
      notas_diseño,
      notas_revisión,
      notas_bloqueador,
      metadata
    } = req.body;

    const estadosValidos = [
      "pendiente",
      "en_diseño",
      "en_revision",
      "lista",
      "publicada",
      "bloqueada",
    ];

    if (estado !== undefined && !estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }

    const result = await pool.query(
      `UPDATE historias
       SET
         estado = COALESCE($1, estado),
         idea = COALESCE($2, idea),
         copy = COALESCE($3, copy),
         material_referencia = COALESCE($4, material_referencia),
         aclaraciones = COALESCE($5, aclaraciones),
         prioridad = COALESCE($6, prioridad),
         fecha_programada = COALESCE($7, fecha_programada),
         responsable = COALESCE($8, responsable),
         responsable_planificacion = COALESCE($9, responsable_planificacion),
         responsable_diseño = COALESCE($10, responsable_diseño),
         responsable_revisión = COALESCE($11, responsable_revisión),
         responsable_publicacion = COALESCE($12, responsable_publicacion),
         fecha_diseño_entrega = COALESCE($13, fecha_diseño_entrega),
         fecha_revisión_aprobación = COALESCE($14, fecha_revisión_aprobación),
         notas_planificacion = COALESCE($15, notas_planificacion),
         notas_diseño = COALESCE($16, notas_diseño),
         notas_revisión = COALESCE($17, notas_revisión),
         notas_bloqueador = COALESCE($18, notas_bloqueador),
         metadata = CASE WHEN $19::jsonb IS NOT NULL THEN metadata || $19::jsonb ELSE metadata END,
         updated_at = now()
       WHERE id = $20
       RETURNING id, cliente_id, estado, to_char(fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
                 idea, copy, material_referencia, aclaraciones, prioridad, responsable,
                 responsable_diseño, responsable_revisión, to_char(fecha_diseño_entrega, 'YYYY-MM-DD') AS fecha_diseño_entrega,
                 to_char(fecha_revisión_aprobación, 'YYYY-MM-DD') AS fecha_revisión_aprobación,
                 notas_diseño, notas_revisión, notas_bloqueador, metadata, created_at, updated_at`,
      [
        estado || null,
        idea || null,
        copy || null,
        material_referencia || null,
        aclaraciones || null,
        prioridad || null,
        fecha_programada || null,
        responsable || null,
        responsable_planificacion || null,
        responsable_diseño || null,
        responsable_revisión || null,
        responsable_publicacion || null,
        fecha_diseño_entrega || null,
        fecha_revisión_aprobación || null,
        notas_planificacion || null,
        notas_diseño || null,
        notas_revisión || null,
        notas_bloqueador || null,
        metadata ? JSON.stringify(metadata) : null,
        id
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete("/historias/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM historias WHERE id = $1 RETURNING id",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/historias", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        h.id,
        h.cliente_id,
        c.nombre AS cliente_nombre,
        h.estado,
        to_char(h.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        h.idea,
        h.copy,
        h.material_referencia,
        h.aclaraciones,
        h.prioridad,
        h.responsable,
        h.responsable_planificacion,
        h.responsable_diseño,
        h.responsable_revisión,
        h.responsable_publicacion,
        to_char(h.fecha_planificacion_inicio, 'YYYY-MM-DD') AS fecha_planificacion_inicio,
        to_char(h.fecha_diseño_inicio, 'YYYY-MM-DD') AS fecha_diseño_inicio,
        to_char(h.fecha_diseño_entrega, 'YYYY-MM-DD') AS fecha_diseño_entrega,
        to_char(h.fecha_revisión_inicio, 'YYYY-MM-DD') AS fecha_revisión_inicio,
        to_char(h.fecha_revisión_aprobación, 'YYYY-MM-DD') AS fecha_revisión_aprobación,
        h.fecha_publicación_real,
        h.notas_planificacion,
        h.notas_diseño,
        h.notas_revisión,
        h.notas_bloqueador,
        h.metadata,
        h.created_at,
        h.updated_at
      FROM historias h
      JOIN clientes c ON c.id = h.cliente_id
      ORDER BY h.fecha_programada DESC, h.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch("/publicaciones/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      estado,
      tipo,
      idea,
      copy,
      material_referencia,
      aclaraciones,
      prioridad,
      fecha_programada,
      responsable,
      duracion_segundos,
      num_imagenes,
      responsable_diseño,
      responsable_edición,
      responsable_revisión,
      responsable_publicacion,
      fecha_diseño_entrega,
      fecha_edición_entrega,
      fecha_revisión_aprobación,
      metadata,
    } = req.body;

    const estadosValidos = [
      "pendiente",
      "en_diseño",
      "en_edición",
      "en_revision",
      "en_revisión",
      "lista",
      "publicada",
      "bloqueada",
    ];
    const tiposValidos = ["video", "carrusel"];

    if (estado !== undefined && !estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }
    if (tipo !== undefined && !tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo inválido. Usa: video, carrusel" });
    }

    const result = await pool.query(
      `UPDATE publicaciones
       SET
         estado = COALESCE($1, estado),
         tipo = COALESCE($2, tipo),
         idea = COALESCE($3, idea),
         copy = COALESCE($4, copy),
         material_referencia = COALESCE($5, material_referencia),
         aclaraciones = COALESCE($6, aclaraciones),
         prioridad = COALESCE($7, prioridad),
         fecha_programada = COALESCE($8, fecha_programada),
         responsable = COALESCE($9, responsable),
         duracion_segundos = COALESCE($10, duracion_segundos),
         num_imagenes = COALESCE($11, num_imagenes),
         responsable_diseño = COALESCE($12, responsable_diseño),
         responsable_edición = COALESCE($13, responsable_edición),
         responsable_revisión = COALESCE($14, responsable_revisión),
         responsable_publicacion = COALESCE($15, responsable_publicacion),
         fecha_diseño_entrega = COALESCE($16, fecha_diseño_entrega),
         fecha_edición_entrega = COALESCE($17, fecha_edición_entrega),
         fecha_revisión_aprobación = COALESCE($18, fecha_revisión_aprobación),
         fecha_publicación_real = CASE
           WHEN $1 = 'publicada' AND estado <> 'publicada' THEN now()
           WHEN $1 IS NOT NULL AND $1 <> 'publicada' THEN NULL
           ELSE fecha_publicación_real
         END,
         metadata = CASE WHEN $19::jsonb IS NOT NULL THEN metadata || $19::jsonb ELSE metadata END,
         updated_at = now()
       WHERE id = $20
       RETURNING id, cliente_id, tipo, estado, to_char(fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
                 idea, copy, material_referencia, aclaraciones, prioridad, responsable,
                 duracion_segundos, num_imagenes,
                 responsable_diseño, responsable_edición, responsable_revisión, responsable_publicacion,
                 to_char(fecha_diseño_entrega, 'YYYY-MM-DD') AS fecha_diseño_entrega,
                 to_char(fecha_edición_entrega, 'YYYY-MM-DD') AS fecha_edición_entrega,
                 to_char(fecha_revisión_aprobación, 'YYYY-MM-DD') AS fecha_revisión_aprobación,
                 to_char(fecha_publicación_real, 'YYYY-MM-DD HH24:MI') AS fecha_publicación_real,
                 metadata, created_at, updated_at`,
      [
        estado || null,
        tipo || null,
        idea || null,
        copy || null,
        material_referencia || null,
        aclaraciones || null,
        prioridad || null,
        fecha_programada || null,
        responsable || null,
        duracion_segundos || null,
        num_imagenes || null,
        responsable_diseño || null,
        responsable_edición || null,
        responsable_revisión || null,
        responsable_publicacion || null,
        fecha_diseño_entrega || null,
        fecha_edición_entrega || null,
        fecha_revisión_aprobación || null,
        metadata ? JSON.stringify(metadata) : null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicación no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete("/publicaciones/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM publicaciones WHERE id = $1 RETURNING id",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicación no encontrada." });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/publicaciones", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.cliente_id,
        c.nombre AS cliente_nombre,
        p.tipo,
        p.estado,
        to_char(p.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        p.idea,
        p.copy,
        p.material_referencia,
        p.aclaraciones,
        p.prioridad,
        p.responsable,
        p.duracion_segundos,
        p.num_imagenes,
        p.responsable_diseño,
        p.responsable_edición,
        p.responsable_revisión,
        p.responsable_publicacion,
        to_char(p.fecha_diseño_entrega, 'YYYY-MM-DD') AS fecha_diseño_entrega,
        to_char(p.fecha_edición_entrega, 'YYYY-MM-DD') AS fecha_edición_entrega,
        to_char(p.fecha_revisión_aprobación, 'YYYY-MM-DD') AS fecha_revisión_aprobación,
        to_char(p.fecha_publicación_real, 'YYYY-MM-DD HH24:MI') AS fecha_publicación_real,
        p.metadata,
        p.created_at,
        p.updated_at
      FROM publicaciones p
      JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.fecha_programada DESC, p.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/tareas", async (req, res, next) => {
  try {
    const {
      titulo,
      asignado_a,
      cliente_id,
      estado,
      requiere_aprobacion,
      escalada_a,
      motivo,
      fecha_vencimiento,
      historia_id,
      publicacion_id,
      tipo_tarea,
      subtipo,
      prioridad,
    } = req.body;

    if (!titulo || !asignado_a) {
      return res.status(400).json({ error: "Faltan título o asignado_a." });
    }

    const estadosValidos = [
      "pendiente",
      "en_progreso",
      "en_revision",
      "hecha",
      "bloqueada",
    ];
    const estadoFinal = estadosValidos.includes(estado)
      ? estado
      : "pendiente";

    const propiedadesExtra = { Origen: "Cargada desde la plataforma" };
    if (escalada_a) {
      propiedadesExtra.escalada_a = escalada_a;
    }
    if (motivo) {
      propiedadesExtra.motivo = motivo;
    }

    const result = await pool.query(
      `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, created_at, updated_at`,
      [
        titulo,
        asignado_a,
        cliente_id || null,
        estadoFinal,
        Boolean(requiere_aprobacion),
        JSON.stringify(propiedadesExtra),
        fecha_vencimiento || null,
        historia_id || null,
        publicacion_id || null,
        tipo_tarea || null,
        subtipo || null,
        prioridad || "media",
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/tareas/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, propiedades_extra, tipo_tarea, subtipo, prioridad } = req.body;

    const estadosValidos = [
      "pendiente",
      "en_progreso",
      "en_revision",
      "hecha",
      "bloqueada",
    ];

    if (estado !== undefined && !estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }

    const result = await pool.query(
      `UPDATE tareas
       SET
         estado = COALESCE($1, estado),
         tipo_tarea = COALESCE($4, tipo_tarea),
         subtipo = COALESCE($5, subtipo),
         prioridad = COALESCE($6, prioridad),
         propiedades_extra = CASE
           WHEN $2::jsonb IS NOT NULL THEN propiedades_extra || $2::jsonb
           ELSE propiedades_extra
         END,
         updated_at = now()
       WHERE id = $3
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, created_at, updated_at`,
      [
        estado || null,
        propiedades_extra ? JSON.stringify(propiedades_extra) : null,
        id,
        tipo_tarea || null,
        subtipo || null,
        prioridad || null,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/tareas", async (req, res, next) => {
  try {
    const { asignado_a, tipo_tarea, historia_id, publicacion_id } = req.query;

    let query = `
      SELECT
        t.id,
        t.titulo,
        t.estado,
        t.asignado_a,
        t.requiere_aprobacion,
        t.tarea_padre_id,
        t.propiedades_extra,
        t.cliente_id,
        c.nombre AS cliente_nombre,
        to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        t.historia_id,
        t.publicacion_id,
        t.tipo_tarea,
        t.subtipo,
        t.prioridad,
        t.created_at,
        t.updated_at
      FROM tareas t
      LEFT JOIN clientes c ON c.id = t.cliente_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (asignado_a) {
      query += ` AND t.asignado_a = $${paramCount}`;
      params.push(asignado_a);
      paramCount++;
    }
    if (tipo_tarea) {
      query += ` AND t.tipo_tarea = $${paramCount}`;
      params.push(tipo_tarea);
      paramCount++;
    }
    if (historia_id) {
      query += ` AND t.historia_id = $${paramCount}`;
      params.push(historia_id);
      paramCount++;
    }
    if (publicacion_id) {
      query += ` AND t.publicacion_id = $${paramCount}`;
      params.push(publicacion_id);
      paramCount++;
    }

    query += ` ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.id DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/piezas", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        'publicacion' AS origen,
        p.id,
        p.tipo,
        p.estado,
        p.cliente_id,
        c.nombre AS cliente_nombre,
        p.responsable,
        p.fecha_programada,
        p.metadata->>'Idea' AS idea,
        p.metadata->>'Copy' AS copy,
        p.metadata->>'Material' AS material_referencia,
        p.metadata->>'Aclaración' AS aclaraciones,
        p.idea,
        p.copy,
        p.material_referencia,
        p.aclaraciones,
        p.prioridad,
        p.created_at,
        p.updated_at
      FROM publicaciones p
      LEFT JOIN clientes c ON c.id = p.cliente_id

      UNION ALL

      SELECT
        'historia' AS origen,
        h.id,
        'historia'::text AS tipo,
        h.estado,
        h.cliente_id,
        c.nombre AS cliente_nombre,
        h.responsable,
        h.fecha_programada,
        h.metadata->>'Idea' AS idea,
        h.metadata->>'Copy' AS copy,
        h.metadata->>'Material' AS material_referencia,
        h.metadata->>'Aclaración' AS aclaraciones,
        h.idea,
        h.copy,
        h.material_referencia,
        h.aclaraciones,
        h.prioridad,
        h.created_at,
        h.updated_at
      FROM historias h
      LEFT JOIN clientes c ON c.id = h.cliente_id

      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/piezas/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const resultP = await pool.query(
      `SELECT
        'publicacion' AS origen,
        p.id,
        p.tipo,
        p.estado,
        p.cliente_id,
        c.nombre AS cliente_nombre,
        p.responsable,
        p.fecha_programada,
        p.idea,
        p.copy,
        p.material_referencia,
        p.aclaraciones,
        p.prioridad,
        p.created_at,
        p.updated_at
      FROM publicaciones p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = $1`,
      [id],
    );

    if (resultP.rows.length > 0) {
      return res.json(resultP.rows[0]);
    }

    const resultH = await pool.query(
      `SELECT
        'historia' AS origen,
        h.id,
        'historia'::text AS tipo,
        h.estado,
        h.cliente_id,
        c.nombre AS cliente_nombre,
        h.responsable,
        h.fecha_programada,
        h.idea,
        h.copy,
        h.material_referencia,
        h.aclaraciones,
        h.prioridad,
        h.created_at,
        h.updated_at
      FROM historias h
      LEFT JOIN clientes c ON c.id = h.cliente_id
      WHERE h.id = $1`,
      [id],
    );

    if (resultH.rows.length === 0) {
      return res.status(404).json({ error: "Pieza no encontrada." });
    }

    res.json(resultH.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Un día antes de fecha_programada, sin bajar de la fecha de hoy.
// Clientes que Germán filma hoy (confirmado con el dueño del sistema al
// definir responsabilidades — el resto de los clientes con video
// programado todavía no tiene productor asignado, se revisa más adelante).
const CLIENTES_PRODUCCION_GERMAN = ["Luzin", "Moketa", "Búnker Training", "Bohle", "Capital Motos"];

function fechaVencimientoTarea(fechaProgramada, diasAntes = 1) {
  const f = new Date(`${fechaProgramada}T00:00:00`);
  f.setDate(f.getDate() - diasAntes);
  return f.toISOString().slice(0, 10);
}

async function crearTareaAuto({ titulo, asignado_a, cliente_id, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo }) {
  await pool.query(
    `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad)
     VALUES ($1, $2, $3, 'pendiente', false, $4, $5, $6, $7, $8, $9, 'media')`,
    [
      titulo,
      asignado_a,
      cliente_id,
      JSON.stringify({ Origen: "Generada automáticamente al crear la pieza" }),
      fecha_vencimiento,
      historia_id || null,
      publicacion_id || null,
      tipo_tarea,
      subtipo || null,
    ],
  );
}

router.post("/piezas", async (req, res, next) => {
  try {
    const {
      tipo,
      cliente_id,
      responsable,
      fecha_programada,
      estado,
      idea,
      copy,
      material_referencia,
      aclaraciones,
      prioridad,
    } = req.body;

    if (!tipo || !cliente_id || !responsable || !fecha_programada) {
      return res
        .status(400)
        .json({
          error: "Faltan tipo, cliente_id, responsable o fecha_programada.",
        });
    }

    if (tipo === "historia") {
      const result = await pool.query(
        `INSERT INTO historias (cliente_id, estado, fecha_programada, responsable, responsable_diseño, idea, copy, material_referencia, aclaraciones, prioridad)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
         RETURNING 'historia' AS origen, id, 'historia' AS tipo, cliente_id, estado, fecha_programada, responsable, idea, copy, material_referencia, aclaraciones, prioridad, created_at, updated_at`,
        [
          cliente_id,
          estado || "pendiente",
          fecha_programada,
          responsable,
          idea || "",
          copy || "",
          material_referencia || "",
          aclaraciones || "",
          prioridad || "media",
        ],
      );
      const historia = result.rows[0];

      await crearTareaAuto({
        titulo: `Diseñar historia - ${idea || "sin idea"}`,
        asignado_a: responsable,
        cliente_id,
        fecha_vencimiento: fechaVencimientoTarea(fecha_programada, 1),
        historia_id: historia.id,
        tipo_tarea: "diseno",
        subtipo: "diseñar",
      });

      return res.status(201).json(historia);
    }

    if (["carrusel", "video"].includes(tipo)) {
      const result = await pool.query(
        `INSERT INTO publicaciones (cliente_id, tipo, estado, fecha_programada, responsable, responsable_diseño, idea, copy, material_referencia, aclaraciones, prioridad)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)
         RETURNING 'publicacion' AS origen, id, tipo, cliente_id, estado, fecha_programada, responsable, idea, copy, material_referencia, aclaraciones, prioridad, created_at, updated_at`,
        [
          cliente_id,
          tipo,
          estado || "pendiente",
          fecha_programada,
          responsable,
          idea || "",
          copy || "",
          material_referencia || "",
          aclaraciones || "",
          prioridad || "media",
        ],
      );
      const publicacion = result.rows[0];

      if (tipo === "carrusel") {
        // Carruseles/flyers: diseño de Augusto, sin filmación ni edición.
        await crearTareaAuto({
          titulo: `Diseñar assets - ${idea || "sin idea"}`,
          asignado_a: "Augusto",
          cliente_id,
          fecha_vencimiento: fechaVencimientoTarea(fecha_programada, 1),
          publicacion_id: publicacion.id,
          tipo_tarea: "diseno",
          subtipo: "diseñar",
        });
      } else {
        // Video: Germán filma (solo clientes confirmados) y Luciano edita.
        // Augusto no interviene acá — diseño de video no existe como paso.
        const { rows: clienteRows } = await pool.query(
          "SELECT nombre FROM clientes WHERE id = $1",
          [cliente_id],
        );
        const nombreCliente = clienteRows[0]?.nombre;

        if (nombreCliente && CLIENTES_PRODUCCION_GERMAN.includes(nombreCliente)) {
          await crearTareaAuto({
            titulo: `Filmar video - ${idea || "sin idea"}`,
            asignado_a: "Germán",
            cliente_id,
            fecha_vencimiento: fechaVencimientoTarea(fecha_programada, 3),
            publicacion_id: publicacion.id,
            tipo_tarea: "produccion",
            subtipo: "filmar",
          });

          await crearTareaAuto({
            titulo: `Editar video - ${idea || "sin idea"}`,
            asignado_a: "Luciano",
            cliente_id,
            fecha_vencimiento: fechaVencimientoTarea(fecha_programada, 1),
            publicacion_id: publicacion.id,
            tipo_tarea: "edicion",
            subtipo: "editar",
          });
        }
        // Si el cliente no tiene productor asignado todavía, no se generan
        // tareas automáticas — evita que Luciano reciba una edición sin
        // material filmado por alguien.
      }

      return res.status(201).json(publicacion);
    }

    res.status(400).json({
      error: "Tipo de pieza inválido. Usa: historia, carrusel, video",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/historias/convertir-flyer/:publicacionId", async (req, res, next) => {
  try {
    const { publicacionId } = req.params;

    const origen = await pool.query(
      `SELECT * FROM publicaciones WHERE id = $1 AND tipo = 'flyer'`,
      [publicacionId],
    );

    if (origen.rows.length === 0) {
      return res.status(404).json({ error: "Flyer no encontrado en publicaciones." });
    }

    const p = origen.rows[0];

    const result = await pool.query(
      `INSERT INTO historias (cliente_id, estado, fecha_programada, responsable, responsable_diseño, idea, copy, material_referencia, aclaraciones, prioridad, metadata)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, cliente_id, estado, to_char(fecha_programada, 'YYYY-MM-DD') AS fecha_programada, idea, copy, material_referencia, aclaraciones, prioridad, created_at`,
      [
        p.cliente_id,
        p.estado === "publicada" ? "publicada" : "en_diseño",
        p.fecha_programada,
        p.responsable,
        p.idea,
        p.copy,
        p.material_referencia,
        p.aclaraciones,
        p.prioridad,
        JSON.stringify({ ...(p.metadata || {}), migrada_desde_flyer_id: p.id }),
      ],
    );

    await pool.query("DELETE FROM publicaciones WHERE id = $1", [publicacionId]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/piezas/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, prioridad, idea, copy, material_referencia, aclaraciones } =
      req.body;

    const estadosValidos = [
      "pendiente",
      "en_diseño",
      "en_edición",
      "en_revisión",
      "lista",
      "publicada",
      "bloqueada",
    ];

    if (estado && !estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }

    let resultP = await pool.query(
      `UPDATE publicaciones
       SET
         estado = COALESCE($1, estado),
         prioridad = COALESCE($2, prioridad),
         idea = COALESCE($3, idea),
         copy = COALESCE($4, copy),
         material_referencia = COALESCE($5, material_referencia),
         aclaraciones = COALESCE($6, aclaraciones),
         updated_at = now()
       WHERE id = $7
       RETURNING 'publicacion' AS origen, id, tipo, estado, cliente_id, responsable, prioridad, idea, copy, material_referencia, aclaraciones, updated_at`,
      [
        estado || null,
        prioridad || null,
        idea || null,
        copy || null,
        material_referencia || null,
        aclaraciones || null,
        id,
      ],
    );

    if (resultP.rows.length > 0) {
      return res.json(resultP.rows[0]);
    }

    let resultH = await pool.query(
      `UPDATE historias
       SET
         estado = COALESCE($1, estado),
         prioridad = COALESCE($2, prioridad),
         idea = COALESCE($3, idea),
         copy = COALESCE($4, copy),
         material_referencia = COALESCE($5, material_referencia),
         aclaraciones = COALESCE($6, aclaraciones),
         updated_at = now()
       WHERE id = $7
       RETURNING 'historia' AS origen, id, 'historia' AS tipo, estado, cliente_id, responsable, prioridad, idea, copy, material_referencia, aclaraciones, updated_at`,
      [
        estado || null,
        prioridad || null,
        idea || null,
        copy || null,
        material_referencia || null,
        aclaraciones || null,
        id,
      ],
    );

    if (resultH.rows.length === 0) {
      return res.status(404).json({ error: "Pieza no encontrada." });
    }

    res.json(resultH.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.use("/api", router);

// Si existe un build del frontend (frontend/dist, generado con
// `npm run build`), lo servimos desde acá mismo. Así todo — API y
// frontend — vive en un solo proceso y un solo puerto: no hace falta
// CORS ni coordinar dos servicios separados en el hosting.
//
// En desarrollo local esta carpeta normalmente no existe (se usa
// `vite dev` con su propio proxy hacia /api), así que esto no cambia
// nada del flujo de trabajo habitual.
const distDir = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
  console.log("Sirviendo frontend estático desde", distDir);
}

// Error handler centralizado: sin esto, Express devuelve HTML/stack
// traces por defecto en vez de JSON — riesgo de filtrar detalles internos.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Error interno del servidor." });
});

try {
  await checkDatabaseConnection();
  await setupDemoClientes();
  console.log("Postgres connection OK");
} catch (error) {
  console.error("Postgres connection failed");
  console.error(error.message);
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
