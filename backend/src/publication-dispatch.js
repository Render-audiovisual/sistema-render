import { bindCapturedOwnerProfileAuthority, captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

function captureDispatchActor(auth) {
  if (![auth?.id, auth?.session_version].every(n => Number.isSafeInteger(n) && n > 0)
    || !['admin', 'community'].includes(auth.rol)) throw Object.assign(new Error('La sesión ya no está autorizada.'), { status: 401 });
  return bindCapturedOwnerProfileAuthority(auth, Object.freeze({ id: auth.id, session_version: auth.session_version, rol: auth.rol }));
}
async function retainDispatchActor(db, observed, authority) {
  await retainCapturedOwnerProfileAuthority(db, authority, { lockMode: 'share' });
  const actor = (await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [observed.id])).rows[0];
  if (!actor || actor.id !== observed.id || actor.activo !== true || actor.session_version !== observed.session_version
    || actor.rol !== observed.rol || !['admin', 'community'].includes(actor.rol)) {
    throw Object.assign(new Error('La sesión ya no está autorizada.'), { status: 401 });
  }
  return actor;
}

export const PUBLICATION_DISPATCH_STATES = new Set([
  "borrador",
  "programada",
  "lista_para_publicar",
  "publicando",
  "publicada",
  "parcial",
  "fallida",
  "cancelada",
]);

function cleanText(value, maxLength) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveDispatchId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^[1-9]\d{0,18}$/.test(text)
    && (text.length < 19 || text <= '9223372036854775807') ? text : null;
}

function normalizePlatforms(value) {
  const input = Array.isArray(value)
    ? value
    : Object.entries(value || {}).filter(([, enabled]) => enabled).map(([platform]) => platform);
  return [...new Set(input.map((item) => String(item).trim().toLowerCase()))]
    .filter((item) => ["instagram", "facebook"].includes(item));
}

function normalizeMaterials(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/\n+/);
  const urls = input.map((item) => String(item).trim()).filter(Boolean);
  if (urls.some((item) => {
    try {
      const url = new URL(item);
      return !["http:", "https:"].includes(url.protocol);
    } catch {
      return true;
    }
  })) throw new Error("Los materiales deben ser enlaces válidos de Drive.");
  return urls;
}

export function normalizePublicationDispatch(body = {}) {
  const clientId = positiveInteger(body.clientId ?? body.cliente_id);
  const publicationId = body.publicationId || body.publicacion_id
    ? positiveInteger(body.publicationId ?? body.publicacion_id)
    : null;
  const type = cleanText(body.type ?? body.tipo, 20).toLowerCase();
  const caption = cleanText(body.caption ?? body.copy, 2200);
  const firstComment = cleanText(body.firstComment ?? body.primer_comentario, 2200);
  const mode = ["now", "draft"].includes(body.mode) ? body.mode : "schedule";
  const isDraft = mode === "draft";
  const platforms = normalizePlatforms(body.platforms ?? body.plataformas);
  const materials = normalizeMaterials(body.materials ?? body.material);
  const scheduledValue = body.scheduledAt ?? body.programada_para ?? "";
  const scheduledAt = scheduledValue ? new Date(scheduledValue) : null;
  const requestKey = cleanText(body.requestKey ?? body.idempotency_key, 100);

  if (!clientId) throw new Error("Elegí un cliente válido.");
  if (body.publicationId && !publicationId) throw new Error("La publicación planificada no es válida.");
  if (!["reel", "carrusel"].includes(type)) throw new Error("Elegí Reel o Carrusel.");
  if (!isDraft && !caption) throw new Error("Escribí o generá el copy.");
  if (!isDraft && !platforms.length) throw new Error("Elegí al menos una plataforma.");
  if (!isDraft && !materials.length) throw new Error("Agregá el material de Drive.");
  if (!isDraft && type === "reel" && materials.length !== 1) throw new Error("Un Reel necesita un solo video.");
  if (!isDraft && type === "carrusel" && (materials.length < 2 || materials.length > 10)) {
    throw new Error("Un carrusel necesita entre 2 y 10 piezas.");
  }
  if (!isDraft && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw new Error("Elegí una fecha y hora válidas.");
  if (isDraft && scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new Error("La fecha del borrador no es válida.");
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(requestKey)) throw new Error("La operación no tiene una clave segura.");

  return {
    clientId,
    publicationId,
    type,
    caption,
    firstComment,
    mode,
    platforms,
    materials,
    scheduledAt: scheduledAt?.toISOString() || null,
    status: isDraft ? "borrador" : (mode === "now" ? "lista_para_publicar" : "programada"),
    requestKey,
    options: {
      collaborators: cleanText(body.collaborators, 500),
      location: cleanText(body.location, 250),
      tags: cleanText(body.tags, 500),
      source: "render_publications_preview",
    },
  };
}

const DISPATCH_REVISION = `to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const validRevision = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);

function sameDispatchPayload(row, payload) {
  const sameId = (a, b) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));
  const scheduledAt = row.scheduledAt == null ? null : new Date(row.scheduledAt).toISOString();
  return sameId(row.clientId, payload.clientId) && sameId(row.publicationId, payload.publicationId)
    && row.type === payload.type && row.caption === payload.caption && row.firstComment === payload.firstComment
    && scheduledAt === payload.scheduledAt && row.status === payload.status && row.previewOnly === true
    && Object.keys(payload.options).every(key => row.options?.[key] === payload.options[key])
    && JSON.stringify((row.assets || []).map(asset => asset.url)) === JSON.stringify(payload.materials)
    && JSON.stringify((row.targets || []).map(target => target.platform).sort()) === JSON.stringify([...payload.platforms].sort());
}

const DISPATCH_SELECT = `
  SELECT e.id,
    e.publicacion_id AS "publicationId",
    e.cliente_id AS "clientId",
    c.nombre AS "clientName",
    e.creado_por_nombre AS "createdByName",
    e.tipo AS "type",
    e.copy AS "caption",
    e.primer_comentario AS "firstComment",
    e.programada_para AS "scheduledAt",
    e.estado AS "status",
    e.opciones AS "options",
    e.preview_only AS "previewOnly",
    e.created_at AS "createdAt",
    e.updated_at AS "updatedAt",
    ${DISPATCH_REVISION} AS revision,
    COALESCE((
      SELECT json_agg(json_build_object('url', m.drive_url, 'position', m.posicion) ORDER BY m.posicion)
      FROM publicacion_envio_materiales m WHERE m.envio_id=e.id
    ), '[]'::json) AS assets,
    COALESCE((
      SELECT json_agg(json_build_object('platform', d.plataforma, 'status', d.estado, 'attempts', d.intentos) ORDER BY d.plataforma)
      FROM publicacion_envio_destinos d WHERE d.envio_id=e.id
    ), '[]'::json) AS targets
  FROM publicacion_envios e
  JOIN clientes c ON c.id=e.cliente_id`;

export function createPublicationDispatchRouter({ express, pool, requireRole }) {
  const router = express.Router();

  router.get("/", requireRole("admin", "community"), async (req, res, next) => {
    try {
      const status = req.query.estado ? String(req.query.estado) : null;
      if (status && !PUBLICATION_DISPATCH_STATES.has(status)) {
        return res.status(400).json({ error: "Estado de envío inválido." });
      }
      const result = await pool.query(
        `${DISPATCH_SELECT}
         WHERE ($1::text IS NULL OR e.estado=$1)
         ORDER BY COALESCE(e.programada_para, e.created_at) DESC, e.id DESC
         LIMIT 300`,
        [status],
      );
      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:id", requireRole("admin", "community"), async (req, res, next) => {
    const id = positiveDispatchId(req.params.id);
    if (!id) return res.status(400).json({ error: "Borrador inválido." });
    const expectedRevision = req.body?.expectedRevision;
    if (expectedRevision === undefined) return res.status(428).json({ error: "Abrí la versión guardada antes de editar el borrador.", code: "DISPATCH_REVISION_REQUIRED" });
    if (!validRevision(expectedRevision)) return res.status(400).json({ error: "La versión del borrador no es válida.", code: "DISPATCH_REVISION_INVALID" });
    let payload;
    try {
      payload = normalizePublicationDispatch(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    let observed, authority;
    try { observed = captureDispatchActor(req.auth); authority = captureOwnerProfileWriteAuthority(observed); }
    catch (error) { return next(error); }
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await retainDispatchActor(client, observed, authority);
      const existing = await client.query(`SELECT e.id,e.estado,${DISPATCH_REVISION} AS revision FROM publicacion_envios e WHERE e.id=$1 FOR UPDATE`, [id]);
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "El borrador no existe." });
      }
      if (existing.rows[0].revision !== expectedRevision) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Otro integrante modificó el borrador. Conservá tus cambios y revisá la versión guardada.", code: "DISPATCH_REVISION_CONFLICT" });
      }
      if (existing.rows[0].estado !== 'borrador') {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El envío ya no es un borrador editable.", code: "DISPATCH_NOT_EDITABLE" });
      }
      const clientExists = await client.query("SELECT id FROM clientes WHERE id=$1", [payload.clientId]);
      if (!clientExists.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Cliente no encontrado." });
      }
      if (payload.publicationId) {
        const publicationExists = await client.query(
          "SELECT id FROM publicaciones WHERE id=$1 AND cliente_id=$2",
          [payload.publicationId, payload.clientId],
        );
        if (!publicationExists.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "La publicación elegida no pertenece al cliente." });
        }
      }
      await client.query(
        `UPDATE publicacion_envios SET
           publicacion_id=$2,cliente_id=$3,tipo=$4,copy=$5,primer_comentario=$6,
           programada_para=$7,opciones=$8::jsonb,estado=$9,
           updated_at=GREATEST(clock_timestamp(),updated_at + interval '1 microsecond')
         WHERE id=$1`,
        [id, payload.publicationId, payload.clientId, payload.type, payload.caption, payload.firstComment, payload.scheduledAt, JSON.stringify(payload.options), payload.status],
      );
      await client.query("DELETE FROM publicacion_envio_materiales WHERE envio_id=$1", [id]);
      await client.query("DELETE FROM publicacion_envio_destinos WHERE envio_id=$1", [id]);
      for (let index = 0; index < payload.materials.length; index += 1) {
        await client.query(
          "INSERT INTO publicacion_envio_materiales(envio_id,posicion,drive_url) VALUES($1,$2,$3)",
          [id, index + 1, payload.materials[index]],
        );
      }
      for (const platform of payload.platforms) {
        await client.query(
          "INSERT INTO publicacion_envio_destinos(envio_id,plataforma,estado) VALUES($1,$2,'simulada')",
          [id, platform],
        );
      }
      const result = await client.query(`${DISPATCH_SELECT} WHERE e.id=$1`, [id]);
      await client.query("COMMIT");
      return res.json(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(error => { releaseError = error; });
      return next(error);
    } finally {
      client.release(releaseError);
    }
  });

  router.post("/", requireRole("admin", "community"), async (req, res, next) => {
    let payload;
    try {
      payload = normalizePublicationDispatch(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    let observed, authority;
    try { observed = captureDispatchActor(req.auth); authority = captureOwnerProfileWriteAuthority(observed); }
    catch (error) { return next(error); }
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const actor = await retainDispatchActor(client, observed, authority);
      const clientExists = await client.query("SELECT id FROM clientes WHERE id=$1", [payload.clientId]);
      if (!clientExists.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Cliente no encontrado." });
      }
      if (payload.publicationId) {
        const publicationExists = await client.query(
          "SELECT id FROM publicaciones WHERE id=$1 AND cliente_id=$2",
          [payload.publicationId, payload.clientId],
        );
        if (!publicationExists.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "La publicación elegida no pertenece al cliente." });
        }
      }

      const inserted = await client.query(
        `INSERT INTO publicacion_envios
          (publicacion_id,cliente_id,creado_por_id,creado_por_nombre,tipo,copy,primer_comentario,
           programada_para,estado,opciones,idempotency_key,preview_only)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,TRUE)
         RETURNING id`,
        [
          payload.publicationId,
          payload.clientId,
          actor.id,
          actor.nombre || actor.usuario || "Equipo",
          payload.type,
          payload.caption,
          payload.firstComment,
          payload.scheduledAt,
          payload.status,
          JSON.stringify(payload.options),
          payload.requestKey,
        ],
      );
      const dispatchId = inserted.rows[0].id;
      for (let index = 0; index < payload.materials.length; index += 1) {
        await client.query(
          "INSERT INTO publicacion_envio_materiales(envio_id,posicion,drive_url) VALUES($1,$2,$3)",
          [dispatchId, index + 1, payload.materials[index]],
        );
      }
      for (const platform of payload.platforms) {
        await client.query(
          "INSERT INTO publicacion_envio_destinos(envio_id,plataforma,estado) VALUES($1,$2,'simulada')",
          [dispatchId, platform],
        );
      }
      const result = await client.query(`${DISPATCH_SELECT} WHERE e.id=$1`, [dispatchId]);
      await client.query("COMMIT");
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(error => { releaseError = error; });
      if (error.code === "23505" && !releaseError) {
        try {
          await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          await retainDispatchActor(client, observed, authority);
          const replay = await client.query("SELECT id,creado_por_id,updated_at=created_at AS unchanged FROM publicacion_envios WHERE idempotency_key=$1 FOR UPDATE", [payload.requestKey]);
          if (replay.rowCount && !replay.rows[0].unchanged) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "El envío ya existe y fue modificado. Revisá la versión guardada antes de continuar.", code: "DISPATCH_REPLAY_CHANGED" });
          }
          if (replay.rowCount) {
            const existing = await client.query(`${DISPATCH_SELECT} WHERE e.id=$1`, [replay.rows[0].id]);
            if (String(replay.rows[0].creado_por_id) !== String(observed.id) || !sameDispatchPayload(existing.rows[0], payload)) {
              await client.query("ROLLBACK");
              return res.status(409).json({ error: "La clave de operación ya corresponde a otro envío. Revisá el registro guardado.", code: "DISPATCH_REPLAY_MISMATCH" });
            }
            await client.query("COMMIT");
            return res.status(200).json(existing.rows[0]);
          }
          await client.query("ROLLBACK");
        } catch (replayError) {
          await client.query("ROLLBACK").catch(error => { releaseError = error; });
          return next(replayError);
        }
      }
      return next(error);
    } finally {
      client.release(releaseError);
    }
  });

  return router;
}
