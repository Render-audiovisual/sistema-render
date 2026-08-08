import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { checkDatabaseConnection, pool } from "./db.js";
import {
  enviarInstruccionesAcceso,
  normalizarNombre,
  notificarAsignacionSinInterrumpir,
} from "./email-notifications.js";
import { setupDemoClientes } from "./setup-demo-data.js";
import { shouldSetupDemoData } from "./hosting-config.js";
import { requireAuthentication, requireRole } from "./auth.js";
import { buildTaskAccessClause, buildTaskReadAccessClause, canEmployeePatchTask, getTaskActor } from "./task-access.js";
import { buildAutoTaskProperties, completeLinkedAutoTasks } from "./piece-task-linking.js";
import { calculateSalaryDashboard, isValidSalaryPeriod } from "./salary-calculation.js";
import { createWilsonRouter } from "./wilson-integration.js";
import { runMigrations } from "./migrations.js";
import { resolveUserRole } from "./user-roles.js";
import { canRecordProduction, getProductionProgress, isProductionVisitTask, isValidProductionDate } from "./production-visits.js";
import { getTaskSearchTerms } from "./task-search.js";
import { filterReportDataForUser } from "./report-access.js";
import { createGoogleDrivePublicRouter, createGoogleDriveRouter } from "./google-drive.js";
import {
  getStateNotification,
  isTaskLeader,
  isVideoEditingTask,
  validateProductionHandoff,
} from "./task-workflow.js";

// Render no siempre tiene salida IPv6 completa, y Node por defecto prefiere
// IPv6 si el DNS lo resuelve (típico con smtp.gmail.com) — eso hacía fallar
// la conexión SMTP con ENETUNREACH antes de llegar a autenticar. Esto fuerza
// IPv4 en TODAS las resoluciones DNS del proceso, no solo en nodemailer
// (pasar family:4 al transporter no alcanzaba: no llegaba hasta el socket).
dns.setDefaultResultOrder("ipv4first");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
const router = express.Router();
const port = Number(process.env.PORT || 3000);

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

app.use(compression());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Permite llamar a esta API desde un frontend alojado en otro dominio
// (por ejemplo una copia estática en Hostinger). No hay cookies ni
// credenciales de sesión involucradas (el JWT viaja en el body/localStorage,
// no en una cookie), así que un origen abierto no expone nada nuevo.
router.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
// Express 5 / path-to-regexp ya no acepta "*" como patrón de ruta.
// Resolver el preflight como middleware evita depender de esa sintaxis y
// mantiene OPTIONS público antes del middleware JWT.
router.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.use("/integraciones/wilson", createWilsonRouter({
  pool,
  notifyAssignment: notificarAsignacionSinInterrumpir,
}));

router.post("/login", async (req, res, next) => {
  try {
    const identificador = typeof req.body.usuario === "string" ? req.body.usuario.trim() : "";
    const { password } = req.body;

    if (!identificador || !password) {
      return res.status(400).json({ error: "Faltan usuario o contraseña." });
    }

    const result = await pool.query(
      `SELECT id, usuario, nombre, rol, foto_perfil, password_hash
       FROM usuarios
       WHERE lower(usuario) = lower($1)
          OR lower(google_email) = lower($1)
          OR lower(email_notificaciones) = lower($1)
       LIMIT 2`,
      [identificador],
    );

    if (result.rows.length !== 1) {
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

router.post("/login/google", async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: "Falta el token de Google." });
    }
    if (!googleClient) {
      return res
        .status(500)
        .json({ error: "El login con Google no está configurado en el servidor." });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: "Token de Google inválido o vencido." });
    }

    if (!payload?.email_verified) {
      return res
        .status(401)
        .json({ error: "Tu cuenta de Google no tiene el email verificado." });
    }

    const porGoogleId = await pool.query(
      "SELECT id, usuario, nombre, rol, foto_perfil FROM usuarios WHERE google_id = $1",
      [payload.sub],
    );
    let usuarioDB = porGoogleId.rows[0] || null;

    if (!usuarioDB) {
      const porEmail = await pool.query(
        "SELECT id, usuario, nombre, rol, foto_perfil FROM usuarios WHERE lower(google_email) = lower($1)",
        [payload.email],
      );
      usuarioDB = porEmail.rows[0] || null;

      if (usuarioDB) {
        // Primer login con Google de esta persona: guardamos el google_id
        // para no depender solo del email en los próximos logins (el email
        // de Google podría cambiar, el sub no).
        await pool.query("UPDATE usuarios SET google_id = $1 WHERE id = $2", [
          payload.sub,
          usuarioDB.id,
        ]);
      }
    }

    if (!usuarioDB) {
      return res.status(403).json({
        error:
          "Tu cuenta de Google no está vinculada a ningún usuario de Render. Pedile al líder que te vincule.",
      });
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

// El callback de Google vuelve sin el JWT del navegador. El parámetro state
// está firmado, vence en diez minutos y limita la conexión a un Líder.
router.use("/drive", createGoogleDrivePublicRouter({ express, pool }));

router.use(requireAuthentication);

router.use("/drive", createGoogleDriveRouter({ express, pool, requireRole }));

router.get("/notas", async (req, res, next) => {
  try {
    const papelera = req.query.papelera === "true";
    const busqueda = String(req.query.q || "").trim();
    const params = [];
    let where = papelera ? "eliminado_at IS NOT NULL" : "eliminado_at IS NULL";
    if (busqueda) {
      params.push(`%${busqueda}%`);
      where += ` AND (titulo ILIKE $${params.length} OR contenido ILIKE $${params.length})`;
    }
    const result = await pool.query(
      `SELECT id,titulo,contenido,creado_por,modificado_por,eliminado_at,created_at,updated_at
       FROM notas_compartidas WHERE ${where}
       ORDER BY updated_at DESC,id DESC LIMIT 500`,
      params,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.post("/notas", async (req, res, next) => {
  try {
    const actor = getTaskActor(req.auth);
    const titulo = String(req.body?.titulo || "Nueva nota").trim() || "Nueva nota";
    const contenido = String(req.body?.contenido || "");
    const result = await pool.query(
      `INSERT INTO notas_compartidas (titulo,contenido,creado_por,modificado_por)
       VALUES ($1,$2,$3,$3)
       RETURNING id,titulo,contenido,creado_por,modificado_por,eliminado_at,created_at,updated_at`,
      [titulo, contenido, actor],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.patch("/notas/:id", async (req, res, next) => {
  try {
    const actor = getTaskActor(req.auth);
    const sets = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "titulo")) {
      params.push(String(req.body.titulo || "").trim() || "Nueva nota");
      sets.push(`titulo=$${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "contenido")) {
      params.push(String(req.body.contenido || ""));
      sets.push(`contenido=$${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "No se enviaron cambios." });
    params.push(actor);
    sets.push(`modificado_por=$${params.length}`, "updated_at=now()");
    params.push(req.params.id);
    let where = `id=$${params.length} AND eliminado_at IS NULL`;
    if (req.body.expected_updated_at) {
      params.push(req.body.expected_updated_at);
      where += ` AND date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$${params.length}::timestamptz)`;
    }
    const result = await pool.query(
      `UPDATE notas_compartidas SET ${sets.join(",")} WHERE ${where}
       RETURNING id,titulo,contenido,creado_por,modificado_por,eliminado_at,created_at,updated_at`,
      params,
    );
    if (!result.rows[0]) {
      const exists = await pool.query("SELECT id FROM notas_compartidas WHERE id=$1 AND eliminado_at IS NULL", [req.params.id]);
      if (exists.rows[0] && req.body.expected_updated_at) {
        return res.status(409).json({ error: "Otra persona modificó esta nota. Conservamos tu texto para que puedas revisarlo." });
      }
      return res.status(404).json({ error: "Nota no encontrada." });
    }
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.delete("/notas/:id", async (req, res, next) => {
  try {
    if (req.query.permanente === "true") {
      const result = await pool.query("DELETE FROM notas_compartidas WHERE id=$1 AND eliminado_at IS NOT NULL RETURNING id", [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: "Nota no encontrada en la Papelera." });
      return res.json({ ok: true });
    }
    const actor = getTaskActor(req.auth);
    const result = await pool.query(
      `UPDATE notas_compartidas SET eliminado_at=now(),modificado_por=$2,updated_at=now()
       WHERE id=$1 AND eliminado_at IS NULL RETURNING id`,
      [req.params.id, actor],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Nota no encontrada." });
    return res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post("/notas/:id/restaurar", async (req, res, next) => {
  try {
    const actor = getTaskActor(req.auth);
    const result = await pool.query(
      `UPDATE notas_compartidas SET eliminado_at=NULL,modificado_por=$2,updated_at=now()
       WHERE id=$1 AND eliminado_at IS NOT NULL
       RETURNING id,titulo,contenido,creado_por,modificado_por,eliminado_at,created_at,updated_at`,
      [req.params.id, actor],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Nota no encontrada en la Papelera." });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.get("/usuarios", async (req, res, next) => {
  try {
    const fields = req.auth.rol === "admin"
      ? "id, usuario, nombre, rol, email_notificaciones, google_email, foto_perfil, created_at"
      : "id, usuario, nombre, rol, foto_perfil, created_at";
    const result = await pool.query(`SELECT ${fields} FROM usuarios ORDER BY id`);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/reportes/datos", async (req, res, next) => {
  try {
    const [tareas, historias, publicaciones, clientes, usuarios, tareasRenderOs] = await Promise.all([
      pool.query(`SELECT t.id,t.titulo,t.asignado_a,t.estado,t.propiedades_extra,
        to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,t.tipo_tarea,
        t.created_at,t.updated_at,c.nombre AS cliente_nombre
        FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
        WHERE t.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'`),
      pool.query(`SELECT id,cliente_id,estado,to_char(fecha_programada,'YYYY-MM-DD') AS fecha_programada,
        responsable,responsable_diseño FROM historias
        WHERE metadata->>'archivado_tablero' IS DISTINCT FROM 'true'`),
      pool.query(`SELECT id,cliente_id,tipo,estado,to_char(fecha_programada,'YYYY-MM-DD') AS fecha_programada,
        responsable,responsable_diseño FROM publicaciones
        WHERE metadata->>'archivado_tablero' IS DISTINCT FROM 'true'`),
      pool.query(`SELECT c.id,c.nombre,c.cuota_carruseles,c.grupo_feed_id,
        gf.cuota_carruseles AS cuota_feed_carruseles
        FROM clientes c LEFT JOIN grupos_feed gf ON gf.id=c.grupo_feed_id
        ORDER BY c.nombre`),
      pool.query(`SELECT id,usuario,nombre,rol FROM usuarios ORDER BY id`),
      pool.query(`SELECT t.id,t.titulo,t.asignado_a,t.estado,t.propiedades_extra,
        to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,t.tipo_tarea,
        t.created_at,t.updated_at,c.nombre AS cliente_nombre
        FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
        WHERE t.propiedades_extra->>'workspace'='render_os'`),
    ]);
    res.json(filterReportDataForUser({
      tareas: tareas.rows,
      historias: historias.rows,
      publicaciones: publicaciones.rows,
      clientes: clientes.rows,
      usuarios: usuarios.rows,
      tareasRenderOs: tareasRenderOs.rows,
    }, req.auth));
  } catch (error) {
    next(error);
  }
});

router.get("/sueldos", requireRole("admin"), async (req, res, next) => {
  try {
    const period = String(req.query.periodo || "");
    if (!isValidSalaryPeriod(period)) {
      return res.status(400).json({ error: "Usá un período válido con formato YYYY-MM." });
    }
    const [tasksResult, historiesResult, publicationsResult] = await Promise.all([
      pool.query(`
        SELECT t.id, t.titulo, t.asignado_a, t.estado, t.tipo_tarea, t.subtipo,
               to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
               t.propiedades_extra, t.created_at, t.updated_at, c.nombre AS cliente_nombre
        FROM tareas t
        LEFT JOIN clientes c ON c.id = t.cliente_id
        WHERE t.propiedades_extra->>'workspace' = 'render_os'
          AND (to_char(t.fecha_vencimiento, 'YYYY-MM') = $1
            OR t.propiedades_extra->>'reporte_periodo' = $1
            OR (t.fecha_vencimiento IS NULL AND to_char(t.updated_at, 'YYYY-MM') = $1))
      `, [period]),
      pool.query(`
        SELECT h.id, h.estado, to_char(h.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
               h.idea, h.copy, h.fecha_publicación_real, h.updated_at, c.nombre AS cliente_nombre
        FROM historias h JOIN clientes c ON c.id = h.cliente_id
        WHERE to_char(h.fecha_programada, 'YYYY-MM') = $1
          AND h.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
      `, [period]),
      pool.query(`
        SELECT p.id, p.tipo, p.estado, to_char(p.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
               p.idea, p.copy, p.fecha_publicación_real, p.updated_at, c.nombre AS cliente_nombre
        FROM publicaciones p JOIN clientes c ON c.id = p.cliente_id
        WHERE to_char(p.fecha_programada, 'YYYY-MM') = $1
          AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
      `, [period]),
    ]);
    res.json(calculateSalaryDashboard({
      period,
      tasks: tasksResult.rows,
      histories: historiesResult.rows,
      publications: publicationsResult.rows,
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/usuarios", requireRole("admin"), async (req, res, next) => {
  try {
    const { usuario, nombre, rol, password, email_notificaciones } = req.body;
    const rolNormalizado = resolveUserRole(rol);
    const email = normalizarEmailNotificaciones(email_notificaciones);

    if (!usuario || !nombre || !rol || !password) {
      return res.status(400).json({ error: "Faltan datos del empleado." });
    }
    if (!rolNormalizado) {
      return res.status(400).json({ error: "La categoría laboral no es válida." });
    }
    if (email_notificaciones && !email) {
      return res.status(400).json({ error: "El correo para notificaciones no es válido." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (usuario, nombre, rol, password_hash, email_notificaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, usuario, nombre, rol, email_notificaciones, foto_perfil, created_at`,
      [usuario, nombre, rolNormalizado, passwordHash, email],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "Ya existe ese usuario o correo para notificaciones." });
    }
    next(error);
  }
});

function normalizarEmailNotificaciones(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

router.patch("/usuarios/:id/email-notificaciones", requireRole("admin"), async (req, res, next) => {
  try {
    const emailIngresado =
      typeof req.body.email_notificaciones === "string"
        ? req.body.email_notificaciones.trim()
        : "";
    const email = normalizarEmailNotificaciones(emailIngresado);

    if (emailIngresado && !email) {
      return res.status(400).json({ error: "El correo para notificaciones no es válido." });
    }

    const updated = await pool.query(
      `UPDATE usuarios
       SET email_notificaciones = $1
       WHERE id = $2
       RETURNING id, usuario, nombre, rol, email_notificaciones, foto_perfil, created_at`,
      [email, req.params.id],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ese correo ya está asignado a otra persona." });
    }
    next(error);
  }
});

router.patch("/usuarios/:id/google-email", requireRole("admin"), async (req, res, next) => {
  try {
    const emailIngresado =
      typeof req.body.google_email === "string" ? req.body.google_email.trim() : "";
    const email = normalizarEmailNotificaciones(emailIngresado);

    if (emailIngresado && !email) {
      return res.status(400).json({ error: "El email de Google no es válido." });
    }

    // Cambiar el email vinculado fuerza a re-vincular el google_id en el
    // próximo login — evita que quede un google_id viejo apuntando a una
    // cuenta de Google que ya no corresponde.
    const updated = await pool.query(
      `UPDATE usuarios
       SET google_email = $1, google_id = NULL
       WHERE id = $2
       RETURNING id, usuario, nombre, rol, google_email, foto_perfil, created_at`,
      [email, req.params.id],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ese email de Google ya está asignado a otra persona." });
    }
    next(error);
  }
});

router.post("/usuarios/:id/invitacion", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, usuario, nombre, rol, email_notificaciones, google_email
       FROM usuarios WHERE id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const delivery = await enviarInstruccionesAcceso({ usuario: result.rows[0] });
    if (!delivery.enviado) {
      const messages = {
        correo_no_configurado: "El servidor de correo no está configurado.",
        usuario_sin_correo: "El usuario no tiene correo de notificaciones.",
      };
      return res.status(409).json({ error: messages[delivery.razon] || "No se pudo enviar la invitación." });
    }
    return res.json({ ok: true, destinatario: delivery.destinatario });
  } catch (error) {
    return next(error);
  }
});

router.delete("/usuarios/:id", requireRole("admin"), async (req, res, next) => {
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
    if (String(req.auth.usuario).toLowerCase() !== String(usuario_actual).toLowerCase()) {
      return res.status(403).json({ error: "No podés modificar otro usuario." });
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
    if (String(req.auth.usuario).toLowerCase() !== String(usuario).toLowerCase()) {
      return res.status(403).json({ error: "No podés modificar otro usuario." });
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
    if (String(req.auth.usuario).toLowerCase() !== String(usuario).toLowerCase()) {
      return res.status(403).json({ error: "No podés modificar otro usuario." });
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

router.patch("/usuarios/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const nombre = typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";
    const usuario = typeof req.body.usuario === "string" ? req.body.usuario.trim() : "";
    const { rol } = req.body;
    const rolNormalizado = resolveUserRole(rol);

    if (!nombre || !usuario || !rolNormalizado) {
      return res.status(400).json({ error: "Los datos del empleado no son válidos." });
    }

    const updated = await pool.query(
      `UPDATE usuarios
       SET nombre = $1, usuario = $2, rol = $3
       WHERE id = $4
       RETURNING id, usuario, nombre, rol, email_notificaciones, google_email, foto_perfil, created_at`,
      [nombre, usuario, rolNormalizado, req.params.id],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe ese usuario." });
    }
    return next(error);
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

router.post("/estructura", requireRole("admin"), async (req, res, next) => {
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

router.post("/check-publicacion", requireRole("admin"), async (req, res, next) => {
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

router.patch("/fechas-especiales/:id", requireRole("admin"), async (req, res, next) => {
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
      SELECT
        c.id,
        c.nombre,
        c.cuota_reels,
        c.cuota_carruseles,
        c.grupo_feed_id,
        gf.nombre AS grupo_feed_nombre,
        gf.cuota_reels AS cuota_feed_reels,
        gf.cuota_carruseles AS cuota_feed_carruseles,
        (gf.cuota_reels + gf.cuota_carruseles) AS cuota_feed_compartida
      FROM clientes c
      LEFT JOIN grupos_feed gf ON gf.id = c.grupo_feed_id
      ORDER BY c.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/clientes", requireRole("admin"), async (req, res, next) => {
  try {
    const nombre = (req.body.nombre || "").trim();
    const cuota_reels = Number(req.body.cuota_reels ?? 0);
    const cuota_carruseles = Number(req.body.cuota_carruseles ?? 0);

    if (!nombre) {
      return res.status(400).json({ error: "Falta el nombre del cliente." });
    }
    if (
      !Number.isInteger(cuota_reels) ||
      !Number.isInteger(cuota_carruseles) ||
      cuota_reels < 0 ||
      cuota_carruseles < 0
    ) {
      return res.status(400).json({
        error: "cuota_reels y cuota_carruseles deben ser enteros ≥ 0.",
      });
    }

    const result = await pool.query(
      `INSERT INTO clientes (nombre, cuota_reels, cuota_carruseles)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, cuota_reels, cuota_carruseles`,
      [nombre, cuota_reels, cuota_carruseles],
    );

    res.status(201).json({
      ...result.rows[0],
      grupo_feed_id: null,
      grupo_feed_nombre: null,
      cuota_feed_reels: null,
      cuota_feed_carruseles: null,
      cuota_feed_compartida: null,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe un cliente con ese nombre." });
    }
    next(error);
  }
});

router.patch("/clientes/:id", requireRole("admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      nombre,
      cuota_reels,
      cuota_carruseles,
      cuota_feed_reels,
      cuota_feed_carruseles,
    } = req.body;
    const nombreNormalizado = nombre === undefined ? undefined : String(nombre).trim();

    const cuotaReelsValida =
      cuota_reels === undefined ||
      (Number.isInteger(cuota_reels) && cuota_reels >= 0);
    const cuotaCarruselesValida =
      cuota_carruseles === undefined ||
      (Number.isInteger(cuota_carruseles) && cuota_carruseles >= 0);
    const cuotaFeedReelsValida =
      cuota_feed_reels === undefined ||
      (Number.isInteger(cuota_feed_reels) && cuota_feed_reels >= 0);
    const cuotaFeedCarruselesValida =
      cuota_feed_carruseles === undefined ||
      (Number.isInteger(cuota_feed_carruseles) && cuota_feed_carruseles >= 0);

    if (
      !cuotaReelsValida ||
      !cuotaCarruselesValida ||
      !cuotaFeedReelsValida ||
      !cuotaFeedCarruselesValida
    ) {
      return res.status(400).json({
        error: "Las cuotas deben ser enteros ≥ 0.",
      });
    }
    if (nombreNormalizado !== undefined && !nombreNormalizado) {
      return res.status(400).json({ error: "El nombre del cliente no puede quedar vacío." });
    }

    await client.query("BEGIN");
    const existente = await client.query(
      "SELECT grupo_feed_id FROM clientes WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (existente.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    const grupoFeedId = existente.rows[0].grupo_feed_id;
    const actualizaCuotaFeed =
      cuota_feed_reels !== undefined || cuota_feed_carruseles !== undefined;
    if (actualizaCuotaFeed && !grupoFeedId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Este cliente no tiene una cuota de feed compartida." });
    }
    if (actualizaCuotaFeed) {
      await client.query(
        `UPDATE grupos_feed
         SET
           cuota_reels = COALESCE($1, cuota_reels),
           cuota_carruseles = COALESCE($2, cuota_carruseles),
           cuota_mensual =
             COALESCE($1, cuota_reels) + COALESCE($2, cuota_carruseles)
         WHERE id = $3`,
        [cuota_feed_reels ?? null, cuota_feed_carruseles ?? null, grupoFeedId],
      );
    }

    await client.query(
      `UPDATE clientes
       SET
         nombre = COALESCE($1, nombre),
         cuota_reels = COALESCE($2, cuota_reels),
         cuota_carruseles = COALESCE($3, cuota_carruseles)
       WHERE id = $4`,
      [
        nombreNormalizado ?? null,
        cuota_reels ?? null,
        cuota_carruseles ?? null,
        id,
      ],
    );
    const result = await client.query(
      `SELECT
         c.id,
         c.nombre,
         c.cuota_reels,
         c.cuota_carruseles,
         c.grupo_feed_id,
         gf.nombre AS grupo_feed_nombre,
         gf.cuota_reels AS cuota_feed_reels,
         gf.cuota_carruseles AS cuota_feed_carruseles,
         (gf.cuota_reels + gf.cuota_carruseles) AS cuota_feed_compartida
       FROM clientes c
       LEFT JOIN grupos_feed gf ON gf.id = c.grupo_feed_id
       WHERE c.id = $1`,
      [id],
    );
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe un cliente con ese nombre." });
    }
    next(error);
  } finally {
    client.release();
  }
});

router.delete("/clientes/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const dependencias = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM historias WHERE cliente_id = $1) AS historias,
         (SELECT COUNT(*)::int FROM publicaciones WHERE cliente_id = $1) AS publicaciones,
         (SELECT COUNT(*)::int FROM tareas WHERE cliente_id = $1) AS tareas,
         (SELECT COUNT(*)::int FROM estructura_cliente WHERE cliente_id = $1) AS estructura,
         (SELECT COUNT(*)::int FROM check_publicacion WHERE cliente_id = $1) AS checklist`,
      [id],
    );
    const conteos = dependencias.rows[0];
    const tieneMovimiento = Object.values(conteos).some((cantidad) => cantidad > 0);

    if (tieneMovimiento) {
      return res.status(409).json({
        error: "El cliente tiene piezas, tareas o planificación asociada. No se puede eliminar desde este panel.",
        dependencias: conteos,
      });
    }

    const result = await pool.query(
      `DELETE FROM clientes
       WHERE id = $1
       RETURNING id, nombre`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    res.json({ ok: true, cliente: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.patch("/historias/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      estado,
      idea,
      copy,
      material_referencia,
      aclaraciones,
      prioridad,
      cliente_id,
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
         cliente_id = COALESCE($7, cliente_id),
         fecha_programada = COALESCE($8, fecha_programada),
         responsable = COALESCE($9, responsable),
         responsable_planificacion = COALESCE($10, responsable_planificacion),
         responsable_diseño = COALESCE($11, responsable_diseño),
         responsable_revisión = COALESCE($12, responsable_revisión),
         responsable_publicacion = COALESCE($13, responsable_publicacion),
         fecha_diseño_entrega = COALESCE($14, fecha_diseño_entrega),
         fecha_revisión_aprobación = COALESCE($15, fecha_revisión_aprobación),
         notas_planificacion = COALESCE($16, notas_planificacion),
         notas_diseño = COALESCE($17, notas_diseño),
         notas_revisión = COALESCE($18, notas_revisión),
         notas_bloqueador = COALESCE($19, notas_bloqueador),
         metadata = CASE WHEN $20::jsonb IS NOT NULL THEN metadata || $20::jsonb ELSE metadata END,
         updated_at = now()
       WHERE id = $21
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
        cliente_id || null,
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

    await completeLinkedAutoTasks(pool, { estado: result.rows[0].estado, historiaId: Number(id) });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete("/historias/:id", requireRole("admin"), async (req, res, next) => {
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
      WHERE h.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
      ORDER BY h.fecha_programada DESC, h.id
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch("/publicaciones/:id", requireRole("admin"), async (req, res, next) => {
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

    await completeLinkedAutoTasks(pool, { estado: result.rows[0].estado, publicacionId: Number(id) });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete("/publicaciones/:id", requireRole("admin"), async (req, res, next) => {
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

router.get("/publicaciones", async (req, res, next) => {
  try {
    const incluirArchivadas = req.query.incluir_archivadas === "true";
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
      WHERE $1::boolean OR p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
      ORDER BY p.fecha_programada DESC, p.id
    `, [incluirArchivadas]);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/tareas", requireRole("admin"), async (req, res, next) => {
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
      aclaraciones,
      material_referencia,
      tarea_padre_id,
      resumen,
      etiquetas,
      colaboradores,
      workspace,
      produccion_videos_previstos,
    } = req.body;

    if (!titulo || !asignado_a) {
      return res.status(400).json({ error: "Faltan título o asignado_a." });
    }
    if (tipo_tarea && !TIPOS_TAREA_VALIDOS.includes(tipo_tarea)) {
      return res.status(400).json({ error: "Sector (tipo_tarea) inválido." });
    }
    if (prioridad && !PRIORIDADES_TAREA_VALIDAS.includes(prioridad)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const estadoFinal = ESTADOS_TAREA_VALIDOS.includes(estado)
      ? estado
      : "pendiente";

    if (workspace === "render_os" && tarea_padre_id) {
      const padreRenderOS = await pool.query(
        `SELECT id FROM tareas
         WHERE id = $1
           AND propiedades_extra->>'workspace' = 'render_os'`,
        [tarea_padre_id],
      );
      if (padreRenderOS.rows.length === 0) {
        return res.status(404).json({ error: "Tarea padre no encontrada." });
      }
    }

    const propiedadesExtra = { Origen: "Cargada desde la plataforma" };
    if (escalada_a) {
      propiedadesExtra.escalada_a = escalada_a;
    }
    if (motivo) {
      propiedadesExtra.motivo = motivo;
    }
    if (resumen) {
      propiedadesExtra.resumen = String(resumen).trim();
    }
    if (Array.isArray(etiquetas)) {
      propiedadesExtra.etiquetas = etiquetas.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (Array.isArray(colaboradores)) {
      propiedadesExtra.colaboradores = colaboradores.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (workspace === "render_os") {
      propiedadesExtra.workspace = "render_os";
    }
    const nuevaTarea = { titulo, subtipo, tipo_tarea, propiedades_extra: propiedadesExtra };
    if (isProductionVisitTask(nuevaTarea)) {
      const planned = Number(produccion_videos_previstos);
      if (!Number.isInteger(planned) || planned <= 0) {
        return res.status(400).json({ error: "Una visita de producción necesita indicar cuántos videos están previstos." });
      }
      propiedadesExtra.produccion_videos_previstos = planned;
      propiedadesExtra.produccion_registros = [];
    }

    const result = await pool.query(
      `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id, created_at, updated_at`,
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
        aclaraciones || null,
        material_referencia || null,
        tarea_padre_id || null,
      ],
    );

    const tareaCreada = result.rows[0];
    res.status(201).json(tareaCreada);
    notificarAsignacionSinInterrumpir({
      pool,
      tarea: tareaCreada,
      motivo: "creada",
      actor: getTaskActor(req.auth),
    });
  } catch (error) {
    next(error);
  }
});

const ESTADOS_TAREA_VALIDOS = [
  "pendiente",
  "en_progreso",
  "en_revision",
  "programada",
  "publicada",
];
const TIPOS_TAREA_VALIDOS = [
  "diseno",
  "edicion",
  "produccion",
  "community",
  "administracion",
];
const PRIORIDADES_TAREA_VALIDAS = ["baja", "media", "alta"];

// Columnas que se pueden tocar por PATCH parcial. El SET se arma solo con
// las claves presentes en el body (no con un COALESCE fijo), para poder
// distinguir "este campo no vino" (no tocar) de "vino en null explícito"
// (ej. borrar cliente o fecha de vencimiento) — con COALESCE eso último es
// imposible de expresar, porque COALESCE(null, actual) devuelve el valor
// actual y nunca lo borra.
const TAREA_COLUMNAS_EDITABLES = [
  "titulo",
  "asignado_a",
  "cliente_id",
  "fecha_vencimiento",
  "tipo_tarea",
  "subtipo",
  "prioridad",
  "estado",
  "aclaraciones",
  "material_referencia",
  "publicacion_id",
  "tarea_padre_id",
];

async function crearTareaEdicionDesdeVisita(visita) {
  const cliente = visita.cliente_id
    ? await pool.query("SELECT nombre FROM clientes WHERE id = $1", [visita.cliente_id])
    : { rows: [] };
  const clienteNombre = cliente.rows[0]?.nombre || "Sin cliente";
  const cantidad = getProductionProgress(visita).planned;
  const propiedades = {
    workspace: "render_os",
    origen_visita_id: String(visita.id),
    automatica_render_os: true,
    resumen: `Editar los ${cantidad} videos grabados en la visita de ${clienteNombre}.`,
  };
  const indicaciones = [
    `Tarea creada automáticamente desde la visita #${visita.id}.`,
    `Cantidad esperada: ${cantidad} videos.`,
    "Revisar la carpeta completa, separar el material por pieza y pasar cada entrega a revisión.",
  ].join("\n");
  const result = await pool.query(
    `INSERT INTO tareas (
       titulo, asignado_a, cliente_id, estado, propiedades_extra, fecha_vencimiento,
       tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id
     ) VALUES ($1, 'Luciano', $2, 'pendiente', $3::jsonb, $4, 'edicion', 'video', $5, $6, $7, $8)
     ON CONFLICT ((propiedades_extra->>'origen_visita_id'))
       WHERE propiedades_extra->>'workspace' = 'render_os'
         AND propiedades_extra->>'origen_visita_id' IS NOT NULL
     DO NOTHING
     RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion,
       propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
       historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones,
       material_referencia, tarea_padre_id, created_at, updated_at`,
    [
      `${clienteNombre} | Edición de ${cantidad} video${cantidad === 1 ? "" : "s"}`,
      visita.cliente_id || null,
      JSON.stringify(propiedades),
      visita.fecha_vencimiento || null,
      visita.prioridad || "media",
      indicaciones,
      visita.material_referencia,
      visita.id,
    ],
  );
  return result.rows[0] || null;
}

router.patch("/tareas/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body;
    let asignadoAnterior = null;
    let estadoAnterior = null;
    let colaboradoresAnteriores = [];
    let tareaAnteriorCompleta = null;
    const esRenderOS = req.query.workspace === "render_os";

    if (req.auth.rol !== "admin" && !canEmployeePatchTask(body, { workspace: esRenderOS ? "render_os" : "historical", role: req.auth.rol })) {
      return res.status(403).json({ error: "Solo podés actualizar el estado de tus tareas." });
    }

    if (Object.prototype.hasOwnProperty.call(body, "estado")) {
      if (body.estado === null || !ESTADOS_TAREA_VALIDOS.includes(body.estado)) {
        return res.status(400).json({ error: "Estado inválido." });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "titulo")) {
      if (body.titulo === null || !String(body.titulo).trim()) {
        return res.status(400).json({ error: "El título no puede quedar vacío." });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "asignado_a")) {
      if (body.asignado_a === null || !String(body.asignado_a).trim()) {
        return res.status(400).json({ error: "El responsable no puede quedar vacío." });
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "asignado_a") ||
      Object.prototype.hasOwnProperty.call(body, "estado") ||
      Object.prototype.hasOwnProperty.call(body.propiedades_extra || {}, "colaboradores")
    ) {
      const tareaAnterior = await pool.query(
        `SELECT id, titulo, asignado_a, cliente_id, estado, propiedades_extra,
                to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
                tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia,
                tarea_padre_id, updated_at
         FROM tareas WHERE id = $1`,
        [id],
      );
      tareaAnteriorCompleta = tareaAnterior.rows[0] || null;
      asignadoAnterior = tareaAnterior.rows[0]?.asignado_a || null;
      estadoAnterior = tareaAnterior.rows[0]?.estado || null;
      colaboradoresAnteriores = Array.isArray(tareaAnterior.rows[0]?.propiedades_extra?.colaboradores)
        ? tareaAnterior.rows[0].propiedades_extra.colaboradores
        : [];
    }
    if (esRenderOS && body.estado === "en_revision" && estadoAnterior !== "en_revision" && tareaAnteriorCompleta) {
      const visitaParaEntregar = {
        ...tareaAnteriorCompleta,
        ...body,
        propiedades_extra: {
          ...(tareaAnteriorCompleta.propiedades_extra || {}),
          ...(body.propiedades_extra || {}),
        },
      };
      const errorEntrega = validateProductionHandoff(visitaParaEntregar);
      if (errorEntrega) return res.status(400).json({ error: errorEntrega });
    }
    if (Object.prototype.hasOwnProperty.call(body, "tipo_tarea")) {
      if (body.tipo_tarea !== null && !TIPOS_TAREA_VALIDOS.includes(body.tipo_tarea)) {
        return res.status(400).json({ error: "Sector (tipo_tarea) inválido." });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "prioridad")) {
      if (body.prioridad === null || !PRIORIDADES_TAREA_VALIDAS.includes(body.prioridad)) {
        return res.status(400).json({ error: "Prioridad inválida." });
      }
    }
    if (esRenderOS && body.estado === "publicada") {
      const visita = await pool.query(
        `SELECT titulo, subtipo, tipo_tarea, propiedades_extra
         FROM tareas
         WHERE id = $1 AND propiedades_extra->>'workspace' = 'render_os'`,
        [id],
      );
      if (visita.rows[0] && isProductionVisitTask(visita.rows[0])) {
        const progress = getProductionProgress(visita.rows[0]);
        if (progress.planned === 0 || progress.recorded < progress.planned) {
          return res.status(400).json({ error: progress.planned === 0
            ? "Indicá cuántos videos tiene la visita antes de finalizarla."
            : `Todavía faltan ${progress.remaining} videos para finalizar esta visita.` });
        }
      }
    }
    if (esRenderOS && Object.prototype.hasOwnProperty.call(body, "tarea_padre_id") && body.tarea_padre_id) {
      const padreRenderOS = await pool.query(
        `SELECT id FROM tareas
         WHERE id = $1
           AND propiedades_extra->>'workspace' = 'render_os'`,
        [body.tarea_padre_id],
      );
      if (padreRenderOS.rows.length === 0) {
        return res.status(404).json({ error: "Tarea padre no encontrada." });
      }
    }

    const sets = [];
    const valores = [];
    let i = 1;
    for (const columna of TAREA_COLUMNAS_EDITABLES) {
      if (Object.prototype.hasOwnProperty.call(body, columna)) {
        sets.push(`${columna} = $${i}`);
        valores.push(body[columna]);
        i++;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "propiedades_extra") && body.propiedades_extra) {
      sets.push(`propiedades_extra = propiedades_extra || $${i}::jsonb`);
      valores.push(JSON.stringify(esRenderOS
        ? { ...body.propiedades_extra, workspace: "render_os" }
        : body.propiedades_extra));
      i++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No se envió ningún campo para actualizar." });
    }

    sets.push("updated_at = now()");
    valores.push(id);
    const idPlaceholder = i;
    let where = `t.id = $${idPlaceholder}`;
    if (esRenderOS) {
      where += ` AND t.propiedades_extra->>'workspace' = 'render_os'`;
    }
    if (body.expected_updated_at) {
      i++;
      // node-postgres serializa Date con milisegundos, mientras PostgreSQL
      // conserva microsegundos. Comparar el timestamp crudo provoca un 409
      // falso incluso cuando nadie modificó la tarea.
      where += ` AND date_trunc('milliseconds', t.updated_at) = date_trunc('milliseconds', $${i}::timestamptz)`;
      valores.push(body.expected_updated_at);
    }

    const acceso = buildTaskAccessClause(req.auth, "t", `$${i + 1}`);
    where += acceso.sql;
    if (acceso.value) {
      i++;
      valores.push(acceso.value);
    }

    const result = await pool.query(
      `UPDATE tareas AS t SET ${sets.join(", ")}
       WHERE ${where}
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id, created_at, updated_at`,
      valores,
    );

    if (result.rows.length === 0) {
      if (body.expected_updated_at) {
        const accesoExistente = buildTaskAccessClause(req.auth, "t", "$2");
        const paramsExistente = [id];
        if (accesoExistente.value) paramsExistente.push(accesoExistente.value);
        const existente = await pool.query(
          `SELECT t.id FROM tareas AS t
           WHERE t.id = $1${esRenderOS ? " AND t.propiedades_extra->>'workspace' = 'render_os'" : ""}${accesoExistente.sql}`,
          paramsExistente,
        );
        if (existente.rows.length > 0) {
          return res.status(409).json({ error: "La tarea cambió mientras la estabas editando. Recargá y revisá la última versión." });
        }
      }
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    const tareaActualizada = result.rows[0];
    res.json(tareaActualizada);

    const actor = getTaskActor(req.auth);

    if (
      Object.prototype.hasOwnProperty.call(body, "asignado_a") &&
      normalizarNombre(asignadoAnterior) !==
        normalizarNombre(tareaActualizada.asignado_a)
    ) {
      notificarAsignacionSinInterrumpir({
        pool,
        tarea: tareaActualizada,
        motivo: "reasignada",
        actor,
      });
    }
    const colaboradoresActuales = Array.isArray(tareaActualizada.propiedades_extra?.colaboradores)
      ? tareaActualizada.propiedades_extra.colaboradores
      : [];
    const cambiaronColaboradores = Object.prototype.hasOwnProperty.call(body.propiedades_extra || {}, "colaboradores")
      && JSON.stringify(colaboradoresAnteriores.map(normalizarNombre).sort()) !== JSON.stringify(colaboradoresActuales.map(normalizarNombre).sort());
    if (cambiaronColaboradores && normalizarNombre(asignadoAnterior) === normalizarNombre(tareaActualizada.asignado_a)) {
      notificarAsignacionSinInterrumpir({
        pool,
        tarea: tareaActualizada,
        motivo: "reasignada",
        actor,
      });
    }
    const eventoEstado = getStateNotification(tareaActualizada, estadoAnterior);
    if (eventoEstado) {
      notificarAsignacionSinInterrumpir({
        pool,
        tarea: tareaActualizada,
        motivo: eventoEstado.motivo,
        nombresDestinatarios: eventoEstado.recipients,
        actor,
      });
    }
    if (body.estado === "en_revision" && estadoAnterior !== "en_revision" && isProductionVisitTask(tareaActualizada)) {
      crearTareaEdicionDesdeVisita(tareaActualizada)
        .then((tareaEdicion) => {
          if (!tareaEdicion) return;
          notificarAsignacionSinInterrumpir({ pool, tarea: tareaEdicion, motivo: "creada", actor });
        })
        .catch((error) => console.error(`No se pudo crear la edición para la visita ${tareaActualizada.id}:`, error.message));
    }
  } catch (error) {
    next(error);
  }
});

router.post("/tareas/:id/aprobar-publicacion", async (req, res, next) => {
  try {
    if (!isTaskLeader(req.auth)) {
      return res.status(403).json({ error: "Solo Franco o Agustín pueden aprobar una tarea para publicación." });
    }
    if (req.query.workspace !== "render_os") {
      return res.status(400).json({ error: "Esta acción solo está disponible en RENDER OS." });
    }
    const actual = await pool.query(
      `SELECT id, titulo, asignado_a, cliente_id, estado, propiedades_extra,
              to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
              tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia,
              tarea_padre_id, updated_at
       FROM tareas
       WHERE id = $1 AND propiedades_extra->>'workspace' = 'render_os'`,
      [req.params.id],
    );
    const tarea = actual.rows[0];
    if (!tarea) return res.status(404).json({ error: "Tarea no encontrada." });
    if (tarea.estado !== "en_revision" || !isVideoEditingTask(tarea)) {
      return res.status(400).json({ error: "Solo se pueden aprobar videos que estén Para revisar." });
    }
    if (tarea.propiedades_extra?.revision_aprobada === true) {
      return res.status(409).json({ error: "Esta tarea ya fue aprobada y enviada a Oriana." });
    }
    const actor = getTaskActor(req.auth);
    const result = await pool.query(
      `UPDATE tareas
       SET asignado_a = 'Oriana',
           propiedades_extra = propiedades_extra || $2::jsonb,
           updated_at = now()
       WHERE id = $1
         AND propiedades_extra->>'workspace' = 'render_os'
         AND estado = 'en_revision'
         AND propiedades_extra->>'revision_aprobada' IS DISTINCT FROM 'true'
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion,
         propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
         historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones,
         material_referencia, tarea_padre_id, created_at, updated_at`,
      [req.params.id, JSON.stringify({ revision_aprobada: true, revision_aprobada_por: actor, revision_aprobada_at: new Date().toISOString(), workspace: "render_os" })],
    );
    if (!result.rows[0]) return res.status(409).json({ error: "La tarea ya fue aprobada o cambió de estado." });
    const aprobada = result.rows[0];
    res.json(aprobada);
    notificarAsignacionSinInterrumpir({
      pool,
      tarea: aprobada,
      motivo: "aprobada",
      nombresDestinatarios: ["Oriana"],
      actor,
      detalle: `${actor} aprobó el material. Oriana puede programarlo o publicarlo.`,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/tareas/:id/produccion/registros", async (req, res, next) => {
  if (!canRecordProduction(req.auth)) {
    return res.status(403).json({ error: "Solo Germán o un Líder pueden registrar videos de una visita." });
  }
  const amount = Number(req.body.cantidad);
  const date = String(req.body.fecha || "");
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "La cantidad debe ser un número entero mayor que cero." });
  }
  if (!isValidProductionDate(date)) {
    return res.status(400).json({ error: "La fecha de grabación no es válida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const params = [req.params.id];
    const access = buildTaskAccessClause(req.auth, "t", "$2");
    if (access.value) params.push(access.value);
    const currentResult = await client.query(
      `SELECT t.id, t.titulo, t.asignado_a, t.cliente_id, t.estado, t.requiere_aprobacion,
              t.propiedades_extra, to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
              t.historia_id, t.publicacion_id, t.tipo_tarea, t.subtipo, t.prioridad,
              t.aclaraciones, t.material_referencia, t.tarea_padre_id, t.created_at, t.updated_at
       FROM tareas AS t
       WHERE t.id = $1 AND t.propiedades_extra->>'workspace' = 'render_os'${access.sql}
       FOR UPDATE`,
      params,
    );
    const task = currentResult.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Visita no encontrada o no asignada a este usuario." });
    }
    if (!isProductionVisitTask(task)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El registro de videos solo está disponible en tareas de visitas de producción." });
    }
    if (req.body.expected_updated_at && new Date(task.updated_at).getTime() !== new Date(req.body.expected_updated_at).getTime()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La tarea cambió mientras registrabas los videos. Revisá la última versión." });
    }
    const progress = getProductionProgress(task);
    if (progress.planned === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Primero un Líder debe indicar cuántos videos están previstos en la visita." });
    }
    if (amount > progress.remaining) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Solo quedan ${progress.remaining} videos por registrar.` });
    }
    const records = Array.isArray(task.propiedades_extra?.produccion_registros)
      ? task.propiedades_extra.produccion_registros
      : [];
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cantidad: amount,
      fecha: date,
      usuario: getTaskActor(req.auth),
      created_at: new Date().toISOString(),
    };
    const updated = await client.query(
      `UPDATE tareas
       SET propiedades_extra = propiedades_extra || $2::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra,
                 to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id,
                 publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia,
                 tarea_padre_id, created_at, updated_at`,
      [task.id, JSON.stringify({ produccion_registros: [...records, record], workspace: "render_os" })],
    );
    await client.query("COMMIT");
    return res.status(201).json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

router.delete("/tareas/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const esRenderOS = req.query.workspace === "render_os";
    const result = await pool.query(
      `DELETE FROM tareas
       WHERE id = $1${esRenderOS ? " AND propiedades_extra->>'workspace' = 'render_os'" : ""}
       RETURNING id`,
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/tareas", async (req, res, next) => {
  try {
    const {
      asignado_a,
      tipo_tarea,
      historia_id,
      publicacion_id,
      cliente_id,
      prioridad,
      estado,
      incluir_archivadas,
      solo_archivadas,
      limit,
      offset,
      workspace,
      q,
      area,
    } = req.query;

    const limite = Math.min(Math.max(Number.parseInt(limit, 10) || 0, 0), 500);
    const desplazamiento = Math.max(Number.parseInt(offset, 10) || 0, 0);

    let query = `
      SELECT
        t.id,
        t.titulo,
        t.estado,
        t.asignado_a,
        t.requiere_aprobacion,
        t.tarea_padre_id,
        padre.estado AS tarea_padre_estado,
        t.propiedades_extra,
        t.cliente_id,
        c.nombre AS cliente_nombre,
        to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        t.historia_id,
        t.publicacion_id,
        COALESCE(t.material_referencia, h.material_referencia, p.material_referencia) AS material_referencia,
        COALESCE(t.aclaraciones, h.aclaraciones, p.aclaraciones) AS aclaraciones,
        t.tipo_tarea,
        t.subtipo,
        t.prioridad,
        t.created_at,
        t.updated_at,
        COUNT(*) OVER()::int AS total_count,
        to_char(h.fecha_programada, 'YYYY-MM-DD') AS historia_fecha_programada,
        h.estado AS historia_estado,
        to_char(p.fecha_programada, 'YYYY-MM-DD') AS publicacion_fecha_programada,
        p.estado AS publicacion_estado,
        p.tipo AS publicacion_tipo
      FROM tareas t
      LEFT JOIN clientes c ON c.id = t.cliente_id
      LEFT JOIN tareas padre
        ON padre.id = t.tarea_padre_id
       ${workspace === "render_os" ? "AND padre.propiedades_extra->>'workspace' = 'render_os'" : ""}
      LEFT JOIN historias h ON h.id = t.historia_id
      LEFT JOIN publicaciones p ON p.id = t.publicacion_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    // RENDER OS comparte usuarios y clientes con el sistema vigente, pero
    // empieza con un tablero de tareas nuevo. El marcador vive en JSONB para
    // conservar intacto el historial anterior sin duplicar ni borrar datos.
    // Los callers sin workspace=render_os (ej. /piezas) nunca deben ver
    // tareas de RENDER OS mezcladas con las históricas, y viceversa.
    if (workspace === "render_os") {
      query += ` AND t.propiedades_extra->>'workspace' = 'render_os'`;
    } else {
      query += ` AND t.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'`;
    }

    const acceso = buildTaskReadAccessClause(req.auth, "t", `$${paramCount}`, workspace);
    query += acceso.sql;
    if (acceso.value) {
      params.push(acceso.value);
      paramCount++;
    }

    if (asignado_a) {
      query += ` AND (t.asignado_a = $${paramCount} OR COALESCE(t.propiedades_extra->'colaboradores', '[]'::jsonb) ? $${paramCount})`;
      params.push(asignado_a);
      paramCount++;
    }
    if (tipo_tarea) {
      query += tipo_tarea === "none"
        ? ` AND t.tipo_tarea IS NULL`
        : ` AND t.tipo_tarea = $${paramCount}`;
      if (tipo_tarea !== "none") {
        params.push(tipo_tarea);
        paramCount++;
      }
    }
    if (area) {
      const areaText = `LOWER(CONCAT_WS(' ', t.tipo_tarea, t.subtipo, t.titulo))`;
      const areaExpression = `CASE
        WHEN t.tipo_tarea = 'administracion' AND (${areaText} LIKE '%video%' OR ${areaText} LIKE '%reel%') THEN 'planificacion'
        WHEN ${areaText} LIKE '%chatbot%' OR ${areaText} LIKE '%bot %' THEN 'chatbots'
        WHEN ${areaText} LIKE '%web%' OR ${areaText} LIKE '%landing%' OR ${areaText} LIKE '%página%' THEN 'web'
        WHEN ${areaText} LIKE '%cartel%' THEN 'carteleria'
        WHEN ${areaText} LIKE '%carrusel%' THEN 'carruseles'
        WHEN ${areaText} LIKE '%historia%' OR ${areaText} LIKE '%flyer%' OR ${areaText} LIKE '%community%' THEN 'historias'
        WHEN ${areaText} LIKE '%produccion%' OR ${areaText} LIKE '%producción%' OR ${areaText} LIKE '%visita%' OR ${areaText} LIKE '%filmar%' THEN 'produccion'
        WHEN ${areaText} LIKE '%edicion%' OR ${areaText} LIKE '%edición%' OR ${areaText} LIKE '%editar%' OR ${areaText} LIKE '%reel%' THEN 'edicion'
        WHEN t.tipo_tarea = 'diseno' THEN 'carruseles'
        ELSE 'edicion'
      END`;
      query += ` AND (${areaExpression}) = $${paramCount}`;
      params.push(area);
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
    if (cliente_id) {
      if (cliente_id === "none") query += ` AND t.cliente_id IS NULL`;
      else {
        query += ` AND t.cliente_id = $${paramCount}`;
        params.push(cliente_id);
        paramCount++;
      }
    }
    if (prioridad) {
      query += ` AND t.prioridad = $${paramCount}`;
      params.push(prioridad);
      paramCount++;
    }
    if (estado) {
      query += ` AND t.estado = $${paramCount}`;
      params.push(estado);
      paramCount++;
    }

    for (const term of getTaskSearchTerms(q)) {
      query += ` AND CONCAT_WS(' ',
        t.titulo,
        COALESCE(c.nombre, ''),
        COALESCE(t.asignado_a, ''),
        COALESCE(t.propiedades_extra->>'resumen', ''),
        COALESCE(t.propiedades_extra->'colaboradores', '[]'::jsonb)::text
      ) ILIKE $${paramCount}`;
      params.push(`%${term}%`);
      paramCount++;
    }

    if (solo_archivadas === "true") {
      query += ` AND t.propiedades_extra->>'archivada_render_os' = 'true'`;
    } else if (incluir_archivadas !== "true") {
      query += ` AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'`;
    }

    query += ` ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.id DESC`;

    if (limite > 0) {
      query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(limite, desplazamiento);
    }

    const result = await pool.query(query, params);
    const total = result.rows[0]?.total_count || 0;
    res.set("X-Total-Count", String(total));
    res.json(result.rows.map(({ total_count, ...tarea }) => tarea));
  } catch (error) {
    next(error);
  }
});

router.get("/tareas/:id", async (req, res, next) => {
  try {
    if (req.query.workspace !== "render_os") {
      return res.status(400).json({ error: "Falta un workspace válido." });
    }

    const acceso = buildTaskReadAccessClause(req.auth, "t", "$2", "render_os");
    const params = [req.params.id];
    if (acceso.value) params.push(acceso.value);
    const result = await pool.query(
      `SELECT
         t.id, t.titulo, t.estado, t.asignado_a, t.requiere_aprobacion,
         t.tarea_padre_id, padre.estado AS tarea_padre_estado,
         t.propiedades_extra, t.cliente_id, c.nombre AS cliente_nombre,
         to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
         t.historia_id, t.publicacion_id,
         COALESCE(t.material_referencia, h.material_referencia, p.material_referencia) AS material_referencia,
         COALESCE(t.aclaraciones, h.aclaraciones, p.aclaraciones) AS aclaraciones,
         t.tipo_tarea, t.subtipo, t.prioridad, t.created_at, t.updated_at,
         to_char(h.fecha_programada, 'YYYY-MM-DD') AS historia_fecha_programada,
         h.estado AS historia_estado,
         to_char(p.fecha_programada, 'YYYY-MM-DD') AS publicacion_fecha_programada,
         p.estado AS publicacion_estado, p.tipo AS publicacion_tipo
       FROM tareas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       LEFT JOIN tareas padre
         ON padre.id = t.tarea_padre_id
        AND padre.propiedades_extra->>'workspace' = 'render_os'
       LEFT JOIN historias h ON h.id = t.historia_id
       LEFT JOIN publicaciones p ON p.id = t.publicacion_id
       WHERE t.id = $1
         AND t.propiedades_extra->>'workspace' = 'render_os'${acceso.sql}`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/tareas/:id/subtareas", async (req, res, next) => {
  try {
    if (req.query.workspace !== "render_os") {
      return res.status(400).json({ error: "Falta un workspace válido." });
    }

    const accesoPadre = buildTaskReadAccessClause(req.auth, "t", "$2", "render_os");
    const paramsPadre = [req.params.id];
    if (accesoPadre.value) paramsPadre.push(accesoPadre.value);
    const padre = await pool.query(
      `SELECT t.id FROM tareas AS t
       WHERE t.id = $1
         AND t.propiedades_extra->>'workspace' = 'render_os'${accesoPadre.sql}`,
      paramsPadre,
    );
    if (padre.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    const accesoSubtarea = buildTaskReadAccessClause(req.auth, "t", "$2", "render_os");
    const paramsSubtareas = [req.params.id];
    if (accesoSubtarea.value) paramsSubtareas.push(accesoSubtarea.value);
    const result = await pool.query(
      `SELECT
         t.id, t.titulo, t.estado, t.asignado_a, t.requiere_aprobacion,
         t.tarea_padre_id, padre.estado AS tarea_padre_estado,
         t.propiedades_extra, t.cliente_id, c.nombre AS cliente_nombre,
         to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
         t.historia_id, t.publicacion_id,
         COALESCE(t.material_referencia, h.material_referencia, p.material_referencia) AS material_referencia,
         COALESCE(t.aclaraciones, h.aclaraciones, p.aclaraciones) AS aclaraciones,
         t.tipo_tarea, t.subtipo, t.prioridad, t.created_at, t.updated_at,
         to_char(h.fecha_programada, 'YYYY-MM-DD') AS historia_fecha_programada,
         h.estado AS historia_estado,
         to_char(p.fecha_programada, 'YYYY-MM-DD') AS publicacion_fecha_programada,
         p.estado AS publicacion_estado, p.tipo AS publicacion_tipo
       FROM tareas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       LEFT JOIN tareas padre
         ON padre.id = t.tarea_padre_id
        AND padre.propiedades_extra->>'workspace' = 'render_os'
       LEFT JOIN historias h ON h.id = t.historia_id
       LEFT JOIN publicaciones p ON p.id = t.publicacion_id
       WHERE t.tarea_padre_id = $1
         AND t.propiedades_extra->>'workspace' = 'render_os'${accesoSubtarea.sql}
       ORDER BY t.id`,
      paramsSubtareas,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/tareas/:id/comentarios", async (req, res, next) => {
  try {
    const esRenderOS = req.query.workspace === "render_os";
    const acceso = buildTaskReadAccessClause(req.auth, "t", "$2", esRenderOS ? "render_os" : "historical");
    const params = [req.params.id];
    if (acceso.value) params.push(acceso.value);
    const tarea = await pool.query(
      `SELECT t.id FROM tareas AS t
       WHERE t.id = $1
         AND t.propiedades_extra->>'workspace' ${esRenderOS ? "= 'render_os'" : "IS DISTINCT FROM 'render_os'"}${acceso.sql}`,
      params,
    );
    if (tarea.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    const result = await pool.query(
      `SELECT id, tarea_id, autor, contenido, created_at
       FROM tarea_comentarios
       WHERE tarea_id = $1
       ORDER BY created_at ASC, id ASC`,
      [req.params.id],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/tareas/:id/comentarios", async (req, res, next) => {
  try {
    const esRenderOS = req.query.workspace === "render_os";
    const autor = req.auth.rol === "admin"
      ? String(req.body.autor || "").trim()
      : getTaskActor(req.auth);
    const contenido = String(req.body.contenido || "").trim();
    if (!autor || !contenido) {
      return res.status(400).json({ error: "Faltan autor o comentario." });
    }
    const acceso = buildTaskAccessClause(req.auth, "t", "$4");
    const params = [req.params.id, autor, contenido];
    if (acceso.value) params.push(acceso.value);
    const result = await pool.query(
      `INSERT INTO tarea_comentarios (tarea_id, autor, contenido)
       SELECT t.id, $2, $3 FROM tareas AS t
       WHERE t.id = $1
         AND t.propiedades_extra->>'workspace' ${esRenderOS ? "= 'render_os'" : "IS DISTINCT FROM 'render_os'"}${acceso.sql}
       RETURNING id, tarea_id, autor, contenido, created_at`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    const comentario = result.rows[0];
    res.status(201).json(comentario);

    if (!contenido.startsWith("[Actividad]")) {
      void pool.query(
        `SELECT id, titulo, asignado_a, cliente_id, prioridad, propiedades_extra,
                to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento
         FROM tareas WHERE id = $1`,
        [req.params.id],
      ).then((tarea) => {
        if (!tarea.rows[0]) return;
        const esBloqueo = /\bbloque(?:o|ado|ada|ante)?\b/i.test(contenido);
        notificarAsignacionSinInterrumpir({
          pool,
          tarea: tarea.rows[0],
          motivo: esBloqueo ? "bloqueada" : "comentario",
          detalle: `${autor}: ${contenido.slice(0, 280)}`,
        });
      }).catch((error) => {
        console.error(`No se pudo preparar la notificación del comentario de la tarea ${req.params.id}:`, error.message);
      });
    }
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
      WHERE p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'

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
      WHERE h.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'

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
function fechaVencimientoTarea(fechaProgramada, diasAntes = 1) {
  const f = new Date(`${fechaProgramada}T00:00:00`);
  f.setDate(f.getDate() - diasAntes);
  return f.toISOString().slice(0, 10);
}

async function crearTareaAuto({ titulo, asignado_a, cliente_id, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, tarea_padre_id }) {
  const { rows } = await pool.query(
    `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, tarea_padre_id)
     VALUES ($1, $2, $3, 'pendiente', false, $4, $5, $6, $7, $8, $9, 'media', $10)
     RETURNING id`,
    [
      titulo,
      asignado_a,
      cliente_id,
      JSON.stringify(buildAutoTaskProperties()),
      fecha_vencimiento,
      historia_id || null,
      publicacion_id || null,
      tipo_tarea,
      subtipo || null,
      tarea_padre_id || null,
    ],
  );
  return rows[0].id;
}

router.post("/piezas", requireRole("admin"), async (req, res, next) => {
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
        // El responsable elegido define el diseñador; no todos los clientes
        // pertenecen a la misma persona.
        await crearTareaAuto({
          titulo: `Diseñar assets - ${idea || "sin idea"}`,
          asignado_a: responsable,
          cliente_id,
          fecha_vencimiento: fechaVencimientoTarea(fecha_programada, 1),
          publicacion_id: publicacion.id,
          tipo_tarea: "diseno",
          subtipo: "diseñar",
        });
      } else {
        // Un video nace como una sola tarea simple del Líder. Filmación y
        // edición se asignan después, cuando ya existen idea, guion y material.
        await crearTareaAuto({
          titulo: `Video - ${idea || "por definir"}`,
          asignado_a: responsable,
          cliente_id,
          fecha_vencimiento: fecha_programada,
          publicacion_id: publicacion.id,
          tipo_tarea: "administracion",
          subtipo: "video",
        });
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

router.post("/historias/convertir-flyer/:publicacionId", requireRole("admin"), async (req, res, next) => {
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

router.patch("/piezas/:id", requireRole("admin"), async (req, res, next) => {
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
      await completeLinkedAutoTasks(pool, { estado: resultP.rows[0].estado, publicacionId: Number(id) });
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

    await completeLinkedAutoTasks(pool, { estado: resultH.rows[0].estado, historiaId: Number(id) });

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
  // Los archivos dentro de /assets llevan un hash en el nombre (los genera
  // Vite en el build) — si cambia el contenido, cambia el nombre. Por eso
  // son seguros para cachear "para siempre" en el navegador, evitando
  // volver a descargarlos en cada visita.
  app.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // Se lee una sola vez en memoria en vez de usar res.sendFile(): en el
  // hosting de Hostinger, sendFile devolvía NotFoundError pese a que el
  // archivo existía (probablemente por cómo resuelve symlinks/permisos
  // en esa infraestructura). readFileSync no tiene ese problema.
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
  app.get(/^\/(?!api\/|health(?:\/|$)).*/, (_req, res) => {
    res.type("html").send(indexHtml);
  });
  console.log("Sirviendo frontend estático desde", distDir);
}

// Error handler centralizado: sin esto, Express devuelve HTML/stack
// traces por defecto en vez de JSON — riesgo de filtrar detalles internos.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Error interno del servidor." });
});

// IIFE en vez de top-level await: el runtime de Hostinger (LiteSpeed
// lsnode.js) carga este archivo con require(), que no admite módulos ESM
// con await de nivel superior (ERR_REQUIRE_ASYNC_MODULE).
if (process.env.RENDER_DISABLE_SERVER_START !== "true") (async () => {
  try {
    await checkDatabaseConnection();
    await runMigrations(pool);
    if (shouldSetupDemoData()) {
      await setupDemoClientes();
      console.log("Postgres connection OK and demo data prepared");
    } else {
      console.log("Postgres connection OK");
    }
  } catch (error) {
    console.error("Postgres connection failed");
    console.error(error.message);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
})();
