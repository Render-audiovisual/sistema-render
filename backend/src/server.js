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
      `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, created_at, updated_at`,
      [
        titulo,
        asignado_a,
        cliente_id || null,
        estadoFinal,
        Boolean(requiere_aprobacion),
        JSON.stringify(propiedadesExtra),
        fecha_vencimiento || null,
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
    const { estado, propiedades_extra } = req.body;

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
         propiedades_extra = CASE
           WHEN $2::jsonb IS NOT NULL THEN propiedades_extra || $2::jsonb
           ELSE propiedades_extra
         END,
         updated_at = now()
       WHERE id = $3
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, created_at, updated_at`,
      [
        estado || null,
        propiedades_extra ? JSON.stringify(propiedades_extra) : null,
        id,
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

app.get("/tareas", async (_req, res, next) => {
  try {
    const result = await pool.query(`
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
        t.created_at,
        t.updated_at
      FROM tareas t
      LEFT JOIN clientes c ON c.id = t.cliente_id
      ORDER BY t.id
    `);
    res.json(result.rows);
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
