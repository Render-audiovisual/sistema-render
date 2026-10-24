import "dotenv/config";
import { applyFeedbackBrowserOperation } from './feedback-browser-write.js';
import { feedbackBrowserAliasInput, feedbackBrowserAliasBody } from './feedback-browser-compat.js';
import { readFeedbackNotesPage, readFeedbackNoteDetail, readLegacyFeedbackNotes, feedbackNoteMetadataDto } from './feedback-notes-read.js';
import { convertUnlinkedFlyer } from './story-flyer-conversion.js';
import { deleteEmptyClient } from './delete-empty-client.js';
import { clientAgreementRevisionSql, lockClientAdministration, lockClientAgreement, readClientAgreementRevision } from './client-agreement.js';
import { captureClientCreator, lockCurrentClientCreator } from './client-create-authority.js';
import { CONTRACT_REVISION_SQL, contractId, expectedContractVersion, normalizeContractInput, contractNotUpdated } from './financial-contract.js';
import { findSimilarFeedback } from "./feedback-workflow.js";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { checkDatabaseConnection, pool } from "./db.js";
import {
  enviarInstruccionesAcceso,
  normalizarNombre,
  notificarAsignacionSinInterrumpir as notificarAsignacionPorCorreoSinInterrumpir,
} from "./email-notifications.js";
import { encolarNotificacionPrivadaTarea } from "./private-task-notifications.js";
import { encolarNotificacionPrivadaFeedback } from "./private-feedback-notifications.js";
import { requireRole, issueUserToken } from "./auth.js";
import { configuredBrowserSessions, createPrincipalAuthentication } from './browser-session-config.js';
import { createLoginHandlers, loginUserDto } from './login-handlers.js';
import { reserveLoginAttempt } from "./login-abuse.js";
import { administerUser, withUserAdministration, withSelfIdentityChange, UserAdministrationAuthorityError } from "./user-administration.js";
import { assertUserLoginIdentifierAvailable } from './user-login-namespace.js';
import { normalizeUserCreateInput } from './user-create-input.js';
import { bodyParserErrorResponse } from './body-parser-errors.js';
import { normalizeSelfProfileInput, SelfProfileInputError } from './self-profile-input.js';
import { USER_ADMIN_REVISION_SQL, UserAdministrationInputError, userAdministrationId, normalizeUserAdministrationPatch } from './user-admin-patch.js';
import { resolveTaskAssignments, annotateTaskAssignments, replaceTaskAssignments } from "./task-assignments.js";
import { persistAssignedTask } from "./task-persistence.js";
import { correctProductionRecord } from "./production-record-updates.js";
import { taskOperationalDto, editorialOperationalDto } from "./operational-dto.js";
import { loadClientCatalogSnapshot } from './client-catalog.js';
import { loadUserCatalogSnapshot } from './user-catalog.js';
import { saveClientStructure } from './client-structure.js';
import { savePlanningCheck, updateSpecialDate } from './planning-writes.js';
import { createProductionRegistryRouter, syncProductionVisitFromTask } from "./production-registry.js";
import { rejectMixedProductionRecording } from "./production-registry-compatibility.js";
import { loadProductionTaskContext } from "./production-reporting.js";
import { productionEditorialConflict } from "./production-link-errors.js";
import { normalizeTaskState, taskTransitionError, isTaskFinalized } from "./workflow-contract.js";
import { buildTaskAccessClause, buildTaskReadAccessClause, canEmployeePatchTask, getTaskActor } from "./task-access.js";
import { createTaskComment, findTaskCommentCreation } from './task-comment-receipts.js';
import { parseTaskPagination } from "./task-pagination.js";
import { publishPieceLinkedToCompletedTask } from "./piece-task-linking.js";
import { calculateSalaryDashboard } from "./salary-calculation.js";
import { applyCompensations, nextPeriod } from "./finance-calculation.js";
import { buildAutomaticFinanceSummary, previousPeriod } from "./automatic-finance.js";
import { getCardDollarRate } from "./exchange-rate.js";
import { captureFinanceActor, financePeriod, withFinanceSnapshot } from './finance-snapshot.js';
import { withFinanceWrite } from './finance-write-authority.js';
import { createWilsonRouter } from "./wilson-integration.js";
import { createWilsonChatRouter, scheduleWilsonMessages } from "./wilson-chat.js";
import { readMigrationIdentity, readMigrationStatus } from "./migrations.js";
import { resolveStartupPolicy, assertBackgroundJobsAllowed, assertStartupMigrationStatus } from "./startup-policy.js";
import { assertCoreSchemaReady } from "./startup-schema.js";
import { assertTaskBusinessInput, assertTaskCoordinationPatch } from "./task-integration-fields.js";
import { createPersonalHomeRouter } from "./personal-home.js";
import { createProjectsRouter } from "./projects.js";
import { createClientOperationRouter } from "./client-operation.js";
import { createMonthlyAgreementRouter, strictAgreementPeriod, strictAgreementMoney, strictAgreementClientId, validateLegacyConfigurationRequest } from "./monthly-agreement.js";
import { createTeamPaymentsRouter } from './team-payments.js';
import { projectDomainConflict } from "./project-errors.js";
import { createEditorialPublicationRouter } from "./editorial-publication.js";
import { createEditingDeliveriesRouter } from "./editing-deliveries.js";
import { editingDeliveryDomainConflict } from "./editing-deliveries-errors.js";
import { normalizeExpectedEditingDelivery, assertCurrentEditingApprover, assertEditingApprovalDelivery } from "./editing-approval.js";
import { createEditingReviewsRouter, recordEditingApproval, editingReviewDomainConflict } from "./editing-reviews.js";
import { readFeedbackTaskInventory } from './feedback-task-inventory.js';
import { createCalendarRouter } from "./calendar.js";
import { createEditorialControlRouter } from "./editorial-control.js";
import { editorialPublicationDomainConflict } from "./editorial-publication-errors.js";
import { loadEditorialCatalogSnapshot } from './editorial-catalog.js';
import { legacyPieceSelection, readLegacyEditorialPiece, writeEditorialPiece } from './editorial-piece-write.js';
import { createEditorialPiece } from './editorial-piece-create.js';
import { createEditorialArchiveRouter } from './editorial-archive.js';
import { canRecordProduction, getProductionProgress, isProductionComplete, getProductionTaskState, isProductionVisitTask, isValidProductionDate, nextProductionPeriod } from "./production-visits.js";
import { getTaskSearchTerms } from "./task-search.js";
import { rankTaskPriorities } from "./task-priority.js";
import { loadReportSnapshot } from "./report-snapshot.js";
import { createGoogleDrivePublicRouter, createGoogleDriveRouter } from "./google-drive.js";
import { createPublicationDispatchRouter } from "./publication-dispatch.js";
import { createPersonalListsRouter } from "./personal-lists.js";
import { normalizeClientConfiguration, normalizePeriod } from "./client-config.js";
import { reconcileEditorialCalendar } from "./editorial-calendar.js";
import { buildMiaStatePendingMarker } from "./mia-task-digest.js";
import { scheduleRenderOsTrashCleanup } from "./task-trash-retention.js";
import { scheduleMiaSupervisor } from "./mia-supervisor.js";
import { createMoodboardsRouter } from "./moodboards.js";
import { createTaskBoardOrderRouter } from './task-board-order.js';
import { parseTaskOrderRead, readTaskBoardPage } from './task-board-page.js';
import { parseTaskReviewRead, parseTaskStateRead, buildTaskReviewClause, effectiveTaskStateSql, readTaskReviewPage } from './task-review-query.js';
import { createClientGoalsRouter, reconcileMonthlyGoals } from "./client-goals.js";
import {
  getStateNotification,
  isTaskFinalizer,
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

function notificarAsignacionSinInterrumpir(opciones) {
  const esRenderOS = opciones?.tarea?.propiedades_extra?.workspace === "render_os";
  const canal = String(process.env.TASK_NOTIFICATION_CHANNEL || "dual").trim().toLowerCase();
  if (esRenderOS && canal !== "email") {
    void encolarNotificacionPrivadaTarea(opciones).catch((error) => {
      console.error(`No se pudo encolar la notificación privada de la tarea ${opciones.tarea.id}:`, error.message);
    });
  }
  if (!esRenderOS || canal !== "whatsapp") {
    notificarAsignacionPorCorreoSinInterrumpir(opciones);
  }
}

function notificarFeedbackSinInterrumpir(opciones) {
  void encolarNotificacionPrivadaFeedback(opciones).catch((error) => {
    console.error(`No se pudo encolar la notificación privada del feedback ${opciones.nota.id}:`, error.message);
  });
}

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

app.use(compression());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Explicit opt-in only while frontend guards/queues are migrated together.
const browserSessions = configuredBrowserSessions(process.env, pool);
router.use((req, res, next) => {
  if (browserSessions) {
    res.vary('Origin');
    const origin = req.get('origin');
    if (origin !== undefined && origin !== process.env.RENDER_BROWSER_ORIGIN)
      return res.status(403).json({ error: 'Origen no autorizado.' });
    if (origin) {
      res.header('Access-Control-Allow-Origin', process.env.RENDER_BROWSER_ORIGIN);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Render-Session-Context, X-Render-CSRF');
  } else {
    // Legacy bearer compatibility has no ambient cookie credential authority.
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.header('Access-Control-Expose-Headers', 'X-Total-Count, X-Task-Order-Revision, X-Task-Order-Snapshot');
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

// Authentication bodies are small and untrusted. Parse them before the general
// operational parser; parser errors can include body text, so never log them.
router.use('/login', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
  express.json({ limit: '32kb' }), (error, _req, res, _next) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Datos de acceso inválidos.' });
  });
router.use(express.json({ limit: '15mb' }));

async function allowLoginAttempt(req, res, identifier) {
  try {
    const result = await reserveLoginAttempt(pool, { peer: req.socket?.remoteAddress, ...(identifier === undefined ? {} : { identifier }) }, process.env.JWT_SECRET);
    if (result.allowed) return true;
    res.set('Retry-After', String(result.retryAfter));
    res.status(429).json({ error: 'Demasiados intentos de acceso. Esperá unos minutos y volvé a intentar.' });
  } catch {
    // Rate storage/configuration failure must not silently permit unlimited
    // verification or expose driver details through the global error logger.
    res.status(503).json({ error: 'No se pudo verificar el acceso. Volvé a intentar más tarde.' });
  }
  return false;
}

router.use("/integraciones/wilson", createWilsonRouter({
  pool,
  notifyAssignment: notificarAsignacionSinInterrumpir,
  notifyTaskReceiptEmail: (options) => {
    if (String(process.env.TASK_NOTIFICATION_CHANNEL || "dual").trim().toLowerCase() !== "whatsapp") {
      notificarAsignacionPorCorreoSinInterrumpir(options);
    }
  },
  notifyFeedback: notificarFeedbackSinInterrumpir,
  confirmProduction: ({ taskId, actor, db, expectedRevision, actorId }) => confirmProductionVisit(taskId, actor, { db, expectedRevision, actorId }),
}));

const loginHandlers = createLoginHandlers({
  pool, allowLoginAttempt, googleClient, googleAudience: process.env.GOOGLE_CLIENT_ID,
  sendSuccess(user, res, browser) {
    const usuario = loginUserDto(user);
    if (browser) return res.json({ usuario, ...browserSessions.establishSession(user, res) });
    return res.json({ token: issueUserToken(user), usuario });
  },
});
router.post('/login', loginHandlers.password());
router.post('/login/google', loginHandlers.google());
if (browserSessions) {
  router.get('/sesion/desafio', browserSessions.issueLoginChallenge);
  router.post('/login/browser', browserSessions.requireLoginChallenge, loginHandlers.password(true));
  router.post('/login/browser/google', browserSessions.requireLoginChallenge, loginHandlers.google(true));
} else {
  const unavailable = (_req, res) => res.status(404).json({ error: 'Sesiones de navegador no habilitadas.' });
  router.get('/sesion/desafio', unavailable);
  router.use('/login/browser', unavailable);
}

// El callback de Google vuelve sin el JWT del navegador. El parámetro state
// está firmado, vence en diez minutos y limita la conexión a un Líder.
router.use("/drive", createGoogleDrivePublicRouter({ express, pool }));

router.use(createPrincipalAuthentication({ browserTransport: browserSessions, pool }));
router.use('/inicio', createPersonalHomeRouter({ express, pool }));
router.use('/proyectos', createProjectsRouter({ express, pool }));
router.use('/clientes', createClientOperationRouter({ express, pool }));
router.use('/clientes', createMonthlyAgreementRouter({ express, pool }));
router.use('/finanzas/pagos', createTeamPaymentsRouter({ express, pool }));
router.use('/editorial-publicacion', createEditorialPublicationRouter({ express, pool }));
router.get('/tareas-edicion/inventario-feedback', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await readFeedbackTaskInventory(pool, req.auth, req.query)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
});
router.use('/tareas-edicion', createEditingDeliveriesRouter({ express, pool }));
router.use('/tareas-edicion', createEditingReviewsRouter({ express, pool }));
router.use('/calendario', createCalendarRouter({ express, pool }));
router.use('/editorial-control', createEditorialControlRouter({ express, pool }));
router.use('/editorial-archivo', createEditorialArchiveRouter({ express, pool }));

router.get("/sesion", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.browserSession) return res.json({ usuario: req.auth });
  try {
    // Bootstrap must read the saved profile, not just the authorization DTO.
    // Keep this projection closed and bind it to the verified account epoch.
    const result = await pool.query(`SELECT id, usuario, nombre, rol, foto_perfil
      FROM usuarios WHERE id=$1 AND session_version=$2 AND activo IS TRUE`,
      [req.auth.id, req.auth.session_version]);
    if (!result.rows.length) {
      res.removeHeader('X-Render-Session-Context');
      return res.status(401).json({ error: 'La sesión cambió. Volvé a iniciar sesión.' });
    }
    const user = result.rows[0];
    return res.json({ usuario: { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol,
      foto_perfil: user.foto_perfil }, ...req.browserSession });
  } catch (error) { next(error); }
});
router.post("/logout", async (req, res, next) => {
  try {
    // This first rollout revokes all sessions of the account, not other users.
    // Recheck the observed epoch atomically: a delayed request cannot revoke a
    // newer epoch after a password change, administrative revoke or other logout.
    const revoked = await pool.query(`UPDATE usuarios SET session_version=session_version+1
      WHERE id=$1 AND session_version=$2 AND activo=true RETURNING id`, [req.auth.id, req.auth.session_version]);
    if (revoked.rowCount !== 1) return res.status(401).json({ error: "La sesión ya no está vigente." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.patch("/usuarios/:id/acceso", requireRole("admin"), async (req, res, next) => {
  try {
    const id = userAdministrationId(req.params.id), input = normalizeUserAdministrationPatch(req.body,'access',id);
    if (id === req.auth.id && !input.activo) return res.status(409).json({ error: "No podés desactivar tu propia cuenta." });
    const { rows } = await administerUser(pool, id, input, db => db.query(`UPDATE usuarios SET activo=$2,session_version=session_version+1
      WHERE id=$1 RETURNING id,usuario,nombre,rol,activo,${USER_ADMIN_REVISION_SQL} AS admin_revision`, [id, input.activo]), req.auth);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(rows[0]);
  } catch (error) {
    if (error instanceof UserAdministrationInputError) return next(error);
    if ([404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});
router.use("/cliente-objetivos", createClientGoalsRouter({ pool }));
router.get("/producciones/tareas/:id", async (req, res, next) => {
  try {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: "Tarea inválida." });
    res.json(await loadProductionTaskContext(pool, Number(req.params.id)));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});
router.use("/producciones", createProductionRegistryRouter({ express, pool }));
router.use("/moodboards", createMoodboardsRouter({ pool }));
router.use('/tareas/orden', createTaskBoardOrderRouter({ express, pool }));

router.use("/drive", createGoogleDriveRouter({ express, pool, requireRole }));
router.use("/wilson", createWilsonChatRouter({ express, pool }));
router.use("/publicacion-envios", createPublicationDispatchRouter({ express, pool, requireRole }));
router.use("/listas-personales", createPersonalListsRouter({ express, pool }));

router.get("/notas", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const page = await readLegacyFeedbackNotes(pool, req.auth, req.query);
    res.set('X-Total-Count', String(page.total));
    res.set('X-Feedback-Truncated', String(page.has_more));
    res.json(page.items);
  } catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/notas/pagina', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await readFeedbackNotesPage(pool, req.auth, req.query)); }
  catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/notas/:id/detalle', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await readFeedbackNoteDetail(pool, req.auth, req.params.id, req.query)); }
  catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/notas/nuevas", async (req, res, next) => {
  try {
    const desde = new Date(String(req.query.desde || ""));
    if (Number.isNaN(desde.getTime())) {
      return res.status(400).json({ error: "La fecha de lectura no es válida." });
    }
    const result = await pool.query(
      `SELECT COUNT(*)::int AS cantidad FROM notas_compartidas
       WHERE eliminado_at IS NULL AND created_at > $1`,
      [desde.toISOString()],
    );
    res.json({ cantidad: Number(result.rows[0]?.cantidad) || 0 });
  } catch (error) { next(error); }
});

router.get("/notas/similares", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const cliente = String(req.query.cliente || "").trim();
    const titulo = String(req.query.titulo || "").trim();
    const contenido = String(req.query.contenido || "").trim();
    const excludeId = Number(req.query.exclude_id || 0);
    if (!cliente || (!titulo && !contenido)) return res.json({ similares: [] });
    const result = await pool.query(
      `SELECT id,titulo,contenido,feedback,updated_at FROM notas_compartidas
       WHERE eliminado_at IS NULL AND COALESCE(feedback->>'cliente','') ILIKE $1
         AND ($2::bigint=0 OR id<>$2) ORDER BY updated_at DESC LIMIT 100`,
      [cliente, Number.isInteger(excludeId) && excludeId > 0 ? excludeId : 0],
    );
    const candidates = result.rows.map(row => ({ ...row, feedback: feedbackNoteMetadataDto(row.feedback) }));
    return res.json({ similares: findSimilarFeedback({ cliente, titulo, contenido }, candidates) });
  } catch (error) { return next(error); }
});

function handleFeedbackBrowserWrite(aliasAction = null) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const input = aliasAction ? feedbackBrowserAliasInput(aliasAction, req) : req.body;
      const result = await applyFeedbackBrowserOperation(pool, req.auth, input, aliasAction ? {} : req.query);
      res.status(result.status).json(aliasAction ? feedbackBrowserAliasBody(result) : result.body);
      const { note, operation } = result.body;
      if (operation.action === 'create' && !operation.replayed && note?.feedback?.flujo === 'feedback') {
        notificarFeedbackSinInterrumpir({ pool, nota: note, actor: note.creado_por });
      }
    } catch (error) {
      if ([400,401,403,404,409,413,422,428].includes(error.status)) {
        return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      }
      next(error);
    }
  };
}

router.post('/notas/operaciones', handleFeedbackBrowserWrite());
router.post("/notas", handleFeedbackBrowserWrite('create'));
router.patch("/notas/:id", handleFeedbackBrowserWrite('edit'));
router.delete("/notas/:id", handleFeedbackBrowserWrite('trash'));
router.post("/notas/:id/restaurar", handleFeedbackBrowserWrite('restore'));

router.get("/usuarios", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await loadUserCatalogSnapshot(pool, req.auth));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/reportes/datos", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await loadReportSnapshot(pool, req.auth, req.query));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

async function loadPayrollForCollectionPeriod(collectionPeriod, db) {
  const workPeriod = previousPeriod(collectionPeriod);
  const tasks = await db.query(`SELECT t.id,t.titulo,t.asignado_a,t.estado,t.tipo_tarea,t.subtipo,
      to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,t.propiedades_extra,t.created_at,t.updated_at,
      c.nombre AS cliente_nombre FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
      WHERE t.propiedades_extra->>'workspace'='render_os' AND (to_char(t.fecha_vencimiento,'YYYY-MM')=$1
        OR t.propiedades_extra->>'reporte_periodo'=$1 OR (t.fecha_vencimiento IS NULL AND to_char(t.updated_at,'YYYY-MM')=$1))`, [workPeriod]);
  const histories = await db.query(`SELECT h.id,h.estado,to_char(h.fecha_programada,'YYYY-MM-DD') AS fecha_programada,
      h.idea,h.copy,h.fecha_publicación_real,h.updated_at,c.nombre AS cliente_nombre
      FROM historias h JOIN clientes c ON c.id=h.cliente_id WHERE to_char(h.fecha_programada,'YYYY-MM')=$1`, [workPeriod]);
  const publications = await db.query(`SELECT p.id,p.tipo,p.estado,to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,
      p.idea,p.copy,p.fecha_publicación_real,p.updated_at,c.nombre AS cliente_nombre
      FROM publicaciones p JOIN clientes c ON c.id=p.cliente_id WHERE to_char(p.fecha_programada,'YYYY-MM')=$1`, [workPeriod]);
  const compensations = await db.query(`SELECT DISTINCT ON (empleado_clave) empleado_clave,modalidad,sueldo_base,tarifa_facil,tarifa_intermedia
      FROM empleado_compensaciones WHERE vigente_desde <= ($1 || '-01')::date
      ORDER BY empleado_clave,vigente_desde DESC`, [collectionPeriod]);
  const editingDeliveries = await db.query(`SELECT id,editor_clave,to_char(fecha_entrega,'YYYY-MM-DD') AS fecha_entrega,
      cliente_etiqueta,categoria,importe FROM entregas_edicion
      WHERE to_char(fecha_entrega,'YYYY-MM')=$1 ORDER BY fecha_entrega,id`, [workPeriod]);
  const payroll = applyCompensations(calculateSalaryDashboard({
    period: workPeriod,
    tasks: tasks.rows,
    histories: histories.rows,
    publications: publications.rows,
    editingDeliveries: editingDeliveries.rows,
  }), compensations.rows, []);
  return { workPeriod, payroll };
}

function contractApiError(error, res, next) {
  if (error.status) return res.status(error.status).json({error:error.message,code:error.code});
  if (error.code === "23505") return res.status(409).json({ error: "Ya existe un contrato con ese nombre y fecha de inicio." });
  if (["22007", "22008", "23502", "23514"].includes(error.code)) {
    return res.status(400).json({ error: "Revisá el monto y las fechas del contrato." });
  }
  return next(error);
}

router.get("/contratos", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const result = await withFinanceSnapshot(pool, req.auth, db => db.query(`SELECT id,nombre,importe_mensual,
      to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el,activo,
      ${CONTRACT_REVISION_SQL} AS contract_revision
      FROM contratos_financieros ORDER BY activo DESC,nombre,inicia_el DESC`));
    return res.json(result.rows);
  } catch (error) {
    return contractApiError(error, res, next);
  }
});

router.post("/contratos", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const input = normalizeContractInput(req.body, {operation:'create'});
    const result = await withFinanceWrite(pool, req.auth, db => db.query(`INSERT INTO contratos_financieros
      (nombre,importe_mensual,inicia_el,finaliza_el,activo) VALUES ($1,$2,$3::date,$4::date,true)
      RETURNING id,nombre,importe_mensual,to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,
        to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el,activo,${CONTRACT_REVISION_SQL} AS contract_revision`,
      [input.nombre,input.importe_mensual,input.inicia_el,input.finaliza_el ?? null]));
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return contractApiError(error, res, next);
  }
});

router.patch("/contratos/:id", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const id = contractId(req.params.id);
    const input = normalizeContractInput(req.body);
    const expected = expectedContractVersion(req.body?.expected_revision,id);
    const updates = [];
    const values = [];
    const addValue = (sql, value) => {
      values.push(value);
      updates.push(sql.replace("?", `$${values.length}`));
    };
    if (Object.hasOwn(input, "nombre")) {
      addValue("nombre = ?", input.nombre);
    }
    if (Object.hasOwn(input, "importe_mensual")) {
      addValue("importe_mensual = ?", input.importe_mensual);
    }
    for (const field of ["inicia_el", "finaliza_el"]) {
      if (!Object.hasOwn(input, field)) continue;
      addValue(`${field} = ?::date`, input[field]);
    }
    if (Object.hasOwn(input, "activo")) {
      addValue("activo = ?", input.activo);
      if (!Object.hasOwn(input, "finaliza_el")) {
        updates.push(input.activo ? "finaliza_el = NULL" : "finaliza_el = COALESCE(finaliza_el, CURRENT_DATE)");
      }
    }
    if (!updates.length) return res.status(400).json({ error: "No hay campos para actualizar." });
    const idIndex = values.push(id);
    const versionIndex = values.push(expected);
    const result = await withFinanceWrite(pool, req.auth, async db => {
      const updated = await db.query(`UPDATE contratos_financieros SET ${updates.join(", ")}
      WHERE id = $${idIndex} AND contract_version = $${versionIndex} RETURNING id,nombre,importe_mensual,
      to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el,activo,
      ${CONTRACT_REVISION_SQL} AS contract_revision`, values);
      if (!updated.rows[0]) return await contractNotUpdated(db,id);
      return updated;
    });
    return res.json(result.rows[0]);
  } catch (error) {
    return contractApiError(error, res, next);
  }
});

router.delete("/contratos/:id", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const id = contractId(req.params.id);
    normalizeContractInput(req.body ?? {}, {operation:'archive'});
    const expected = expectedContractVersion(req.body?.expected_revision,id);
    const result = await withFinanceWrite(pool, req.auth, async db => {
      const updated = await db.query(`UPDATE contratos_financieros
      SET activo=false,finaliza_el=COALESCE(finaliza_el,CURRENT_DATE) WHERE id=$1 AND contract_version=$2
      RETURNING id,nombre,importe_mensual,to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,activo,
      to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el,${CONTRACT_REVISION_SQL} AS contract_revision`, [id,expected]);
      if (!updated.rows[0]) return await contractNotUpdated(db,id);
      return updated;
    });
    return res.json(result.rows[0]);
  } catch (error) {
    return contractApiError(error, res, next);
  }
});

router.get("/sueldos", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const period = financePeriod(req.query);
    const observed = captureFinanceActor(req.auth);
    // No PostgreSQL lease/snapshot is held while an exchange provider waits.
    const exchangeRate = await getCardDollarRate();
    const response = await withFinanceSnapshot(pool, observed, async db => {
    const previousCollectionPeriod = previousPeriod(period);
    const contracts = await db.query(`SELECT nombre,importe_mensual,to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,
      to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el FROM contratos_financieros ORDER BY nombre,inicia_el`);
    const expenses = await db.query(`SELECT nombre,categoria,moneda,importe,dia_pago,to_char(inicia_el,'YYYY-MM-DD') AS inicia_el,
      to_char(finaliza_el,'YYYY-MM-DD') AS finaliza_el FROM gastos_fijos_financieros ORDER BY dia_pago,nombre`);
    const currentPayrollData = await loadPayrollForCollectionPeriod(period, db);
    const previousPayrollData = await loadPayrollForCollectionPeriod(previousCollectionPeriod, db);
    const payroll = currentPayrollData.payroll;
    const finance = buildAutomaticFinanceSummary({
      period,
      contracts: contracts.rows,
      expenses: expenses.rows,
      payrollARS: payroll.summary.configuredPayroll,
      exchangeRateARS: exchangeRate.rounded,
    });
    const previousFinance = buildAutomaticFinanceSummary({
      period: previousCollectionPeriod,
      contracts: contracts.rows,
      expenses: expenses.rows,
      payrollARS: previousPayrollData.payroll.summary.configuredPayroll,
      exchangeRateARS: exchangeRate.rounded,
    });
    const firstBillingPeriod = "2026-09";
    const history = [];
    let cursor = firstBillingPeriod;
    while (cursor <= period && history.length < 120) {
      history.push({
        period: cursor,
        total: buildAutomaticFinanceSummary({ period: cursor, contracts: contracts.rows, expenses: [], payrollARS: 0 }).facturacion,
      });
      cursor = nextPeriod(cursor);
    }
    return {
      finance,
      previousFinance,
      exchangeRate,
      payroll: payroll.employees.map((employee) => ({ name: employee.name, total: Number(employee.total || 0) })),
      payrollPending: payroll.summary.pendingConfigurations,
      billingHistory: history,
    };
    });
    res.json(response);
  } catch (error) {
    if ([400,401,403].includes(error.status)) return res.status(error.status).json({error:error.message});
    next(error);
  }
});

router.post("/clientes/:id/abono-proximo-mes", requireRole("admin"), async (req, res, next) => {
  const administrator = captureClientCreator(req.auth);
  const client = await pool.connect();
  let discard;
  try {
    strictAgreementClientId(req.params.id);
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['importe','expected_revision'].includes(key)))throw Object.assign(new Error('Campos de abono inválidos.'),{status:400});
    const amount = strictAgreementMoney(req.body.importe,{numeric:true});
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const vigenteDesde = `${nextPeriod(current)}-01`;
    await client.query('BEGIN');
    await lockClientAdministration(client);
    const actor = await lockCurrentClientCreator(client, administrator);
    await lockClientAgreement(client, req.params.id, req.body?.expected_revision);
    const result = await client.query(`INSERT INTO cliente_abonos (cliente_id,vigente_desde,importe,creado_por) VALUES ($1,$2,$3,$4)
      ON CONFLICT (cliente_id,vigente_desde) DO UPDATE SET importe=EXCLUDED.importe,creado_por=EXCLUDED.creado_por
      RETURNING cliente_id,importe,to_char(vigente_desde,'YYYY-MM-DD') AS vigente_desde`, [req.params.id, vigenteDesde, amount, actor.nombre || actor.usuario]);
    const agreement_revision = await readClientAgreementRevision(client, req.params.id);
    await client.query('COMMIT');
    res.json({ ...result.rows[0], agreement_revision });
  } catch (error) {
    await client.query('ROLLBACK').catch(error => { discard=error; });
    if (error.status) return res.status(error.status).json({error:error.message,code:error.code});
    if (error.code === "23503") return res.status(404).json({ error: "Cliente no encontrado." }); next(error);
  } finally { client.release(discard); }
});

router.post("/usuarios", requireRole("admin"), async (req, res, next) => {
  try {
    const { usuario, nombre, rol, password, email_notificaciones } = normalizeUserCreateInput(req.body);

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await withUserAdministration(pool, req.auth, async db => {
      await assertUserLoginIdentifierAvailable(db,{next:usuario});
      return db.query(
      `INSERT INTO usuarios (usuario, nombre, rol, password_hash, email_notificaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, usuario, nombre, rol, activo, email_notificaciones, google_email,
         foto_perfil, false AS whatsapp_vinculado, created_at, ${USER_ADMIN_REVISION_SQL} AS admin_revision`,
      [usuario, nombre, rol, passwordHash, email_notificaciones],
      );
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "Ya existe ese usuario o correo para notificaciones." });
    }
    next(error);
  }
});

router.patch("/usuarios/:id/whatsapp", requireRole("admin"), async (req, res, next) => {
  try {
    const id = userAdministrationId(req.params.id), input = normalizeUserAdministrationPatch(req.body,'whatsapp',id), number = input.whatsapp;
    const hash = number ? crypto.createHash("sha256").update(number).digest("hex") : null;
    const updated = await administerUser(pool, id, input, db => db.query(`UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=$2
      WHERE id=$3 RETURNING id,usuario,nombre,rol,email_notificaciones,google_email,foto_perfil,
      (whatsapp_id_hash IS NOT NULL AND whatsapp_habilitado IS TRUE) AS whatsapp_vinculado,created_at,${USER_ADMIN_REVISION_SQL} AS admin_revision`,
    [hash, Boolean(number), id]),req.auth);
    if (!updated.rows[0]) return res.status(404).json({ error: "Usuario no encontrado." });
    return res.json(updated.rows[0]);
  } catch (error) {
    if (error instanceof UserAdministrationInputError) return next(error);
    if (error.code === "23505") return res.status(409).json({ error: "Ese WhatsApp ya está vinculado a otra persona." });
    return next(error);
  }
});

router.patch("/usuarios/:id/email-notificaciones", requireRole("admin"), async (req, res, next) => {
  try {
    const id = userAdministrationId(req.params.id), input = normalizeUserAdministrationPatch(req.body,'notices',id);

    const updated = await administerUser(pool, id, input, db => db.query(
      `UPDATE usuarios
       SET email_notificaciones = $1
       WHERE id = $2
       RETURNING id, usuario, nombre, rol, email_notificaciones, foto_perfil, created_at, ${USER_ADMIN_REVISION_SQL} AS admin_revision`,
      [input.email_notificaciones, id],
    ),req.auth);

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    if (error instanceof UserAdministrationInputError) return next(error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ese correo ya está asignado a otra persona." });
    }
    next(error);
  }
});

router.patch("/usuarios/:id/google-email", requireRole("admin"), async (req, res, next) => {
  try {
    const id = userAdministrationId(req.params.id), input = normalizeUserAdministrationPatch(req.body,'google',id);

    // Cambiar el email vinculado fuerza a re-vincular el google_id en el
    // próximo login — evita que quede un google_id viejo apuntando a una
    // cuenta de Google que ya no corresponde.
    const updated = await administerUser(pool, id, input, async (db,current) => {
      await assertUserLoginIdentifierAvailable(db,{id,next:input.google_email,previous:current.google_email});
      return db.query(
      `UPDATE usuarios
       SET google_email = $1, google_id = NULL, session_version=session_version+1
       WHERE id = $2
       RETURNING id, usuario, nombre, rol, google_email, foto_perfil, created_at, ${USER_ADMIN_REVISION_SQL} AS admin_revision`,
      [input.google_email, id],
      );
    },req.auth);

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    if (error instanceof UserAdministrationInputError) return next(error);
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

router.delete("/usuarios/:id", requireRole("admin"), (req, res) => {
  // Legacy callers must not cascade through personal lists/conversations or
  // erase an identity used by historical work. Account removal is reversible
  // deactivation through /acceso, never an implicit physical purge.
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(400).json({ error: "Usuario inválido." });
  }
  return res.status(409).json({ code: 'USER_DELETION_DISABLED',
    error: "El historial de usuarios se conserva. Desactivá su cuenta en lugar de eliminarla." });
});

router.patch("/usuarios/perfil", async (req, res, next) => {
  try {
    const { usuario_actual, password_actual, usuario_nuevo } = normalizeSelfProfileInput(req.body,'login');
    const usuarioNuevo = usuario_nuevo;

    if (!usuario_actual || !password_actual || !usuarioNuevo) {
      return res
        .status(400)
        .json({ error: "Faltan el usuario actual, la contraseña actual y el usuario nuevo." });
    }
    if (String(req.auth.usuario).toLowerCase() !== String(usuario_actual).toLowerCase()) {
      return res.status(403).json({ error: "No podés modificar otro usuario." });
    }

    const found = await pool.query(
      "SELECT id, usuario, nombre, rol, foto_perfil, password_hash FROM usuarios WHERE id=$1 AND session_version=$2 AND activo IS TRUE",
      [req.auth.id, req.auth.session_version],
    );
    if (found.rows.length === 0) {
      return res.status(401).json({ error: "La sesión cambió. Volvé a iniciar sesión." });
    }

    const usuarioDB = found.rows[0];
    const passwordValida = await bcrypt.compare(
      password_actual,
      usuarioDB.password_hash,
    );
    if (!passwordValida) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta.", code: "current_password_invalid" });
    }

    const updated = await withSelfIdentityChange(pool, req.auth, async (db,current) => {
      await assertUserLoginIdentifierAvailable(db,{id:req.auth.id,next:usuarioNuevo,previous:current.usuario});
      return db.query(
      `UPDATE usuarios
       SET usuario = $1, session_version=session_version+1
       WHERE id = $2 AND session_version=$3 AND activo IS TRUE
       RETURNING id, usuario, nombre, rol, foto_perfil, created_at`,
      [usuarioNuevo, req.auth.id, req.auth.session_version],
      );
    });
    if(!updated.rows.length)return res.status(401).json({error:"La sesión cambió. Volvé a iniciar sesión."});
    res.json(updated.rows[0]);
  } catch (error) {
    if(error.code==='23505')return res.status(409).json({error:"Ya existe un usuario con ese nombre de acceso."});
    next(error);
  }
});

router.patch("/usuarios/foto", async (req, res, next) => {
  try {
    const { usuario, foto_perfil } = normalizeSelfProfileInput(req.body,'photo');
    const foto = foto_perfil || "";

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
       WHERE id = $2 AND session_version=$3 AND activo IS TRUE
       RETURNING id, usuario, nombre, rol, foto_perfil, created_at`,
      [foto || null, req.auth.id, req.auth.session_version],
    );

    if (updated.rows.length === 0) {
      return res.status(401).json({ error: "La sesión cambió. Volvé a iniciar sesión." });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/usuarios/password", async (req, res, next) => {
  try {
    const { usuario, password_actual, password_nueva } = normalizeSelfProfileInput(req.body,'password');

    if (!usuario || !password_actual || !password_nueva) {
      return res
        .status(400)
        .json({ error: "Faltan la contraseña actual y la nueva." });
    }
    if (String(req.auth.usuario).toLowerCase() !== String(usuario).toLowerCase()) {
      return res.status(403).json({ error: "No podés modificar otro usuario." });
    }

    const found = await pool.query(
      "SELECT id, password_hash FROM usuarios WHERE id=$1 AND session_version=$2 AND activo IS TRUE",
      [req.auth.id, req.auth.session_version],
    );
    if (found.rows.length === 0) {
      return res.status(401).json({ error: "La sesión cambió. Volvé a iniciar sesión." });
    }

    const passwordValida = await bcrypt.compare(
      password_actual,
      found.rows[0].password_hash,
    );
    if (!passwordValida) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta.", code: "current_password_invalid" });
    }

    const passwordHash = await bcrypt.hash(password_nueva, 10);
    const updated=await pool.query("UPDATE usuarios SET password_hash = $1, session_version=session_version+1 WHERE id = $2 AND session_version=$3 AND activo IS TRUE RETURNING id", [
      passwordHash,
      req.auth.id,
      req.auth.session_version,
    ]);
    if(!updated.rows.length)return res.status(401).json({error:"La sesión cambió. Volvé a iniciar sesión."});
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch("/usuarios/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const id = userAdministrationId(req.params.id), input = normalizeUserAdministrationPatch(req.body,'identity',id);

    const updated = await administerUser(pool, id, input, async (db,current) => {
      await assertUserLoginIdentifierAvailable(db,{id,next:input.usuario,previous:current.usuario});
      return db.query(
      `UPDATE usuarios
       SET nombre = $1, usuario = $2, rol = $3, session_version=session_version+1
       WHERE id = $4
       RETURNING id, usuario, nombre, rol, email_notificaciones, google_email, foto_perfil, created_at, ${USER_ADMIN_REVISION_SQL} AS admin_revision`,
      [input.nombre, input.usuario, input.rol, id],
      );
    }, req.auth);

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    if (error instanceof UserAdministrationInputError) return next(error);
    if ([404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
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
    res.status(201).json(await saveClientStructure(pool, req.auth, req.body));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
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
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await savePlanningCheck(pool, req.auth, req.body));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
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
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await updateSpecialDate(pool, req.auth, req.params.id, req.body));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/clientes", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const periodo = normalizePeriod(req.query.periodo);
    res.json(await loadClientCatalogSnapshot(pool, req.auth, periodo));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/clientes", requireRole("admin"), async (req, res, next) => {
  const creator = captureClientCreator(req.auth);
  const client = await pool.connect();
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || typeof req.body.nombre !== 'string') {
      return res.status(400).json({ error: "Falta el nombre del cliente.", code: "CLIENT_CREATE_INPUT_INVALID" });
    }
    const nombre = req.body.nombre.trim();
    const esAltaCompleta = ["rubro", "vigente_desde", "dias_historias", "disenador_responsable", "abono_mensual"]
      .some((field) => Object.hasOwn(req.body, field));
    const cuota_reels = Number(req.body.cuota_reels ?? 0);
    const cuota_carruseles = Number(req.body.cuota_carruseles ?? 0);

    if (!nombre) {
      return res.status(400).json({ error: "Falta el nombre del cliente.", code: "CLIENT_CREATE_INPUT_INVALID" });
    }
    if (
      !Number.isSafeInteger(cuota_reels) ||
      !Number.isSafeInteger(cuota_carruseles) ||
      cuota_reels > 2147483647 || cuota_carruseles > 2147483647 ||
      cuota_reels < 0 ||
      cuota_carruseles < 0
    ) {
      return res.status(400).json({
        error: "cuota_reels y cuota_carruseles deben ser enteros ≥ 0.", code: "CLIENT_CREATE_INPUT_INVALID",
      });
    }

    let config = null;
    const rubro = String(req.body.rubro || "").trim();
    const vigenteDesde = normalizePeriod(req.body.vigente_desde);
    if (esAltaCompleta) {
      if (!rubro) return res.status(400).json({ error: "El rubro es obligatorio.", code: "CLIENT_CREATE_INPUT_INVALID" });
      config = normalizeClientConfiguration(req.body);
    }

    await client.query("BEGIN");
    // Share preparation/scheduler ordering: never hold a user row while
    // waiting behind client administration. Revalidate after that wait.
    await lockClientAdministration(client);
    const actor = await lockCurrentClientCreator(client, creator);
    const result = await client.query(
      `INSERT INTO clientes (nombre, cuota_reels, cuota_carruseles, rubro, activo, fecha_inicio)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING id, nombre, cuota_reels, cuota_carruseles, rubro, activo,
         to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio`,
      [nombre, cuota_reels, cuota_carruseles, esAltaCompleta ? rubro : null, esAltaCompleta ? vigenteDesde : null],
    );
    if (config) {
      await client.query(
        `INSERT INTO cliente_configuraciones
          (cliente_id, vigente_desde, cuota_reels, cuota_carruseles, dias_historias, dias_reels, dias_carruseles, disenador_responsable, abono_mensual)
         VALUES ($1, $2, $3, $4, $5::smallint[], $6::smallint[], $7::smallint[], $8, $9)`,
        [result.rows[0].id, vigenteDesde, config.cuota_reels, config.cuota_carruseles,
          config.dias_historias, config.dias_reels, config.dias_carruseles, config.disenador_responsable, config.abono_mensual],
      );
      await client.query(
        `INSERT INTO cliente_abonos (cliente_id, vigente_desde, importe, creado_por)
         VALUES ($1, $2, $3, $4) ON CONFLICT (cliente_id, vigente_desde) DO UPDATE SET importe = EXCLUDED.importe`,
        [result.rows[0].id, vigenteDesde, config.abono_mensual, actor.nombre || actor.usuario],
      );
    }
    const agreement_revision = await readClientAgreementRevision(client, result.rows[0].id);
    await client.query("COMMIT");

    res.status(201).json({
      ...result.rows[0],
      grupo_feed_id: null,
      grupo_feed_nombre: null,
      cuota_feed_reels: null,
      cuota_feed_carruseles: null,
      cuota_feed_compartida: null,
      ...(config || {}),
      configuracion_vigente_desde: config ? vigenteDesde : null,
      configuracion_completa: Boolean(config),
      agreement_revision,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ([401, 403].includes(error.status)) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe un cliente con ese nombre.", code: "CLIENT_NAME_EXISTS" });
    }
    if (/cuotas|abono mensual|día válido|diseñador responsable/i.test(error.message || "")) {
      return res.status(400).json({ error: error.message, code: "CLIENT_CREATE_INPUT_INVALID" });
    }
    next(error);
  } finally {
    client.release();
  }
});

router.post("/clientes/:id/configuraciones", requireRole("admin"), async (req, res, next) => {
  const administrator = captureClientCreator(req.auth);
  const client = await pool.connect();
  let discard;
  try {
    strictAgreementClientId(req.params.id);
    // Legacy optional weekday preferences remain compatible; blank/null money
    // or quota inputs and a silently substituted month are never valid writes.
    validateLegacyConfigurationRequest(req.body);
    const config = normalizeClientConfiguration(req.body);
    const vigenteDesde = strictAgreementPeriod(req.body.vigente_desde);
    await client.query("BEGIN");
    await lockClientAdministration(client);
    const actor = await lockCurrentClientCreator(client, administrator);
    await lockClientAgreement(client, req.params.id, req.body?.expected_revision);
    await client.query(
      `INSERT INTO cliente_configuraciones
        (cliente_id, vigente_desde, cuota_reels, cuota_carruseles, dias_historias, dias_reels, dias_carruseles, disenador_responsable, abono_mensual)
       VALUES ($1, $2, $3, $4, $5::smallint[], $6::smallint[], $7::smallint[], $8, $9)
       ON CONFLICT (cliente_id, vigente_desde) DO UPDATE SET
         cuota_reels = EXCLUDED.cuota_reels,
         cuota_carruseles = EXCLUDED.cuota_carruseles,
         dias_historias = EXCLUDED.dias_historias,
         dias_reels = EXCLUDED.dias_reels,
         dias_carruseles = EXCLUDED.dias_carruseles,
         disenador_responsable = EXCLUDED.disenador_responsable,
         abono_mensual = EXCLUDED.abono_mensual`,
      [req.params.id, vigenteDesde, config.cuota_reels, config.cuota_carruseles,
        config.dias_historias, config.dias_reels, config.dias_carruseles, config.disenador_responsable, config.abono_mensual],
    );
    await client.query(
      `INSERT INTO cliente_abonos (cliente_id, vigente_desde, importe, creado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cliente_id, vigente_desde) DO UPDATE SET
         importe = EXCLUDED.importe,
         creado_por = EXCLUDED.creado_por`,
      [req.params.id, vigenteDesde, config.abono_mensual, actor.nombre || actor.usuario],
    );
    const nombre = String(req.body.nombre || "").trim();
    const rubro = String(req.body.rubro || "").trim();
    await client.query(
      `UPDATE clientes SET cuota_reels = $1, cuota_carruseles = $2,
        nombre = CASE WHEN $3 <> '' THEN $3 ELSE nombre END,
        rubro = CASE WHEN $4 <> '' THEN $4 ELSE rubro END
       WHERE id = $5`,
      [config.cuota_reels, config.cuota_carruseles, nombre, rubro, req.params.id],
    );
    const agreement_revision = await readClientAgreementRevision(client, req.params.id);
    await client.query("COMMIT");
    res.json({
      id: Number(req.params.id), ...config,
      ...(nombre ? { nombre } : {}), ...(rubro ? { rubro } : {}),
      abono_vigente_desde: vigenteDesde,
      configuracion_vigente_desde: vigenteDesde,
      configuracion_completa: true,
      agreement_revision,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(error => { discard=error; });
    if (error.status) return res.status(error.status).json({error:error.message,code:error.code});
    if (/cuotas|abono mensual|día válido|diseñador responsable/i.test(error.message || "")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  } finally {
    client.release(discard);
  }
});

router.patch("/clientes/:id", requireRole("admin"), async (req, res, next) => {
  const administrator = captureClientCreator(req.auth);
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      nombre,
      activo,
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
    if (activo !== undefined && typeof activo !== "boolean") {
      return res.status(400).json({ error: "El estado activo debe ser verdadero o falso." });
    }

    await client.query("BEGIN");
    await lockClientAdministration(client);
    await lockCurrentClientCreator(client, administrator);
    const existente = await lockClientAgreement(client, id, req.body?.expected_revision);
    const grupoFeedId = existente.grupo_feed_id;
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
         activo = COALESCE($2, activo),
         fecha_fin = CASE
           WHEN $2::boolean = FALSE THEN COALESCE(fecha_fin, CURRENT_DATE)
           WHEN $2::boolean = TRUE THEN NULL
           ELSE fecha_fin
         END,
         cuota_reels = COALESCE($3, cuota_reels),
         cuota_carruseles = COALESCE($4, cuota_carruseles)
       WHERE id = $5`,
      [
        nombreNormalizado ?? null,
        activo ?? null,
        cuota_reels ?? null,
        cuota_carruseles ?? null,
        id,
      ],
    );
    const result = await client.query(
      `SELECT
         c.id,
         c.nombre,
         c.activo,
         ${clientAgreementRevisionSql('c','gf')} AS agreement_revision,
         to_char(c.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
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
    if (error.status) return res.status(error.status).json({error:error.message,code:error.code});
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
    res.json(await deleteEmptyClient(pool, req.params.id, req.body?.expected_revision, req.auth));
  } catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error:error.message,code:error.code });
    next(error);
  }
});

function editorialPieceApiError(error,res,next) {
  if ([400,401,403,404,409,413,428].includes(error.status)) return res.status(error.status).json({error:error.message});
  return next(error);
}

router.patch("/historias/:id", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    return res.json(await writeEditorialPiece(pool,req.auth,'historia',req.params.id,req.body));
  } catch (error) { return editorialPieceApiError(error,res,next); }
});

router.delete("/historias/:id", requireRole("admin"), (_req, res) => {
  res.set('Cache-Control','no-store');
  return res.status(410).json({error:'El borrado definitivo está deshabilitado. Archivá la pieza para conservar su trabajo e historial.'});
});

router.get("/historias", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await loadEditorialCatalogSnapshot(pool, req.auth, 'historia'));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch("/publicaciones/:id", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    return res.json(await writeEditorialPiece(pool,req.auth,'publicacion',req.params.id,req.body));
  } catch (error) { return editorialPieceApiError(error,res,next); }
});

router.delete("/publicaciones/:id", requireRole("admin"), (_req, res) => {
  res.set('Cache-Control','no-store');
  return res.status(410).json({error:'El borrado definitivo está deshabilitado. Archivá la pieza para conservar su trabajo e historial.'});
});

router.post("/calendario-editorial/generar", requireRole("admin"), async (req, res, next) => {
  try {
    res.json(await reconcileEditorialCalendar(pool, req.body.periodo, {actor:req.auth}));
  } catch (error) {
    if (/período|capacidad/i.test(error.message || "")) return res.status(400).json({ error: error.message });
    next(error);
  }
});

router.get("/publicaciones", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const incluirArchivadas = req.query.incluir_archivadas === "true";
    res.json(await loadEditorialCatalogSnapshot(pool, req.auth, 'publicacion', { includeArchived: incluirArchivadas }));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/publicaciones/:id/tareas", async (req, res, next) => {
  try {
    const access = buildTaskReadAccessClause(req.auth, "t", "$2", "render_os");
    const params = [req.params.id];
    if (access.value) params.push(access.value);
    const result = await pool.query(
      `SELECT t.id,t.titulo,t.estado,t.asignado_a,t.tipo_tarea,t.subtipo,
        to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento
       FROM tareas t
       WHERE t.publicacion_id=$1
         AND t.propiedades_extra->>'workspace'='render_os'
         AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
         AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'${access.sql}
       ORDER BY CASE t.estado
         WHEN 'en_revision' THEN 0 WHEN 'bloqueada' THEN 1 WHEN 'en_progreso' THEN 2
         WHEN 'pendiente' THEN 3 WHEN 'publicada' THEN 4 ELSE 5 END,
         t.fecha_vencimiento ASC NULLS LAST,t.id ASC`,
      params,
    );
    res.json((await annotateTaskAssignments(pool, result.rows)).map((row) => taskOperationalDto(row, req.auth)));
  } catch (error) {
    next(error);
  }
});

router.post("/tareas", async (req, res, next) => {
  try {
    const assignmentNotificationActor = Object.freeze({ id: req.auth.id, rol: req.auth.rol, session_version: req.auth.session_version });
    try { assertTaskBusinessInput(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
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

    if (req.auth?.rol !== "admin" && workspace !== "render_os") {
      return res.status(403).json({ error: "Solo podés crear tareas dentro de RENDER OS." });
    }

    if (!titulo || (!asignado_a && !req.body.asignado_a_id)) {
      return res.status(400).json({ error: "Faltan título o asignado_a." });
    }
    const assignment = await resolveTaskAssignments(pool, {
      ...req.body, colaboradores,
    });
    if (tipo_tarea && !TIPOS_TAREA_VALIDOS.includes(tipo_tarea)) {
      return res.status(400).json({ error: "Sector (tipo_tarea) inválido." });
    }
    if (prioridad && !PRIORIDADES_TAREA_VALIDAS.includes(prioridad)) {
      return res.status(400).json({ error: "Prioridad inválida." });
    }

    const estadoFinal = ESTADOS_TAREA_VALIDOS.includes(normalizeTaskState(estado))
      ? normalizeTaskState(estado)
      : "pendiente";
    if (workspace === "render_os" && estado === "programada") {
      return res.status(400).json({ error: "El estado Programada ya no forma parte del flujo de tareas." });
    }
    if (["aprobada", "finalizada"].includes(estadoFinal)) {
      return res.status(400).json({ error: "Creá la tarea pendiente; la aprobación y finalización requieren su recorrido de trabajo." });
    }

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
    propiedadesExtra.colaboradores = assignment.collaboratorNames;
    if (workspace === "render_os") {
      propiedadesExtra.workspace = "render_os";
      if (estadoFinal === "publicada") propiedadesExtra.finalizada_at = new Date().toISOString();
    }
    const nuevaTarea = { titulo, subtipo, tipo_tarea, propiedades_extra: propiedadesExtra };
    if (isProductionVisitTask(nuevaTarea)) {
      const planned = Number(produccion_videos_previstos);
      if (produccion_videos_previstos != null && produccion_videos_previstos !== "" && (!Number.isInteger(planned) || planned <= 0)) {
        return res.status(400).json({ error: "Los videos previstos deben ser un entero mayor que cero, o dejarse sin definir." });
      }
      if (planned > 0) propiedadesExtra.produccion_videos_previstos = planned;
      propiedadesExtra.produccion_registros = [];
    }

    const result = await persistAssignedTask(pool,
      `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, revision, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id, created_at, updated_at`,
      [
        titulo,
        assignment.ownerName,
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
      ], assignment, (db, task) => syncProductionVisitFromTask(db, task, req.auth.id), null,
      { assignmentNotificationActor, assignmentNotificationMode: 'created' },
    );

    const tareaCreada = result.rows[0];
    res.status(201).json(taskOperationalDto(tareaCreada, req.auth));
    if (result.assignmentNotification?.destinatarioIds.length) {
      notificarAsignacionSinInterrumpir({
        pool,
        ...result.assignmentNotification,
        motivo: "creada",
      });
    }
  } catch (error) {
    if ([400, 401, 403, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

const ESTADOS_TAREA_VALIDOS = [
  "pendiente",
  "en_progreso",
  "en_revision",
  "aprobada",
  "finalizada",
];
const TIPOS_TAREA_VALIDOS = [
  "diseno",
  "edicion",
  "produccion",
  "community",
  "administracion",
  "desarrollo",
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

router.patch("/tareas/:id", async (req, res, next) => {
  try {
    const assignmentNotificationActor = Object.freeze({ id: req.auth.id, rol: req.auth.rol, session_version: req.auth.session_version });
    try { assertTaskBusinessInput(req.body); assertTaskCoordinationPatch(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const { id } = req.params;
    const body = req.body;
    const expectedEditingDelivery = normalizeExpectedEditingDelivery(body.expected_entrega_id);
    if (expectedEditingDelivery && body.estado !== 'aprobada') return res.status(400).json({ error: "La entrega observada solo se usa al aprobar." });
    const stateOnlyRequest = Object.keys(body).every((key) => ["estado", "expected_updated_at", "expected_revision", "expected_entrega_id"].includes(key));
    let estadoAnterior = null;
    let tareaAnteriorCompleta = null;
    let esRenderOS = req.query.workspace === "render_os";
    let assignment;
    if (Object.hasOwn(body, "expected_revision") && (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1)) {
      return res.status(400).json({ error: "La revisión de la tarea no es válida." });
    }

    if (req.auth.rol !== "admin" && !canEmployeePatchTask(body, { workspace: esRenderOS ? "render_os" : "historical", role: req.auth.rol })) {
      return res.status(403).json({ error: "Solo podés actualizar el estado de tus tareas." });
    }
    if (body.propiedades_extra && typeof body.propiedades_extra === "object") {
      body.propiedades_extra = { ...body.propiedades_extra };
      // Approval evidence is emitted only by verified server transitions.
      for (const key of ["revision_aprobada", "revision_aprobada_por", "revision_aprobada_por_id", "revision_aprobada_at", "finalizada_at"]) {
        delete body.propiedades_extra[key];
      }
    }

    const changesPeople = ["asignado_a", "asignado_a_id", "colaborador_ids"].some(key => Object.hasOwn(body, key))
      || Object.hasOwn(body.propiedades_extra || {}, "colaboradores");
    if (changesPeople) {
      if (!body.expected_updated_at || !body.expected_revision) {
        return res.status(400).json({ error: "Recargá la tarea antes de cambiar sus responsables: falta la versión de edición." });
      }
      // Resolve existing access before validating requested recipients. Names
      // remain labels; they never establish the caller's authority.
      const access = buildTaskAccessClause(req.auth, "t", "$2");
      const current = await pool.query(`SELECT t.id,t.asignado_a,t.propiedades_extra
        FROM tareas t WHERE t.id=$1${access.sql}`, access.value ? [id, access.value] : [id]);
      if (!current.rows.length) return res.status(404).json({ error: "Tarea no encontrada." });
      const [assigned] = await annotateTaskAssignments(pool, current.rows);
      const previousLabels = assigned.propiedades_extra?.colaboradores || [];
      const collaboratorLabelsChanged = Object.hasOwn(body.propiedades_extra || {}, "colaboradores")
        && JSON.stringify(body.propiedades_extra.colaboradores) !== JSON.stringify(previousLabels);
      const actualAssignmentChange = Object.hasOwn(body, "asignado_a_id") || Object.hasOwn(body, "colaborador_ids")
        || (Object.hasOwn(body, "asignado_a") && body.asignado_a !== assigned.asignado_a) || collaboratorLabelsChanged;
      // Old forms may echo unchanged labels alongside a text edit. They must
      // neither backfill history nor re-resolve homonymous users by name.
      if (actualAssignmentChange) {
      const explicitOwner = Object.hasOwn(body, "asignado_a") || Object.hasOwn(body, "asignado_a_id");
      if (!explicitOwner && !assigned.asignado_a_id) {
        return res.status(409).json({ error: "Esta tarea histórica necesita un responsable verificado antes de cambiar colaboradores." });
      }
      const owner = Object.hasOwn(body, "asignado_a_id") ? { asignado_a_id: body.asignado_a_id }
        : Object.hasOwn(body, "asignado_a") && body.asignado_a !== assigned.asignado_a ? { asignado_a: body.asignado_a }
        : assigned.asignado_a_id ? { asignado_a_id: assigned.asignado_a_id } : { asignado_a: body.asignado_a };
      const collaborators = Object.hasOwn(body, "colaborador_ids") ? { colaborador_ids: body.colaborador_ids }
        : collaboratorLabelsChanged ? { colaboradores: body.propiedades_extra.colaboradores }
        : { colaborador_ids: assigned.colaborador_ids };
      assignment = await resolveTaskAssignments(pool, { ...owner, ...collaborators });
      body.asignado_a = assignment.ownerName;
      body.propiedades_extra = { ...(body.propiedades_extra || {}), colaboradores: assignment.collaboratorNames };
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "estado")) {
      body.estado = normalizeTaskState(body.estado);
      if (body.estado === null || !ESTADOS_TAREA_VALIDOS.includes(body.estado)) {
        return res.status(400).json({ error: "Estado inválido." });
      }
      if (esRenderOS && body.estado === "programada") {
        return res.status(400).json({ error: "El estado Programada ya no forma parte del flujo de tareas." });
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
      // Stored scope, not a caller-controlled query parameter, selects business guards.
      if (tareaAnteriorCompleta?.propiedades_extra?.workspace === "render_os") esRenderOS = true;
      estadoAnterior = tareaAnterior.rows[0]?.estado || null;
    }
    if (
      esRenderOS &&
      Object.prototype.hasOwnProperty.call(body, "estado") &&
      (body.estado === "finalizada" || isTaskFinalized({ estado: estadoAnterior })) &&
      !isTaskFinalizer(req.auth) &&
      !(req.auth.rol === "produccion" && tareaAnteriorCompleta?.tipo_tarea === "produccion")
    ) {
      return res.status(403).json({ error: body.estado === "finalizada"
        ? "No tenés permiso para completar esta tarea."
        : "No tenés permiso para reabrir esta tarea completada." });
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
      if (isProductionVisitTask(visitaParaEntregar) && !visitaParaEntregar.propiedades_extra?.produccion_confirmada_at) {
        return res.status(400).json({ error: "La grabación completa debe ser confirmada por Franco o Agustín antes de enviarla a edición." });
      }
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
    const produccionPuedeCompletarPropia = req.auth.rol === "produccion"
      && tareaAnteriorCompleta?.tipo_tarea === "produccion";
    if (esRenderOS && body.estado === "finalizada") {
      const visita = await pool.query(
        `SELECT titulo, subtipo, tipo_tarea, propiedades_extra
         FROM tareas
         WHERE id = $1 AND propiedades_extra->>'workspace' = 'render_os'`,
        [id],
      );
      if (visita.rows[0] && isProductionVisitTask(visita.rows[0])) {
        const progress = getProductionProgress(visita.rows[0]);
        if (!isProductionComplete(visita.rows[0])) {
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

    if ((esRenderOS || tareaAnteriorCompleta?.propiedades_extra?.workspace === "render_os")
      && Object.prototype.hasOwnProperty.call(body, "estado") && tareaAnteriorCompleta) {
      if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1) {
        return res.status(400).json({ error: "Recargá la tarea: falta su revisión actual para cambiar el estado." });
      }
      const transition = taskTransitionError(tareaAnteriorCompleta, body.estado, req.auth);
      if (transition) return res.status(transition.status).json({ error: transition.error });
      if (body.estado === "aprobada" && estadoAnterior !== "aprobada") {
        body.propiedades_extra = { ...(body.propiedades_extra || {}), revision_aprobada: true,
          revision_aprobada_entrega_id: expectedEditingDelivery,
          revision_aprobada_por_id: req.auth.id, revision_aprobada_por: getTaskActor(req.auth),
          revision_aprobada_at: new Date().toISOString() };
      } else if (["pendiente", "en_progreso", "en_revision"].includes(body.estado) && body.estado !== estadoAnterior) {
        body.propiedades_extra = { ...(body.propiedades_extra || {}), revision_aprobada: false,
          revision_aprobada_por_id: null, revision_aprobada_por: null, revision_aprobada_at: null };
      }
      const nextTask = {
        ...tareaAnteriorCompleta,
        ...body,
        propiedades_extra: {
          ...(tareaAnteriorCompleta.propiedades_extra || {}),
          ...(body.propiedades_extra || {}),
          workspace: "render_os",
        },
      };
      const pendingEvent = buildMiaStatePendingMarker(nextTask, estadoAnterior);
      if (pendingEvent) {
        body.propiedades_extra = {
          ...(body.propiedades_extra || {}),
          mia_notificacion_pendiente: pendingEvent,
        };
      }
      if (body.estado === "finalizada" && !isTaskFinalized({ estado: estadoAnterior })) {
        body.propiedades_extra = { ...(body.propiedades_extra || {}), finalizada_at: new Date().toISOString() };
      } else if (isTaskFinalized({ estado: estadoAnterior }) && body.estado !== "finalizada") {
        body.propiedades_extra = { ...(body.propiedades_extra || {}), finalizada_at: null };
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
    if (body.expected_revision) {
      i++;
      where += ` AND t.revision = $${i}::integer`;
      valores.push(body.expected_revision);
    }

    const movimientoGlobalFinalizador = esRenderOS
      && isTaskFinalizer(req.auth)
      && stateOnlyRequest;
    const acceso = movimientoGlobalFinalizador
      ? { sql: "", value: null }
      : buildTaskAccessClause(req.auth, "t", `$${i + 1}`);
    where += acceso.sql;
    if (acceso.value) {
      i++;
      valores.push(acceso.value);
    }

    const result = await persistAssignedTask(pool,
      `UPDATE tareas AS t SET ${sets.join(", ")}
       WHERE ${where}
       RETURNING id, revision, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia, tarea_padre_id, created_at, updated_at`,
      valores, assignment, async (db, task) => {
        if (body.estado === 'aprobada' && estadoAnterior !== 'aprobada') {
          const deliveryId = await assertEditingApprovalDelivery(db, task, expectedEditingDelivery);
          if (deliveryId) await recordEditingApproval(db, task, req.auth, deliveryId);
        }
        await syncProductionVisitFromTask(db, task, req.auth.id);
      }, body.estado === 'aprobada' && estadoAnterior !== 'aprobada' ? db => assertCurrentEditingApprover(db, req.auth) : null,
      assignment ? { assignmentNotificationActor, assignmentNotificationTaskId: Number(id) } : {},
    );

    if (result.rows.length === 0) {
      if (body.expected_updated_at || body.expected_revision) {
        const accesoExistente = movimientoGlobalFinalizador
          ? { sql: "", value: null }
          : buildTaskAccessClause(req.auth, "t", "$2");
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
    await publishPieceLinkedToCompletedTask(pool, tareaActualizada);
    res.json(taskOperationalDto(tareaActualizada, req.auth));

    const actor = getTaskActor(req.auth);

    if (result.assignmentNotification?.destinatarioIds.length) {
      notificarAsignacionSinInterrumpir({
        pool,
        ...result.assignmentNotification,
        motivo: "reasignada",
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
  } catch (error) {
    if ([400, 401, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/tareas/:id/aprobar-publicacion", async (req, res, next) => {
  try {
    const expectedEditingDelivery = normalizeExpectedEditingDelivery(req.body?.expected_entrega_id);
    if (!isTaskLeader(req.auth)) {
      return res.status(403).json({ error: "Solo Franco o Agustín pueden aprobar una tarea para publicación." });
    }
    if (!Number.isSafeInteger(req.body?.expected_revision) || req.body.expected_revision < 1) {
      return res.status(400).json({ error: "Recargá la tarea antes de aprobar: falta su revisión actual." });
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
    if (["aprobada", "finalizada", "publicada"].includes(tarea.estado)) {
      return res.status(409).json({ error: "El trabajo ya fue aprobado o finalizado." });
    }
    if (tarea.estado !== "en_revision") {
      return res.status(400).json({ error: "Solo se puede aprobar trabajo que esté Para revisar." });
    }
    if (tarea.propiedades_extra?.revision_aprobada === true) {
      return res.status(409).json({ error: "Esta tarea ya fue aprobada y asignada para publicación." });
    }
    const actor = getTaskActor(req.auth);
    const requestedPublisherId = req.body?.responsable_publicacion_id;
    const requestedPublisher = String(req.body?.responsable_publicacion || "").trim();
    if (requestedPublisherId !== undefined && (!Number.isSafeInteger(requestedPublisherId) || requestedPublisherId < 1)) {
      return res.status(400).json({ error: "Elegí una persona válida para publicar." });
    }
    const publisherResult = await pool.query(
      "SELECT id,nombre FROM usuarios WHERE (id=$1 OR ($1 IS NULL AND nombre=$2)) AND activo=TRUE AND rol IN ('admin', 'community')",
      [requestedPublisherId ?? null, requestedPublisher],
    );
    if (publisherResult.rows.length !== 1) return res.status(400).json({ error: "Elegí una persona de Community o un Líder para publicar." });
    const publisher = publisherResult.rows[0].nombre;
    const [previousAssignment] = await annotateTaskAssignments(pool, [tarea]);
    const approvedAssignment = await resolveTaskAssignments(pool, {
      asignado_a_id: publisherResult.rows[0].id,
      colaborador_ids: [...new Set([...previousAssignment.colaborador_ids, ...(previousAssignment.asignado_a_id ? [previousAssignment.asignado_a_id] : [])])],
    });
    const result = await persistAssignedTask(pool,
      `UPDATE tareas
       SET asignado_a = $3,
           estado = 'aprobada',
           propiedades_extra = propiedades_extra || $2::jsonb,
           updated_at = now()
       WHERE id = $1
         AND propiedades_extra->>'workspace' = 'render_os'
         AND estado = 'en_revision'
         AND revision = $4::integer
         AND propiedades_extra->>'revision_aprobada' IS DISTINCT FROM 'true'
       RETURNING id, revision, titulo, asignado_a, cliente_id, estado, requiere_aprobacion,
         propiedades_extra, to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
         historia_id, publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones,
         material_referencia, tarea_padre_id, created_at, updated_at`,
      [req.params.id, JSON.stringify({ revision_aprobada: true, revision_aprobada_por: actor, revision_aprobada_por_id: req.auth.id,
        revision_aprobada_at: new Date().toISOString(), revision_aprobada_entrega_id: expectedEditingDelivery, edicion_responsable: tarea.propiedades_extra?.edicion_responsable || tarea.asignado_a,
        edicion_responsable_id: tarea.propiedades_extra?.edicion_responsable_id || previousAssignment.asignado_a_id,
        responsable_publicacion: publisher, responsable_publicacion_id: publisherResult.rows[0].id,
        colaboradores: approvedAssignment.collaboratorNames, workspace: "render_os" }), publisher, req.body.expected_revision], approvedAssignment,
      async (db, task) => {
        const deliveryId = await assertEditingApprovalDelivery(db, task, expectedEditingDelivery);
        if (deliveryId) await recordEditingApproval(db, task, req.auth, deliveryId);
      }, db => assertCurrentEditingApprover(db, req.auth),
    );
    if (!result.rows[0]) return res.status(409).json({ error: "La tarea ya fue aprobada o cambió de estado." });
    const aprobada = result.rows[0];
    res.json(taskOperationalDto(aprobada, req.auth));
    notificarAsignacionSinInterrumpir({
      pool,
      tarea: aprobada,
      motivo: "aprobada",
      nombresDestinatarios: [publisher],
      actor,
      detalle: `${actor} aprobó el material. ${publisher} puede programarlo o publicarlo.`,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/tareas/:id/produccion/registros", async (req, res, next) => {
  if (!canRecordProduction(req.auth)) {
    return res.status(403).json({ error: "Necesitás una cuenta activa verificada para registrar una visita." });
  }
  if (!Number.isSafeInteger(req.body.expected_revision) || req.body.expected_revision < 1) {
    return res.status(400).json({ error: "Recargá la visita: falta su revisión actual." });
  }
  const amount = req.body.cantidad;
  const date = req.body.fecha;
  const finished = req.body.finalizar === true;
  if (!Number.isSafeInteger(amount) || amount < 0 || (amount === 0 && !finished)) {
    return res.status(400).json({ error: "La cantidad debe ser un número entero mayor que cero." });
  }
  if (typeof date !== "string" || !isValidProductionDate(date)) {
    return res.status(400).json({ error: "La fecha de grabación no es válida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const params = [req.params.id];
    const access = buildTaskAccessClause(req.auth, "t", "$2");
    if (access.value) params.push(access.value);
    const currentResult = await client.query(
      `SELECT t.id, t.revision, t.titulo, t.asignado_a, t.cliente_id, t.estado, t.requiere_aprobacion,
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
    if (task.revision !== req.body.expected_revision
      || (req.body.expected_updated_at && new Date(task.updated_at).getTime() !== new Date(req.body.expected_updated_at).getTime())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La tarea cambió mientras registrabas los videos. Revisá la última versión." });
    }
    await rejectMixedProductionRecording(client, task.id);
    const progress = getProductionProgress(task);
    if (task.propiedades_extra?.produccion_confirmada_at || isProductionComplete(task)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La visita ya está terminada. Revisá sus registros antes de agregar videos." });
    }
    if (progress.recorded + amount <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Indicá cuántos videos grabaste antes de terminar la visita." });
    }
    const records = Array.isArray(task.propiedades_extra?.produccion_registros)
      ? task.propiedades_extra.produccion_registros
      : [];
    const record = {
      id: crypto.randomUUID(),
      cantidad: amount,
      fecha: date,
      usuario: getTaskActor(req.auth),
      usuario_id: req.auth.id,
      created_at: new Date().toISOString(),
      periodo_objetivo: date.slice(0, 7),
    };
    const regularAmount = progress.planned > 0 ? Math.min(amount, progress.remaining) : amount;
    const advanceAmount = amount - regularAmount;
    if (advanceAmount > 0) {
      record.cantidad_mes_actual = regularAmount;
      record.cantidad_adelanto = advanceAmount;
      record.periodo_adelanto = nextProductionPeriod(date);
    }
    const completed = finished || (progress.planned > 0 && progress.recorded + amount >= progress.planned);
    const nextState = getProductionTaskState({ planned: progress.planned, recorded: progress.recorded + amount, finished });
    const workflowProperties = completed ? {
      produccion_finalizada_at: new Date().toISOString(),
      produccion_finalizada_por: getTaskActor(req.auth),
      produccion_esperando_confirmacion: true,
      produccion_confirmada_at: null,
      produccion_confirmada_por: null,
      mia_notificacion_pendiente: {
        tipo: "confirmar_grabacion",
        creado_en: new Date().toISOString(),
        destinatarios: ["Franco", "Agustín"],
      },
    } : {
      mia_notificacion_pendiente: {
        tipo: "avance_grabacion",
        creado_en: new Date().toISOString(),
        cantidad: amount,
      },
    };
    const updated = await client.query(
      `UPDATE tareas
       SET estado = $3, propiedades_extra = propiedades_extra || $2::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, revision, titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra,
                 to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento, historia_id,
                 publicacion_id, tipo_tarea, subtipo, prioridad, aclaraciones, material_referencia,
                 tarea_padre_id, created_at, updated_at`,
      [task.id, JSON.stringify({ produccion_registros: amount > 0 ? [...records, record] : records, ...workflowProperties, workspace: "render_os" }), nextState],
    );
    const [saved] = await annotateTaskAssignments(client, updated.rows);
    await client.query("COMMIT");
    return res.status(201).json(taskOperationalDto(saved, req.auth));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

async function confirmProductionVisit(taskId, actor, { db = null, expectedRevision, actorId } = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw Object.assign(new Error("Recargá la visita: falta su revisión actual para confirmar."), { status: 400 });
  }
  const ownsTransaction = !db;
  const client = db || await pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const current = await client.query(
      `SELECT id,revision,titulo,asignado_a,cliente_id,estado,propiedades_extra,
        to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,
        prioridad,aclaraciones,material_referencia,tarea_padre_id,updated_at
       FROM tareas WHERE id=$1 AND propiedades_extra->>'workspace'='render_os' FOR UPDATE`,
      [taskId],
    );
    const task = current.rows[0];
    if (!task) { const error = new Error("Visita no encontrada."); error.status = 404; throw error; }
    if (task.revision !== expectedRevision) {
      throw Object.assign(new Error("La visita cambió. Revisá la última versión antes de confirmar."), { status: 409 });
    }
    if (!isProductionVisitTask(task)) { const error = new Error("Esta tarea no es una visita de producción."); error.status = 400; throw error; }
    await rejectMixedProductionRecording(client, task.id);
    const validation = validateProductionHandoff(task);
    if (validation) { const error = new Error(validation); error.status = 400; throw error; }
    if (task.propiedades_extra?.produccion_confirmada_at) {
      const error = new Error(`La grabación ya fue confirmada por ${task.propiedades_extra.produccion_confirmada_por || "un Líder"}.`); error.status = 409; throw error;
    }
    const properties = {
      ...task.propiedades_extra,
      produccion_esperando_confirmacion: false,
      produccion_confirmada_por: actor,
      produccion_confirmada_por_id: actorId,
      produccion_confirmada_at: new Date().toISOString(),
      mia_notificacion_pendiente: null,
      workspace: "render_os",
    };
    const updated = await client.query(
      `UPDATE tareas SET estado='en_revision',propiedades_extra=$2::jsonb,updated_at=now()
       WHERE id=$1 RETURNING id,revision,titulo,asignado_a,cliente_id,estado,propiedades_extra,
       to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,
       prioridad,aclaraciones,material_referencia,tarea_padre_id,created_at,updated_at`,
      [task.id, JSON.stringify(properties)],
    );
    const [saved] = await annotateTaskAssignments(client, updated.rows);
    if (ownsTransaction) await client.query("COMMIT");
    // Confirmation records filming evidence only. Editors and deadlines are
    // selected explicitly for each identified video in the shared registry.
    // Keep the compatibility response shape, never create an aggregate task.
    return { task: saved, editing_task: null, created: false };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { if (ownsTransaction) client.release(); }
}

router.post("/tareas/:id/produccion/confirmar", async (req, res, next) => {
  if (!isTaskLeader(req.auth)) return res.status(403).json({ error: "Solo Franco o Agustín pueden confirmar una grabación completa." });
  if (req.query.workspace !== "render_os") return res.status(400).json({ error: "Esta acción solo está disponible en RENDER OS." });
  try {
    const confirmed = await confirmProductionVisit(req.params.id, getTaskActor(req.auth), {
      expectedRevision: req.body.expected_revision, actorId: req.auth.id,
    });
    return res.json({ ...confirmed, task: taskOperationalDto(confirmed.task, req.auth),
      editing_task: confirmed.editing_task ? taskOperationalDto(confirmed.editing_task, req.auth) : null });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.patch("/tareas/:id/produccion/registros/:recordId", async (req, res, next) => {
  if (!canRecordProduction(req.auth)) return res.status(403).json({ error: "Necesitás una cuenta activa verificada para corregir una visita." });
  if (req.query.workspace !== "render_os") return res.status(400).json({ error: "Esta acción solo está disponible en RENDER OS." });
  if (!Number.isSafeInteger(req.body.expected_revision) || req.body.expected_revision < 1) {
    return res.status(400).json({ error: "Recargá la visita: falta su revisión actual para corregir." });
  }
  const amount = req.body.cantidad;
  if (!Number.isSafeInteger(amount) || amount <= 0) return res.status(400).json({ error: "La cantidad debe ser un entero mayor que cero." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = buildTaskAccessClause(req.auth, "t", "$2");
    const params = [req.params.id];
    if (access.value) params.push(access.value);
    const current = await client.query(
      `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.cliente_id,t.estado,t.tipo_tarea,t.subtipo,t.propiedades_extra,t.updated_at
       FROM tareas t WHERE t.id=$1 AND t.propiedades_extra->>'workspace'='render_os'${access.sql} FOR UPDATE`, params,
    );
    const task = current.rows[0];
    if (!task || !isProductionVisitTask(task)) throw Object.assign(new Error("Visita no encontrada o no asignada a tu cuenta."), { status: 404 });
    if (task.revision !== req.body.expected_revision) throw Object.assign(new Error("La visita cambió. Revisá sus registros antes de corregir."), { status: 409 });
    await rejectMixedProductionRecording(client, task.id);
    const { records: corrected, previous } = correctProductionRecord(task, {
      recordId: req.params.recordId, amount, actorName: getTaskActor(req.auth), actorId: req.auth.id, now: new Date(),
    });
    const planned = getProductionProgress(task).planned;
    const recorded = getProductionProgress({ propiedades_extra: { produccion_registros: corrected } }).recorded;
    const nextState = getProductionTaskState({ planned, recorded });
    const transition = taskTransitionError(task, nextState, req.auth);
    if (transition) throw Object.assign(new Error(transition.error), { status: transition.status });
    const properties = {
      ...task.propiedades_extra,
      produccion_registros: corrected,
      produccion_esperando_confirmacion: nextState === "en_revision",
      produccion_finalizada_at: nextState === "en_revision" ? new Date().toISOString() : null,
      produccion_confirmada_at: null,
      produccion_confirmada_por: null,
      produccion_confirmada_por_id: null,
      revision_aprobada: false,
      revision_aprobada_por: null,
      revision_aprobada_por_id: null,
      revision_aprobada_at: null,
      finalizada_at: null,
      mia_notificacion_pendiente: { tipo: "correccion_grabacion", anterior: previous, nuevo: amount, creado_en: new Date().toISOString() },
      workspace: "render_os",
    };
    const updated = await client.query(
      `UPDATE tareas SET estado=$3,propiedades_extra=$2::jsonb,updated_at=now() WHERE id=$1
       RETURNING id,revision,titulo,asignado_a,cliente_id,estado,propiedades_extra,
       to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,
       prioridad,aclaraciones,material_referencia,tarea_padre_id,created_at,updated_at`,
      [task.id, JSON.stringify(properties), nextState],
    );
    const [saved] = await annotateTaskAssignments(client, updated.rows);
    await client.query("COMMIT");
    return res.json(taskOperationalDto(saved, req.auth));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  } finally { client.release(); }
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
    if (error.code === "23503") return res.status(409).json({ error: "La tarea tiene registros vinculados. Conservá su historial; no se puede eliminar." });
    next(error);
  }
});

router.post("/tareas/acciones-masivas", async (req, res, next) => {
  try {
    if (req.query.workspace !== "render_os") {
      return res.status(400).json({ error: "Esta acción solo está disponible en RENDER OS." });
    }
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0))];
    const action = String(req.body?.accion || "");
    if (ids.length === 0) return res.status(400).json({ error: "Seleccioná al menos una tarea." });
    if (ids.length > 250) return res.status(400).json({ error: "Podés modificar hasta 250 tareas por vez." });
    if (!["papelera", "restaurar"].includes(action)) {
      return res.status(400).json({ error: "Acción masiva inválida." });
    }
    const actor = getTaskActor(req.auth) || "Equipo RENDER";
    const access = buildTaskAccessClause(req.auth, "t", "$3");
    const metadata = action === "papelera"
        ? { archivada_render_os: true, papelera_render_os: true, papelera_por: actor, papelera_at: new Date().toISOString() }
        : { archivada_render_os: false, papelera_render_os: false, restaurada_por: actor, restaurada_at: new Date().toISOString() };
    const params = [ids, JSON.stringify(metadata)];
    if (access.value) params.push(access.value);
    const result = await pool.query(
      `WITH accesibles AS (
         SELECT t.id
         FROM tareas AS t
         WHERE t.id = ANY($1::bigint[])
           AND t.propiedades_extra->>'workspace' = 'render_os'${access.sql}
       ), autorizadas AS (
         SELECT id FROM accesibles
         WHERE (SELECT count(*) FROM accesibles) = cardinality($1::bigint[])
       )
       UPDATE tareas AS t
       SET propiedades_extra = t.propiedades_extra || $2::jsonb, updated_at = now()
       FROM autorizadas AS a
       WHERE t.id = a.id
       RETURNING t.id`,
      params,
    );
    if (result.rowCount !== ids.length) {
      return res.status(403).json({ error: "Solo podés eliminar o restaurar tareas propias o donde colaborás." });
    }
    return res.json({ ok: true, accion: action, ids: result.rows.map((row) => Number(row.id)), cantidad: result.rowCount });
  } catch (error) {
    return next(error);
  }
});

router.get("/tareas", async (req, res, next) => {
  try {
    const orderRead = parseTaskOrderRead(req.query);
    const reviewRead = parseTaskReviewRead(req.query);
    const taskStates = parseTaskStateRead(req.query.estado);
    if (reviewRead?.scope === 'team' && req.auth.rol !== 'admin') {
      return res.status(403).json({ error: 'La cola de revisión del equipo requiere administración.' });
    }
    const {
      asignado_a,
      asignado_a_id,
      tipo_tarea,
      historia_id,
      publicacion_id,
      cliente_id,
      prioridad,
      incluir_archivadas,
      solo_archivadas,
      papelera,
      limit,
      offset,
      workspace,
      q,
      area,
    } = req.query;

    let limite, desplazamiento;
    try { ({ limit: limite, offset: desplazamiento } = parseTaskPagination(req.query)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (asignado_a_id !== undefined && (typeof asignado_a_id !== "string" || !/^[1-9]\d*$/.test(asignado_a_id)
      || !Number.isSafeInteger(Number(asignado_a_id)) || Number(asignado_a_id) > 2147483647)) {
      return res.status(400).json({ error: "Filtro de responsable inválido." });
    }

    let query = `
      SELECT
        t.id,
        t.revision,
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

    if (reviewRead) {
      const review = buildTaskReviewClause({ scope: reviewRead.scope, auth: req.auth,
        taskAlias: 't', clientAlias: 'c', placeholder: `$${paramCount}` });
      query += review.sql;
      if (review.value !== null) { params.push(review.value); paramCount++; }
    }

    if (asignado_a_id !== undefined) {
      query += ` AND EXISTS (SELECT 1 FROM tarea_asignaciones filtro WHERE filtro.tarea_id=t.id AND filtro.usuario_id=$${paramCount}::integer)`;
      params.push(Number(asignado_a_id));
      paramCount++;
    } else if (asignado_a) {
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
        WHEN t.tipo_tarea = 'desarrollo' THEN 'desarrollo'
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
    if (taskStates) {
      query += ` AND ${workspace === 'render_os' ? effectiveTaskStateSql('t') : 't.estado'} = ANY($${paramCount}::text[])`;
      params.push(taskStates);
      paramCount++;
    }

    for (const term of getTaskSearchTerms(q)) {
      query += ` AND CONCAT_WS(' ',
        t.titulo,
        COALESCE(c.nombre, ''),
        COALESCE(t.asignado_a, ''),
        COALESCE(t.aclaraciones, ''),
        COALESCE(t.propiedades_extra->>'resumen', ''),
        COALESCE(t.propiedades_extra->'colaboradores', '[]'::jsonb)::text
      ) ILIKE $${paramCount}`;
      params.push(`%${term}%`);
      paramCount++;
    }

    if (papelera === "true") {
      query += ` AND t.propiedades_extra->>'papelera_render_os' = 'true'`;
    } else {
      query += ` AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`;
      if (solo_archivadas === "true") {
        query += ` AND t.propiedades_extra->>'archivada_render_os' = 'true'`;
      } else if (incluir_archivadas !== "true") {
        query += ` AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'`;
      }
    }

    if (reviewRead) {
      const page = await readTaskReviewPage({ pool, query, params, limit: limite, offset: desplazamiento,
        expectedSnapshot: reviewRead.snapshot, auth: req.auth, scope: reviewRead.scope,
        serialize: async (db, rows) => (await annotateTaskAssignments(db, rows)).map(row => taskOperationalDto(row, req.auth)) });
      res.set('X-Total-Count', String(page.total));
      res.set('X-Task-Review-Snapshot', page.snapshot);
      return res.json(page.items);
    }
    if (orderRead.sort === 'manual') {
      const page = await readTaskBoardPage({ pool, query, params, limit: limite, offset: desplazamiento,
        expectedSnapshot: orderRead.snapshot, auth: req.auth,
        serialize: async (db, rows) => (await annotateTaskAssignments(db, rows)).map(row => taskOperationalDto(row, req.auth)) });
      res.set('X-Total-Count', String(page.total));
      res.set('X-Task-Order-Revision', page.orderRevision);
      res.set('X-Task-Order-Snapshot', page.snapshot);
      return res.json(page.items);
    }
    const countQuery = `SELECT COUNT(*)::int AS total_count FROM (${query}) AS filtered_tasks`;
    const countParams = [...params];
    query += ` ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.id DESC`;
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limite, desplazamiento);

    const result = await pool.query(query, params);
    let total = result.rows[0]?.total_count || 0;
    if (result.rows.length === 0 && desplazamiento > 0) {
      // Window counts have no row beyond the last page. Reuse exactly the same
      // filtered/authorized query, without pagination, rather than inventing 0.
      const countResult = await pool.query(countQuery, countParams);
      total = countResult.rows[0]?.total_count;
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('No se pudo contar el listado de tareas.');
    }
    res.set("X-Total-Count", String(total));
    res.json((await annotateTaskAssignments(pool, result.rows.map(({ total_count, ...tarea }) => tarea)))
      .map((row) => taskOperationalDto(row, req.auth)));
  } catch (error) {
    if ([400, 401, 403, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/tareas-recomendaciones", async (req, res, next) => {
  try {
    const access = buildTaskAccessClause(req.auth, "t", "$1");
    const params = access.value ? [access.value] : [];
    const result = await pool.query(
      `SELECT t.id,t.titulo,t.estado,t.asignado_a,t.prioridad,t.tipo_tarea,t.subtipo,
              t.propiedades_extra,t.created_at,t.updated_at,c.nombre AS cliente_nombre,
              to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,
              to_char(p.fecha_programada,'YYYY-MM-DD') AS publicacion_fecha_programada
       FROM tareas t
       LEFT JOIN clientes c ON c.id=t.cliente_id
       LEFT JOIN publicaciones p ON p.id=t.publicacion_id
       WHERE t.propiedades_extra->>'workspace'='render_os'
         AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
         AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
         AND t.estado NOT IN ('publicada','finalizada')${access.sql}
       ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id ASC`,
      params,
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const ranked = rankTaskPriorities(result.rows, { today, limit: 50 });
    return res.json({ ...ranked, recommendations: ranked.recommendations.map((row) => taskOperationalDto(row, req.auth)),
      generated_at: new Date().toISOString() });
  } catch (error) { return next(error); }
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
         t.id, t.revision, t.titulo, t.estado, t.asignado_a, t.requiere_aprobacion,
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
    res.json(taskOperationalDto((await annotateTaskAssignments(pool, result.rows))[0], req.auth));
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
         t.id, t.revision, t.titulo, t.estado, t.asignado_a, t.requiere_aprobacion,
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
    res.json((await annotateTaskAssignments(pool, result.rows)).map((row) => taskOperationalDto(row, req.auth)));
  } catch (error) {
    next(error);
  }
});

router.get("/tareas/:id/comentarios", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
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

router.get('/tareas/:id/comentarios/solicitudes/:requestId', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Tarea inválida.' });
    const comment = await findTaskCommentCreation(pool, req.auth, {
      taskId: Number(req.params.id), workspace: req.query.workspace === 'render_os' ? 'render_os' : 'historical',
      requestId: req.params.requestId,
    });
    res.json(comment);
  } catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/tareas/:id/comentarios", async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Tarea inválida.' });
    const result = await createTaskComment(pool, req.auth, {
      taskId: Number(req.params.id), workspace: req.query.workspace === 'render_os' ? 'render_os' : 'historical',
      requestId: req.body?.request_id, payload: { autor: req.body?.autor, contenido: req.body?.contenido },
    });
    const comentario = result.comment, { autor, contenido } = comentario;
    res.status(result.replayed ? 200 : 201).json(result.requestId
      ? { ...comentario, creation_request_id: result.requestId } : comentario);

    if (!result.replayed && !contenido.startsWith("[Actividad]") && result.notification) {
      // Recipient IDs and authenticated actor were captured with the comment.
      // Neither a legacy display name nor an admin's free author label routes it.
      const { tarea, destinatarioIds, actorId, actor } = result.notification;
      const esBloqueo = /\bbloque(?:o|ado|ada|ante)?\b/i.test(contenido);
      notificarAsignacionSinInterrumpir({
        pool, tarea, destinatarioIds, actorId, actor,
        motivo: esBloqueo ? "bloqueada" : "comentario",
        detalle: `${autor}: ${contenido.slice(0, 280)}`,
      });
    }
  } catch (error) {
    if ([400,401,403,404,409,428].includes(error.status)) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get("/piezas", async (req, res, next) => {
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
    res.json(result.rows.map((row) => editorialOperationalDto(row, req.auth)));
  } catch (error) {
    next(error);
  }
});

router.get("/piezas/:id", async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    return res.json(await readLegacyEditorialPiece(pool,req.auth,req.params.id,req.query));
  } catch (error) { return editorialPieceApiError(error,res,next); }
});

async function editorialCreateHandler(req, res, next) {
  res.set('Cache-Control','no-store');
  try {
    const created=await createEditorialPiece(pool,req.auth,req.body);
    return res.status(created.status).json(created.piece);
  } catch(error) { return editorialPieceApiError(error,res,next); }
}
// New UI never submits to an older server that silently ignores request_id.
// Both accepted routes use exactly the same identity, receipt and transaction.
router.post("/editorial-creaciones", requireRole("admin"), editorialCreateHandler);
router.post("/piezas", requireRole("admin"), editorialCreateHandler);

router.post("/historias/convertir-flyer/:publicacionId", requireRole("admin"), async (req, res, next) => {
  try {
    res.status(201).json(await convertUnlinkedFlyer(pool, req.params.publicacionId));
  } catch (error) {
    if ([400,404,409].includes(error.status)) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
});

router.patch("/piezas/:id", requireRole("admin"), async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const selected = legacyPieceSelection(req.params.id,req.query,true);
    return res.json(await writeEditorialPiece(pool,req.auth,selected.domain,req.params.id,req.body,{legacy:true}));
  } catch (error) { return editorialPieceApiError(error,res,next); }
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
let indexHtml = null;
try {
  indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
} catch (error) {
  // A checkout/build can have dist but no completed entrypoint. Keep the API
  // importable; permission/I/O failures must not be hidden as missing assets.
  if (error.code !== 'ENOENT') throw error;
}
if (indexHtml !== null) {
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
  app.get(/^\/(?!api\/|health(?:\/|$)).*/, (_req, res) => {
    res.type("html").send(indexHtml);
  });
  console.log("Sirviendo frontend estático desde", distDir);
}

// Error handler centralizado: sin esto, Express devuelve HTML/stack
// traces por defecto en vez de JSON — riesgo de filtrar detalles internos.
app.use((err, _req, res, _next) => {
  const parsing = bodyParserErrorResponse(err);
  if (parsing) return res.status(parsing.status).json(parsing.body);
  if (err instanceof UserAdministrationAuthorityError || err instanceof UserAdministrationInputError || err instanceof SelfProfileInputError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (editingReviewDomainConflict(err)) {
    return res.status(409).json({ error: 'La tarea conserva decisiones de revisión. Consultá su historial; no se puede eliminar ni sobrescribir.' });
  }
  if (editingDeliveryDomainConflict(err)) {
    return res.status(409).json({ error: "La tarea conserva entregas registradas. Revisá su historial; no se puede eliminar ni sobrescribir." });
  }
  if (editorialPublicationDomainConflict(err)) {
    return res.status(409).json({ error: "El registro conserva evidencia de publicación. Revisá su estado y no elimines su historial." });
  }
  if (projectDomainConflict(err)) {
    return res.status(409).json({ error: "El registro conserva vínculos de un proyecto. Revisá su cliente y sus tareas; no elimines su historial." });
  }
  if (productionEditorialConflict(err)) {
    return res.status(409).json({ error: "El contenido está vinculado a una producción. Revisá la pieza, el objetivo y su tarea antes de cambiar la relación." });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: "Error interno del servidor." });
});

// IIFE en vez de top-level await: el runtime de Hostinger (LiteSpeed
// lsnode.js) carga este archivo con require(), que no admite módulos ESM
// con await de nivel superior (ERR_REQUIRE_ASYNC_MODULE).
function scheduleEditorialCalendar() {
  let lastRun = "";
  let currentPrepared = "";
  let running = false;
  const reconcile = async () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const current = `${parts.year}-${parts.month}`;
    if (currentPrepared !== current) {
      try {
        await reconcileEditorialCalendar(pool, current);
        currentPrepared = current;
        console.log(`Calendario editorial ${current} preparado`);
      } catch (error) {
        console.error("No se pudo preparar el calendario editorial actual", error.message);
      }
    }
    // Después del calendario para reutilizar sus publicaciones. Reintenta al
    // arrancar y cada hora, incluso si las asignaciones se completan más tarde.
    if (currentPrepared === current) {
      const goals = await reconcileMonthlyGoals(pool, current);
      if (goals.creadas || goals.vinculadas || goals.pendientes.length) {
        console.log("Objetivos mensuales", JSON.stringify(goals));
      }
    }
    if (Number(parts.day) < 28) return;
    if (lastRun === current) return;
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month), 1));
    const next = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    try {
      await reconcileEditorialCalendar(pool, next);
      lastRun = current;
      console.log(`Calendario editorial ${next} actualizado automáticamente`);
    } catch (error) {
      console.error("No se pudo actualizar el calendario editorial automático", error.message);
    }
  };
  const check = async () => {
    if (running) return;
    running = true;
    try { await reconcile(); }
    catch (error) { console.error("No se pudieron preparar los objetivos mensuales", error.message); }
    finally { running = false; }
  };
  check();
  const timer = setInterval(check, 60 * 60 * 1000);
  timer.unref?.();
}

if (process.env.RENDER_DISABLE_SERVER_START !== "true") (async () => {
  try {
    // Configuration and schema inspection never authorize migration, seeding or jobs.
    const startup = resolveStartupPolicy(process.env);
    await checkDatabaseConnection();
    const identity = await readMigrationIdentity(pool);
    if (identity.database !== startup.target.database || identity.username !== startup.target.username
      || identity.port !== startup.target.port) {
      throw new Error("Configured database identity does not match.");
    }
    assertStartupMigrationStatus(await readMigrationStatus(pool));
    await assertCoreSchemaReady(pool);
    assertBackgroundJobsAllowed(startup, identity);

    const server = app.listen(startup.port, startup.host, () => {
      const actualPort = server.address().port;
      console.log(`Backend listening on http://${startup.host}:${actualPort}`);
      // No default jobs, including their immediate first tick. Each service is explicit.
      for (const job of startup.jobs) {
        if (job === "editorial") scheduleEditorialCalendar();
        if (job === "trash") scheduleRenderOsTrashCleanup(pool);
        if (job === "wilson") scheduleWilsonMessages(pool);
        if (job === "supervisor") scheduleMiaSupervisor(pool);
      }
      process.send?.({ type: "render-startup-ready", port: actualPort });
    });
    server.once("error", () => {
      console.error("No se pudo abrir el puerto de Render. No se aplicaron migraciones ni se activaron jobs.");
      process.exit(1);
    });
  } catch {
    // Driver/configuration errors may include private connection details.
    console.error("Render no inició. Revisá DATABASE_URL, RENDER_DB_ENVIRONMENT y el esquema con migrate.js status. El arranque no aplica migraciones, seeds ni reparaciones.");
    process.exit(1);
  }
})();
