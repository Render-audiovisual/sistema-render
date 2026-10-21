import jwt from "jsonwebtoken";
import { randomUUID } from 'node:crypto';
// Provider credentials remain GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET, separate from login.
import { defaultDriveProvider } from './drive-provider.js';
import { withDriveAuthority, boundedDriveProvider, driveError, driveId, validDriveUploadUrl } from './drive-upload-authority.js';
import { insertDriveIntent, lockDriveIntent, drivePhaseId, driveChunkHash, parseDriveChunk, claimDriveChunk, assertDrivePhase,
  driveReceivedOffset, saveDriveAck, claimDriveReplacement, createDriveOAuthNonce, consumeDriveOAuthNonce, lockConsumedDriveOAuthNonce } from './drive-intent-ledger.js';

const GENERAL_ROOT = "1_WvWDqg56ecwO_0AsBvBnV6UzGynTAxt";
const DESIGN_ROOTS = {
  augusto: "1CY5J4NsNAHSK2MoqxHHv8_hi3S3TC-Fi",
  mariano: "1UQtWY14xRYAPiGRVZVMfVS9Q5wn8K2_U",
};

export const DRIVE_ROOTS = { general: GENERAL_ROOT, ...DESIGN_ROOTS };

export function normalizeDriveName(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveDriveRoot(task = {}) {
  const person = normalizeDriveName(task.asignado_a);
  const type = normalizeDriveName(`${task.tipo_tarea || ""} ${task.subtipo || ""} ${task.titulo || ""}`);
  const isDesign = /(diseno|carrusel|flyer|placa)/.test(type);
  if (isDesign && person.includes("augusto")) return { id: DESIGN_ROOTS.augusto, key: "augusto", label: "Diseño de Augusto" };
  if (isDesign && person.includes("mariano")) return { id: DESIGN_ROOTS.mariano, key: "mariano", label: "Diseño de Mariano Meza" };
  return { id: GENERAL_ROOT, key: "general", label: "Drive de Render", child: "RENDER_UPLOADS" };
}

export function isDriveReconnectError(error) {
  const details = [
    error?.message,
    error?.code,
    error?.response?.data?.error,
    error?.response?.data?.error_description,
    error?.cause?.message,
  ].filter(Boolean).join(" ");
  return /invalid_grant|token.*(?:expired|revoked)|expired.*token|revoked.*token/i.test(details);
}

async function findFolder(client, parentId, name) {
  const result = await client.listChildren(parentId, { query: name, foldersOnly: true });
  const normalized = normalizeDriveName(name);
  return result.files?.find((item) => normalizeDriveName(item.name) === normalized) || null;
}

async function resolveTaskFolder(client, task) {
  const root = resolveDriveRoot(task);
  if (root.child) {
    const child = await findFolder(client, root.id, root.child);
    if (!child) return { status: "manual", root, reason: `No encontramos la carpeta ${root.child}.` };
    return { status: "resolved", root, folder: child, breadcrumb: `${root.label} / ${child.name}` };
  }
  if (!task.cliente_nombre) return { status: "manual", root, reason: "La tarea no tiene un cliente definido." };
  const child = await findFolder(client, root.id, task.cliente_nombre);
  if (!child) return { status: "manual", root, reason: `No encontramos una carpeta inequívoca para ${task.cliente_nombre}.` };
  return { status: "resolved", root, folder: child, breadcrumb: `${root.label} / ${child.name}` };
}

function publicFile(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size === null || file.size === undefined ? null : Number(file.size),
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    iconLink: file.iconLink,
    thumbnailLink: file.thumbnailLink,
    isFolder: file.mimeType === "application/vnd.google-apps.folder",
  };
}

function driveOptions(input) { return { ...input, jwtSecret: input.jwtSecret || process.env.JWT_SECRET, providerFactory: input.providerFactory || defaultDriveProvider, providerTimeoutMs: input.providerTimeoutMs ?? 15000 }; }
function capability(token, secret, purpose) {
  let value; try { value = jwt.verify(token, secret, { algorithms: ["HS256"], audience: purpose === 'drive_upload' ? 'render-drive-upload-v2' : 'render-drive-oauth-v2' }); } catch { throw driveError(401, "DRIVE_SESSION_INVALID"); }
  if (value.version !== 2 || value.purpose !== purpose || !Number.isSafeInteger(value.actorId) || !Number.isSafeInteger(value.sessionVersion) || !Number.isSafeInteger(value.exp) || typeof value.jti !== 'string' || value.jti.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.jti)) throw driveError(401, "DRIVE_SESSION_INVALID");
  return value;
}
const bound = actor => ({ version: 2, actorId: actor.id, sessionVersion: actor.session_version });
const uncertain = (code = "DRIVE_UPLOAD_UNCERTAIN") => driveError(409, code);
function errorResponse(error, _req, res, _next) { return res.status(error.status || 503).json({ error: "No se pudo completar la operación de Drive.", code: error.code || "DRIVE_PROVIDER_FAILED", retryable: false }); }
async function remote(o, db, operation) {
  // No default-provider SQL may outlive the remote deadline or released lease.
  const credentials = o.providerFactory === defaultDriveProvider
    ? (await db.query("SELECT configuracion FROM integraciones_sistema WHERE clave='google_drive'")).rows[0]?.configuracion : undefined;
  return boundedDriveProvider(args => o.providerFactory({ ...args, credentials }), db, o.providerTimeoutMs, operation);
}

export function createGoogleDrivePublicRouter(input) {
  const o = driveOptions(input), router = o.express.Router();
  router.get("/oauth/callback", async (req, res, next) => {
    let exchanged = false;
    try {
      const state = capability(req.query.state, o.jwtSecret, "google_drive");
      if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) throw driveError(400, "DRIVE_CODE_INVALID");
      const auth = { id: state.actorId, session_version: state.sessionVersion }, claimId = drivePhaseId();
      // Irreversible consumption is committed before exchange: neither timeout,
      // DB rollback nor replay can cause this callback to exchange twice.
      await withDriveAuthority(o.pool, auth, { admin: true }, ({ db }) => consumeDriveOAuthNonce(db, state, claimId));
      await withDriveAuthority(o.pool, auth, { admin: true }, async ({ db, actor }) => {
        await lockConsumedDriveOAuthNonce(db, state, claimId);
        exchanged = true;
        const tokens = await remote(o, db, provider => provider.exchangeCode(req.query.code));
        if (typeof tokens?.refresh_token !== "string" || !tokens.refresh_token) throw uncertain("DRIVE_OAUTH_UNCERTAIN");
        await db.query(`INSERT INTO integraciones_sistema (clave,configuracion,actualizado_por,updated_at)
          VALUES ('google_drive',$1::jsonb,$2,now()) ON CONFLICT (clave) DO UPDATE SET configuracion=$1::jsonb,actualizado_por=$2,updated_at=now()`,
          [JSON.stringify({ refresh_token: tokens.refresh_token }), actor.nombre || actor.usuario]);
        await db.query('UPDATE drive_oauth_nonces SET completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2', [state.jti, claimId]);
      });
      res.redirect("/drive?connected=1");
    } catch (error) { next(exchanged ? uncertain("DRIVE_OAUTH_UNCERTAIN") : error); }
  });
  router.use(errorResponse); return router;
}

export function createGoogleDriveRouter(input) {
  const o = driveOptions(input), { pool, requireRole } = o, router = o.express.Router();
  const phase = (auth, scope, operation) => withDriveAuthority(pool, auth, scope, operation);
  router.get("/status", async (req, res, next) => { try { res.json({ ...await phase(req.auth, {}, ({ db }) => remote(o, db, p => p.status())), roots: DRIVE_ROOTS }); } catch (e) { next(e); } });
  router.post("/connect", requireRole("admin"), async (req, res, next) => {
    try { res.json(await phase(req.auth, { admin: true }, async ({ db, actor }) => {
      const nonce = { ...bound(actor), purpose: 'google_drive', jti: randomUUID(), exp: Math.floor(Date.now()/1000)+600 };
      await createDriveOAuthNonce(db, nonce);
      const state = jwt.sign(nonce, o.jwtSecret, { algorithm: "HS256", audience: 'render-drive-oauth-v2' });
      return { url: await remote(o, db, p => p.generateAuthUrl(state)) };
    })); } catch (e) { next(e); }
  });
  router.get("/files", async (req, res, next) => {
    try { const parent = req.query.parent || GENERAL_ROOT; if (!driveId(parent)) throw driveError(400, "DRIVE_FOLDER_INVALID");
      const result = await phase(req.auth, {}, ({ db }) => remote(o, db, p => p.listChildren(parent, { query: String(req.query.q || "").trim() })));
      res.json((result.files || []).map(publicFile));
    } catch (e) { next(e); }
  });
  router.get("/upload-plan", async (req, res, next) => {
    try { res.json(await phase(req.auth, { taskId: Number(req.query.task_id) }, ({ db, task }) => remote(o, db, p => resolveTaskFolder(p, task)))); } catch (e) { next(e); }
  });
  router.get("/publication-upload-plan", requireRole("admin", "community"), async (req, res, next) => {
    try { const destination = await phase(req.auth, {}, ({ db, actor }) => {
      if (!["admin","community"].includes(actor.rol)) throw driveError(403, "DRIVE_ACCESS_DENIED");
      return remote(o, db, client => resolveTaskFolder(client, {}));
    }); if (destination.status !== "resolved") throw driveError(503, "DRIVE_FOLDER_UNAVAILABLE"); res.json(destination); } catch (e) { next(e); }
  });
  router.post("/uploads", async (req, res, next) => {
    let started = false;
    try {
      let { name, mimeType = "application/octet-stream", size, parentId, taskId = null, duplicateAction = "" } = req.body || {};
      if (typeof name !== "string" || !name.trim() || name.length > 1000 || typeof mimeType !== "string" || !mimeType || mimeType.length > 255 || !Number.isSafeInteger(size) || size < 0 || !driveId(parentId) || !["","keep","replace"].includes(duplicateAction)) throw driveError(400, "DRIVE_INPUT_INVALID");
      name = name.trim(); const scope = { taskId, admin: duplicateAction === "replace" };
      const duplicates = await phase(req.auth, scope, ({ db }) => remote(o, db, p => p.listChildren(parentId, { query: name })));
      const duplicate = (duplicates.files || []).find(f => normalizeDriveName(f.name) === normalizeDriveName(name));
      if (duplicate && !duplicateAction) return res.status(409).json({ error: "Ya existe un archivo con ese nombre.", code: 'DRIVE_DUPLICATE_REJECTED', duplicate: publicFile(duplicate), retryable: false });
      if (duplicate && duplicateAction === "keep") { const dot = name.lastIndexOf("."); name = dot > 0 ? name.slice(0,dot) + " (copia)" + name.slice(dot) : name + " (copia)"; }
      const session = await phase(req.auth, scope, async ({ db, actor }) => {
        if (duplicateAction === "replace" && duplicate && !driveId(duplicate.id)) throw driveError(400, "DRIVE_FILE_INVALID");
        const intent = { ...bound(actor), purpose: 'drive_upload', jti: randomUUID(), exp: Math.floor(Date.now()/1000)+7200,
          phaseId: drivePhaseId(), name, mimeType, size, parentId, taskId, replaceId: duplicateAction === 'replace' ? duplicate?.id || null : null };
        await insertDriveIntent(db, intent); return intent;
      });
      const result = await phase(req.auth, scope, async ({ db }) => {
        const intent = await lockDriveIntent(db, session); assertDrivePhase(intent, 'starting', session.phaseId);
        started = true;
        const { uploadUrl } = await remote(o, db, p => p.startUpload({ name, mimeType, size, parentId }));
        if (!validDriveUploadUrl(uploadUrl)) throw uncertain();
        await db.query("UPDATE drive_upload_intents SET state='ready',upload_url=$2,updated_at=clock_timestamp() WHERE id=$1", [session.jti, uploadUrl]);
        const { phaseId: _phaseId, ...publicSession } = session;
        return { token: jwt.sign(publicSession, o.jwtSecret, { algorithm: 'HS256', audience: 'render-drive-upload-v2' }), name };
      }); res.status(201).json(result);
    } catch (e) { next(started ? uncertain() : e); }
  });
  router.put("/uploads/:token", o.express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res, next) => {
    let external = false, attached = false;
    try {
      const s = capability(req.params.token, o.jwtSecret, "drive_upload");
      if (s.actorId !== req.auth?.id || s.sessionVersion !== req.auth?.session_version) throw driveError(401, "DRIVE_SESSION_INVALID");
      if (!driveId(s.parentId) || (s.replaceId !== null && !driveId(s.replaceId)) || !Number.isSafeInteger(s.size) || s.size < 0 || !Buffer.isBuffer(req.body)) throw driveError(400, "DRIVE_INPUT_INVALID");
      const range = req.get('content-range') || '', chunk = parseDriveChunk(range, req.body, s.size), phaseId = drivePhaseId();
      const scope = { taskId: s.taskId, admin: Boolean(s.replaceId) };
      const claim = await phase(req.auth, scope, ({ db }) => claimDriveChunk(db, s, range, driveChunkHash(req.body), chunk, phaseId));
      if (claim.cached) return res.status(claim.cached.status).json(claim.cached.body);
      const result = await phase(req.auth, { taskId: s.taskId, admin: Boolean(s.replaceId) }, async ({ db, task, actor }) => {
        const intent = await lockDriveIntent(db, s); assertDrivePhase(intent, 'in_flight', phaseId);
        if (!validDriveUploadUrl(intent.upload_url)) throw uncertain();
        external = true;
        const response = await remote(o, db, p => p.uploadChunk({ uploadUrl: intent.upload_url, bytes: req.body, contentRange: range }));
        if (response.status === 308) {
          const offset = driveReceivedOffset(response, chunk, s.size), body = { received: response.received };
          await saveDriveAck(db, s, { status: 202, body, offset, phaseId });
          return { status: 202, body };
        }
        const f = response.file;
        if (!chunk.final || ![200,201].includes(response.status) || !driveId(f?.id) || typeof s.name !== 'string' || !s.name || typeof s.mimeType !== 'string' || f.name !== s.name || f.mimeType !== s.mimeType || !Array.isArray(f.parents) || f.parents.length !== 1 || f.parents[0] !== s.parentId || !['string','number'].includes(typeof f.size) || String(f.size) !== String(s.size)) throw uncertain();
        const link = "https://drive.google.com/file/d/" + f.id + "/view";
        if (task && !(task.propiedades_extra.drive_archivos || []).some(file => file?.id === f.id)) {
          await db.query(`UPDATE tareas SET material_referencia=COALESCE(NULLIF(material_referencia,''),$2),
            propiedades_extra=jsonb_set(propiedades_extra,'{drive_archivos}',COALESCE(propiedades_extra->'drive_archivos','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1`,
            [task.id, link, JSON.stringify([{ id: f.id, name: f.name, url: link, uploaded_at: new Date().toISOString(), uploaded_by: actor.nombre || actor.usuario }])]);
        }
        const body = publicFile({ ...f, webViewLink: link });
        await saveDriveAck(db, s, { status: 200, body, offset: s.size, phaseId });
        return { status: 200, body };
      });
      if (result.status === 202) return res.status(202).json(result.body);
      attached = true;
      if (s.replaceId) {
        const replacementPhase = drivePhaseId();
        // Only this freshly-confirmed request may claim replacement. Replays
        // never resume pending/in-flight replacement, even after a restart.
        await phase(req.auth, { taskId: s.taskId, admin: true }, ({ db }) => claimDriveReplacement(db, s, replacementPhase));
        await phase(req.auth, { taskId: s.taskId, admin: true }, async ({ db }) => {
          const intent = await lockDriveIntent(db, s);
          if (intent.state !== 'completed' || intent.replacement_state !== 'in_flight' || intent.phase_id !== replacementPhase) throw uncertain('DRIVE_REPLACEMENT_UNCERTAIN');
          if (s.replaceId !== result.body.id) await remote(o, db, p => p.trashFile(s.replaceId));
          await db.query("UPDATE drive_upload_intents SET replacement_state='completed',updated_at=clock_timestamp() WHERE id=$1", [s.jti]);
        });
      }
      res.json(result.body);
    } catch (e) { next(attached ? uncertain("DRIVE_REPLACEMENT_UNCERTAIN") : external ? uncertain() : e); }
  });
  router.delete("/files/:id", requireRole("admin"), async (req, res, next) => {
    let external = false;
    try { if (!driveId(req.params.id)) throw driveError(400, "DRIVE_FILE_INVALID"); await phase(req.auth, { admin: true }, ({ db }) => { external = true; return remote(o, db, p => p.trashFile(req.params.id)); }); res.json({ ok: true }); } catch (e) { next(external ? uncertain("DRIVE_REPLACEMENT_UNCERTAIN") : e); }
  });
  router.use(errorResponse); return router;
}
