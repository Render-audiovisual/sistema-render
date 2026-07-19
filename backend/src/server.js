import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { checkDatabaseConnection, pool } from "./db.js";
import { setupDemoClientes } from "./setup-demo-data.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/login", async (req, res, next) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan usuario o contraseña." });
    }

    const result = await pool.query(
      "SELECT id, usuario, nombre, rol, password_hash FROM usuarios WHERE usuario = $1",
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

app.get("/usuarios", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, usuario, nombre, rol, created_at FROM usuarios ORDER BY id",
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/usuarios", async (req, res, next) => {
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
       RETURNING id, usuario, nombre, rol, created_at`,
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

app.delete("/usuarios/:id", async (req, res, next) => {
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

app.patch("/usuarios/password", async (req, res, next) => {
  try {
    const { usuario, password_actual, password_nueva } = req.body;

    if (!usuario || !password_actual || !password_nueva) {
      return res
        .status(400)
        .json({ error: "Faltan la contraseña actual y la nueva." });
    }

    const found = await pool.query(
      "SELECT id, password_hash FROM usuarios WHERE usuario = $1",
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

// ── WORKFLOW DE HISTORIAS ────────────────────────────────────────────────────

app.get("/workflow-historias", async (req, res, next) => {
  try {
    const { fase, cliente_id } = req.query;

    let query = `
      SELECT
        w.id,
        w.historia_id,
        w.cliente_id,
        c.nombre AS cliente_nombre,
        w.tema,
        w.descripcion,
        w.fase,
        w.responsable_planificacion,
        w.responsable_diseño,
        w.responsable_revisión,
        w.fecha_programada,
        w.fecha_entrega_diseño,
        w.fecha_revisión,
        w.fecha_publicación,
        w.link_diseño,
        w.notas,
        w.created_at,
        w.updated_at
      FROM workflow_historia w
      JOIN clientes c ON c.id = w.cliente_id
      WHERE 1=1
    `;
    const params = [];

    if (fase) {
      query += ` AND w.fase = $${params.length + 1}`;
      params.push(fase);
    }

    if (cliente_id) {
      query += ` AND w.cliente_id = $${params.length + 1}`;
      params.push(cliente_id);
    }

    query += ` ORDER BY w.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/workflow-historias", async (req, res, next) => {
  try {
    const { historia_id, cliente_id, tema, descripcion, fecha_programada, responsable_planificacion } = req.body;

    if (!historia_id || !cliente_id) {
      return res.status(400).json({ error: "Faltan historia_id o cliente_id." });
    }

    const result = await pool.query(
      `INSERT INTO workflow_historia (historia_id, cliente_id, tema, descripcion, fecha_programada, responsable_planificacion)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [historia_id, cliente_id, tema || null, descripcion || null, fecha_programada || null, responsable_planificacion || null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/workflow-historias/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fase, responsable_diseño, responsable_revisión, link_diseño, fecha_entrega_diseño, fecha_revisión, fecha_publicación, notas } = req.body;

    const fasesValidas = ["planificado", "en_diseño", "en_revisión", "publicado"];
    if (fase && !fasesValidas.includes(fase)) {
      return res.status(400).json({ error: "Fase inválida." });
    }

    const result = await pool.query(
      `UPDATE workflow_historia
       SET
         fase = COALESCE($1, fase),
         responsable_diseño = COALESCE($2, responsable_diseño),
         responsable_revisión = COALESCE($3, responsable_revisión),
         link_diseño = COALESCE($4, link_diseño),
         fecha_entrega_diseño = COALESCE($5, fecha_entrega_diseño),
         fecha_revisión = COALESCE($6, fecha_revisión),
         fecha_publicación = COALESCE($7, fecha_publicación),
         notas = COALESCE($8, notas),
         updated_at = now()
       WHERE id = $9
       RETURNING *`,
      [fase || null, responsable_diseño || null, responsable_revisión || null, link_diseño || null, fecha_entrega_diseño || null, fecha_revisión || null, fecha_publicación || null, notas || null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Workflow no encontrado." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/reportes/historias", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        fase,
        COUNT(*) as total,
        COUNT(CASE WHEN DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as esta_semana,
        COUNT(CASE WHEN DATE(updated_at) = CURRENT_DATE THEN 1 END) as hoy
      FROM workflow_historia
      GROUP BY fase
    `);

    const porCliente = await pool.query(`
      SELECT
        c.nombre as cliente,
        COUNT(*) as total,
        COUNT(CASE WHEN w.fase = 'publicado' THEN 1 END) as publicadas,
        COUNT(CASE WHEN w.fase IN ('planificado', 'en_diseño', 'en_revisión') THEN 1 END) as pendientes
      FROM workflow_historia w
      JOIN clientes c ON c.id = w.cliente_id
      GROUP BY c.nombre
      ORDER BY total DESC
    `);

    res.json({
      por_fase: result.rows,
      por_cliente: porCliente.rows,
    });
  } catch (error) {
    next(error);
  }
});

// ── ESTRUCTURA BASE POR CLIENTE ──────────────────────────────────────────────

app.get("/estructura", async (_req, res, next) => {
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

app.post("/estructura", async (req, res, next) => {
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

app.get("/check-publicacion", async (req, res, next) => {
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

app.post("/check-publicacion", async (req, res, next) => {
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

app.get("/fechas-especiales", async (_req, res, next) => {
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

app.patch("/fechas-especiales/:id", async (req, res, next) => {
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

app.get("/clientes", async (_req, res, next) => {
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

app.patch("/clientes/:id", async (req, res, next) => {
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

app.patch("/historias/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, metadata } = req.body;

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
         metadata = CASE WHEN $2::jsonb IS NOT NULL THEN metadata || $2::jsonb ELSE metadata END,
         updated_at = now()
       WHERE id = $3
       RETURNING id, cliente_id, estado, to_char(fecha_programada, 'YYYY-MM-DD') AS fecha_programada, responsable, metadata, created_at, updated_at`,
      [estado || null, metadata ? JSON.stringify(metadata) : null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/historias", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        h.id,
        h.cliente_id,
        c.nombre AS cliente_nombre,
        h.estado,
        to_char(h.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        h.responsable,
        h.metadata,
        h.created_at,
        h.updated_at
      FROM historias h
      JOIN clientes c ON c.id = h.cliente_id
      ORDER BY h.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.patch("/publicaciones/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, metadata } = req.body;

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
      `UPDATE publicaciones
       SET
         estado = COALESCE($1, estado),
         metadata = CASE WHEN $2::jsonb IS NOT NULL THEN metadata || $2::jsonb ELSE metadata END,
         updated_at = now()
       WHERE id = $3
       RETURNING id, cliente_id, tipo, estado, to_char(fecha_programada, 'YYYY-MM-DD') AS fecha_programada, responsable, metadata, created_at, updated_at`,
      [estado || null, metadata ? JSON.stringify(metadata) : null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicación no encontrada." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/publicaciones", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.cliente_id,
        c.nombre AS cliente_nombre,
        p.tipo,
        p.estado,
        to_char(p.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        p.responsable,
        p.metadata,
        p.created_at,
        p.updated_at
      FROM publicaciones p
      JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/tareas", async (req, res, next) => {
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

app.patch("/tareas/:id", async (req, res, next) => {
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

app.get("/tareas", async (req, res, next) => {
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

app.get("/piezas", async (_req, res, next) => {
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

app.get("/piezas/:id", async (req, res, next) => {
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

app.post("/piezas", async (req, res, next) => {
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
        `INSERT INTO historias (cliente_id, estado, fecha_programada, responsable, idea, copy, material_referencia, aclaraciones, prioridad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      return res.status(201).json(result.rows[0]);
    }

    if (["reel", "carrusel", "flyer", "video"].includes(tipo)) {
      const result = await pool.query(
        `INSERT INTO publicaciones (cliente_id, tipo, estado, fecha_programada, responsable, idea, copy, material_referencia, aclaraciones, prioridad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      return res.status(201).json(result.rows[0]);
    }

    res.status(400).json({
      error: "Tipo de pieza inválido. Usa: historia, reel, carrusel, flyer, video",
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/piezas/:id", async (req, res, next) => {
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
