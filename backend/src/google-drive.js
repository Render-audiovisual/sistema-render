import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
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

function driveClient() {
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || "https://sistema.rendercorrientes.com/api/drive/oauth/callback";
  if (!process.env.GOOGLE_DRIVE_CLIENT_ID || !process.env.GOOGLE_DRIVE_CLIENT_SECRET) return null;
  return new OAuth2Client(process.env.GOOGLE_DRIVE_CLIENT_ID, process.env.GOOGLE_DRIVE_CLIENT_SECRET, redirectUri);
}

async function savedCredentials(pool) {
  const result = await pool.query("SELECT configuracion FROM integraciones_sistema WHERE clave='google_drive'");
  return result.rows[0]?.configuracion || null;
}

async function authorizedClient(pool) {
  const client = driveClient();
  const credentials = await savedCredentials(pool);
  if (!client || !credentials?.refresh_token) return null;
  client.setCredentials(credentials);
  return client;
}

async function driveRequest(client, url, options = {}) {
  const authHeaders = await client.getRequestHeaders();
  const headers = typeof authHeaders.entries === "function"
    ? Object.fromEntries(authHeaders.entries())
    : authHeaders;
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || "Google Drive no pudo completar la operación.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listChildren(client, parentId, { query = "", foldersOnly = false, limit = 100 } = {}) {
  const terms = [`'${escapeQuery(parentId)}' in parents`, "trashed = false"];
  if (foldersOnly) terms.push("mimeType = 'application/vnd.google-apps.folder'");
  if (query) terms.push(`name contains '${escapeQuery(query)}'`);
  const params = new URLSearchParams({
    q: terms.join(" and "),
    pageSize: String(Math.min(100, Math.max(1, Number(limit) || 100))),
    orderBy: "folder,name_natural",
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents,owners(displayName))",
  });
  return driveRequest(client, `https://www.googleapis.com/drive/v3/files?${params.toString()}`);
}

async function findFolder(client, parentId, name) {
  const result = await listChildren(client, parentId, { query: name, foldersOnly: true });
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
    size: file.size ? Number(file.size) : null,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    iconLink: file.iconLink,
    thumbnailLink: file.thumbnailLink,
    isFolder: file.mimeType === "application/vnd.google-apps.folder",
  };
}

export function createGoogleDrivePublicRouter({ express, pool }) {
  const router = express.Router();
  router.get("/oauth/callback", async (req, res, next) => {
    try {
      const client = driveClient();
      if (!client) return res.status(503).send("Google Drive todavía no está configurado.");
      const state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
      if (state.purpose !== "google_drive" || state.role !== "admin") return res.status(403).send("Autorización inválida.");
      const { tokens } = await client.getToken(String(req.query.code || ""));
      const previous = await savedCredentials(pool);
      const credentials = { refresh_token: tokens.refresh_token || previous?.refresh_token };
      if (!credentials.refresh_token) return res.status(400).send("Google no entregó acceso permanente. Volvé a conectar la cuenta.");
      await pool.query(
        `INSERT INTO integraciones_sistema (clave,configuracion,actualizado_por,updated_at)
         VALUES ('google_drive',$1::jsonb,$2,now())
         ON CONFLICT (clave) DO UPDATE SET configuracion=$1::jsonb,actualizado_por=$2,updated_at=now()`,
        [JSON.stringify(credentials), state.name || "Líder"],
      );
      res.redirect("/drive?connected=1");
    } catch (error) { next(error); }
  });
  return router;
}

export function createGoogleDriveRouter({ express, pool, requireRole }) {
  const router = express.Router();

  router.get("/status", async (_req, res, next) => {
    try {
      const configured = Boolean(driveClient());
      const connected = Boolean(await savedCredentials(pool));
      res.json({ configured, connected, roots: DRIVE_ROOTS });
    } catch (error) { next(error); }
  });

  router.post("/connect", requireRole("admin"), async (req, res, next) => {
    try {
      const client = driveClient();
      if (!client) return res.status(503).json({ error: "Faltan GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET y GOOGLE_DRIVE_REDIRECT_URI en Hostinger." });
      const state = jwt.sign({ purpose: "google_drive", role: req.auth.rol, name: req.auth.nombre }, process.env.JWT_SECRET, { expiresIn: "10m" });
      res.json({ url: client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: [DRIVE_SCOPE], state }) });
    } catch (error) { next(error); }
  });

  router.get("/files", async (req, res, next) => {
    try {
      const client = await authorizedClient(pool);
      if (!client) return res.status(503).json({ error: "Un líder debe conectar el Drive de Render." });
      const parent = String(req.query.parent || GENERAL_ROOT);
      const allowedRoot = Object.values(DRIVE_ROOTS).includes(parent);
      if (!allowedRoot && !/^[a-zA-Z0-9_-]{10,}$/.test(parent)) return res.status(400).json({ error: "Carpeta inválida." });
      const result = await listChildren(client, parent, { query: String(req.query.q || "").trim() });
      res.json((result.files || []).map(publicFile));
    } catch (error) { next(error); }
  });

  router.get("/upload-plan", async (req, res, next) => {
    try {
      const client = await authorizedClient(pool);
      if (!client) return res.status(503).json({ error: "Un líder debe conectar el Drive de Render." });
      const result = await pool.query(
        `SELECT t.id,t.titulo,t.asignado_a,t.tipo_tarea,t.subtipo,c.nombre AS cliente_nombre
         FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
         WHERE t.id=$1 AND t.propiedades_extra->>'workspace'='render_os'`,
        [req.query.task_id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Tarea de RENDER OS no encontrada." });
      res.json(await resolveTaskFolder(client, result.rows[0]));
    } catch (error) { next(error); }
  });

  router.post("/uploads", async (req, res, next) => {
    try {
      const client = await authorizedClient(pool);
      if (!client) return res.status(503).json({ error: "Un líder debe conectar el Drive de Render." });
      let name = String(req.body?.name || "").trim();
      const mimeType = String(req.body?.mimeType || "application/octet-stream");
      const size = Number(req.body?.size);
      const parentId = String(req.body?.parentId || "");
      if (!name || !parentId || !Number.isSafeInteger(size) || size < 0) return res.status(400).json({ error: "Faltan los datos del archivo." });
      const duplicates = await listChildren(client, parentId, { query: name });
      const duplicate = (duplicates.files || []).find((item) => normalizeDriveName(item.name) === normalizeDriveName(name));
      const duplicateAction = String(req.body?.duplicateAction || "");
      if (duplicate && !duplicateAction) return res.status(409).json({ error: "Ya existe un archivo con ese nombre.", duplicate: publicFile(duplicate) });
      if (duplicateAction === "replace" && req.auth.rol !== "admin") return res.status(403).json({ error: "Solo un líder puede reemplazar archivos." });
      if (duplicate && duplicateAction === "keep") {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)} (copia)${name.slice(dot)}` : `${name} (copia)`;
      }
      const authHeaders = await client.getRequestHeaders();
      const headers = typeof authHeaders.entries === "function"
        ? Object.fromEntries(authHeaders.entries())
        : authHeaders;
      const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(size) },
        body: JSON.stringify({ name, mimeType, parents: [parentId] }),
      });
      if (!start.ok) throw new Error("No se pudo iniciar la carga en Google Drive.");
      const uploadUrl = start.headers.get("location");
      if (!uploadUrl) throw new Error("Google Drive no devolvió una sesión de carga.");
      const token = jwt.sign({ purpose: "drive_upload", uploadUrl, size, taskId: Number(req.body?.taskId) || null, replaceId: duplicateAction === "replace" ? duplicate?.id : null }, process.env.JWT_SECRET, { expiresIn: "2h" });
      res.status(201).json({ token, name });
    } catch (error) { next(error); }
  });

  router.put("/uploads/:token", express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res, next) => {
    try {
      const session = jwt.verify(req.params.token, process.env.JWT_SECRET);
      if (session.purpose !== "drive_upload" || !String(session.uploadUrl).startsWith("https://www.googleapis.com/upload/drive/")) return res.status(400).json({ error: "Carga inválida." });
      const response = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(req.body.length), "Content-Range": String(req.get("content-range") || "") }, body: req.body });
      if (response.status === 308) return res.status(202).json({ received: response.headers.get("range") || null });
      const file = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status).json({ error: file?.error?.message || "Google Drive rechazó una parte del archivo." });
      const client = await authorizedClient(pool);
      if (session.replaceId && client) await driveRequest(client, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(session.replaceId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      if (session.taskId) {
        const current = await pool.query("SELECT id FROM tareas WHERE id=$1 AND propiedades_extra->>'workspace'='render_os'", [session.taskId]);
        if (current.rows[0]) {
          const link = file.webViewLink || `https://drive.google.com/open?id=${file.id}`;
          const uploadedFile = { id: file.id, name: file.name, url: link, uploaded_at: new Date().toISOString(), uploaded_by: req.auth.nombre || req.auth.usuario };
          await pool.query(
            `UPDATE tareas SET
               material_referencia=COALESCE(NULLIF(material_referencia,''),$2),
               propiedades_extra=jsonb_set(
                 propiedades_extra,
                 '{drive_archivos}',
                 COALESCE(propiedades_extra->'drive_archivos','[]'::jsonb) || $3::jsonb,
                 true
               ),
               updated_at=now()
             WHERE id=$1 AND propiedades_extra->>'workspace'='render_os'`,
            [session.taskId, link, JSON.stringify([uploadedFile])],
          );
        }
      }
      res.json(publicFile(file));
    } catch (error) { next(error); }
  });

  router.delete("/files/:id", requireRole("admin"), async (req, res, next) => {
    try {
      const client = await authorizedClient(pool);
      if (!client) return res.status(503).json({ error: "Un líder debe conectar el Drive de Render." });
      await driveRequest(client, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(req.params.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  return router;
}
