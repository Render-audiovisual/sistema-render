import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { editorialPublicationDomainConflict } from './editorial-publication-errors.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const DOMAINS = { historia: 'historias', publicacion: 'publicaciones' };

export function editorialPieceIdentity(domain, rawId) {
  if (!Object.hasOwn(DOMAINS, domain) || typeof rawId !== 'string' || !/^[1-9]\d*$/.test(rawId)) throw fail('Pieza inválida.');
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id > 2147483647) throw fail('Pieza inválida.');
  return { domain, id, table: DOMAINS[domain] };
}

export function normalizePublicationInstant(value, now = Date.now()) {
  if (typeof value !== 'string') throw fail('Fecha de publicación inválida.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw fail('La fecha requiere hora y zona explícita.');
  const [, year, month, day, hour, minute, second, , zone, , offsetHour, offsetMinute] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  calendar.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (Number(year) < 1 || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month)
    || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) throw fail('Fecha de publicación inválida.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now) throw fail('La publicación no puede tener una fecha futura o inválida.');
  const result = new Date(time).toISOString();
  if (!/^\d{4}-/.test(result) || result.startsWith('0000-')) throw fail('Fecha fuera de rango.');
  return result;
}

export function normalizeEditorialPublicationInput(action, input, now = Date.now()) {
  if (!['confirmar', 'retirar'].includes(action) || !input || typeof input !== 'object' || Array.isArray(input)) throw fail('Solicitud inválida.');
  const keys = action === 'confirmar' ? ['request_id', 'expected_revision', 'occurred_at'] : ['request_id', 'expected_revision'];
  if (Object.keys(input).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(input, k))) throw fail('Campos inválidos.');
  if (typeof input.request_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.request_id)) throw fail('request_id inválido.');
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw fail('Revisión inválida.');
  return { request_id: input.request_id.toLowerCase(), expected_revision: input.expected_revision,
    ...(action === 'confirmar' ? { occurred_at: normalizePublicationInstant(input.occurred_at, now) } : {}) };
}

export function editorialPublicationIntentHash(domain, id, action, input) {
  return createHash('sha256').update(JSON.stringify({ dominio: domain, pieza_id: id, action,
    expected_revision: input.expected_revision, ...(action === 'confirmar' ? { occurred_at: input.occurred_at } : {}) })).digest('hex');
}

const instant = value => value === null || value === undefined ? null : new Date(value).toISOString();
export function editorialPublicationDto(piece, version, event, user) {
  const matches = event && version?.current_event_id === event.id && event.dominio === piece.dominio && event.pieza_id === piece.id && event.cliente_id === piece.cliente_id
    && event.action === 'confirmar' && event.source === 'manual' && piece.estado === 'publicada'
    && piece.fecha_publicacion_real && instant(event.occurred_at) === instant(piece.fecha_publicacion_real);
  const current = matches ? { id: event.id, actor_id: event.actor_id, occurred_at: instant(event.occurred_at), recorded_at: instant(event.recorded_at), source: 'manual' } : null;
  return { piece: { id: piece.id, dominio: piece.dominio, cliente_id: piece.cliente_id, estado: piece.estado,
    revision: version ? Number(version.revision) : 0, fecha_programada: piece.fecha_programada,
    fecha_publicacion_real: instant(piece.fecha_publicacion_real) },
  classification: current ? 'confirmada_manualmente' : piece.estado === 'publicada' || piece.fecha_publicacion_real ? 'historica_sin_confirmacion' : 'no_publicada',
  current_confirmation: current,
  can_confirm: Boolean(user?.activo === true && user.rol === 'admin' && !current) };
}

async function currentActor(db, auth, write) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1 || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
  const user = (await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1${write ? ' FOR SHARE' : ''}`, [auth.id])).rows[0];
  if (!user || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
  if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso editorial.', 403);
  if (write && user.rol !== 'admin') throw fail('Solo administración puede confirmar o retirar publicaciones.', 403);
  return user;
}

async function loadStatus(db, identity, user, write = false, expectedClient = null) {
  const piece = (await db.query(`SELECT p.id,p.cliente_id,p.estado,to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,
    p.fecha_publicación_real AS fecha_publicacion_real FROM ${identity.table} p JOIN clientes c ON c.id=p.cliente_id
    WHERE p.id=$1 AND c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'${write ? ' FOR UPDATE OF p' : ''}`, [identity.id])).rows[0];
  if (!piece) throw fail('Pieza no encontrada.', 404);
  if (write && piece.cliente_id !== expectedClient) throw fail('El cliente de la pieza cambió. Actualizá antes de reintentar.', 409);
  piece.dominio = identity.domain;
  const version = (await db.query(`SELECT revision,current_event_id FROM editorial_publicacion_versiones WHERE dominio=$1 AND pieza_id=$2${write ? ' FOR UPDATE' : ''}`, [identity.domain, identity.id])).rows[0] ?? null;
  if (version && (!Number.isSafeInteger(Number(version.revision)) || Number(version.revision) < 1)) throw new Error('Unsupported editorial revision.');
  const event = version?.current_event_id ? (await db.query(`SELECT e.id,e.dominio,e.pieza_id,e.cliente_id,e.actor_id,e.action,e.source,e.occurred_at,e.recorded_at
    FROM editorial_publicacion_eventos e JOIN ${identity.table} p ON p.id=e.pieza_id
    WHERE e.id=$1 AND e.dominio=$2 AND e.pieza_id=$3 AND e.cliente_id=p.cliente_id
    AND e.action='confirmar' AND e.source='manual' AND p.estado='publicada' AND p.fecha_publicación_real=e.occurred_at`, [version.current_event_id, identity.domain, identity.id])).rows[0] : null;
  const dto = editorialPublicationDto(piece, version, event, user);
  return { piece, version, event: dto.current_confirmation ? event : null, dto };
}

export function createEditorialPublicationRouter({ express, pool }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handler = action => async (req, res, next) => {
    let db;
    try {
      const identity = editorialPieceIdentity(req.params.dominio, req.params.id);
      if (Object.keys(req.query ?? {}).length) throw fail('No se permiten parámetros adicionales.');
      const input = action ? normalizeEditorialPublicationInput(action, req.body) : null;
      db = await pool.connect();
      await db.query(action ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const user = await currentActor(db, req.auth, Boolean(action));
      let expectedClient = null;
      if (action) {
        // Serialize actor/request across pieces before any piece/version lock.
        await db.query("SELECT pg_advisory_xact_lock(hashtext('editorial-publicacion-request'),hashtext($1))", [`${user.id}:${input.request_id}`]);
        const discovered = (await db.query(`SELECT cliente_id FROM ${identity.table} WHERE id=$1`, [identity.id])).rows[0];
        if (!discovered) throw fail('Pieza no encontrada.', 404);
        expectedClient = discovered.cliente_id;
        if (!(await db.query('SELECT id FROM clientes WHERE id=$1 AND activo IS DISTINCT FROM FALSE FOR SHARE', [expectedClient])).rows.length) throw fail('Pieza no encontrada.', 404);
      }
      const current = await loadStatus(db, identity, user, Boolean(action), expectedClient);
      let body = current.dto, status = 200;
      if (action) {
        const hash = editorialPublicationIntentHash(identity.domain, identity.id, action, input);
        const receipt = (await db.query('SELECT id,action,intent_hash FROM editorial_publicacion_eventos WHERE actor_id=$1 AND request_id=$2', [user.id, input.request_id])).rows[0];
        if (receipt) {
          if (receipt.intent_hash !== hash) throw fail('La clave ya se usó para otra intención.', 409);
          body = { ...body, operation: { id: receipt.id, action: receipt.action }, replayed: true, changed: false };
        } else {
          if (current.dto.piece.revision !== input.expected_revision) throw fail('La pieza cambió. Actualizá antes de reintentar.', 409);
          if (action === 'confirmar' && current.event) throw fail('Retirá la confirmación actual antes de confirmar otra publicación.', 409);
          if (action === 'retirar' && !current.event) throw fail('No hay una confirmación actual para retirar.', 409);
          const previous = (await db.query('SELECT id FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2 ORDER BY expected_revision DESC,recorded_at DESC,id DESC LIMIT 1', [identity.domain, identity.id])).rows[0]?.id ?? null;
          // Piece UPDATE advances the version via064 exactly once, and clears
          // invalidated evidence before attaching the new matching event.
          await db.query(`UPDATE ${identity.table} SET estado=$2,fecha_publicación_real=$3::timestamptz,updated_at=clock_timestamp() WHERE id=$1`, [identity.id, action === 'confirmar' ? 'publicada' : 'lista', input.occurred_at ?? null]);
          const id = randomUUID();
          await db.query(`INSERT INTO editorial_publicacion_eventos(id,dominio,pieza_id,historia_id,publicacion_id,cliente_id,actor_id,action,source,request_id,intent_hash,expected_revision,occurred_at,previous_event_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$11,$12::timestamptz,$13)`,
          [id, identity.domain, identity.id, identity.domain === 'historia' ? identity.id : null, identity.domain === 'publicacion' ? identity.id : null,
            current.piece.cliente_id, user.id, action, input.request_id, hash, input.expected_revision, input.occurred_at ?? null, previous]);
          if (action === 'confirmar') {
            const attached = await db.query('UPDATE editorial_publicacion_versiones SET current_event_id=$3 WHERE dominio=$1 AND pieza_id=$2 RETURNING revision', [identity.domain, identity.id, id]);
            if (!attached.rows.length) throw new Error('Missing editorial version after piece update.');
          }
          body = { ...(await loadStatus(db, identity, user)).dto, operation: { id, action }, replayed: false, changed: true };
          status = action === 'confirmar' ? 201 : 200;
        }
      }
      await db.query('COMMIT');
      res.status(status).json(body);
    } catch (error) {
      if (db) { try { await db.query('ROLLBACK'); } catch { /* preserve original failure */ } }
      if (error.status) res.status(error.status).json({ error: error.message });
      else if (editorialPublicationDomainConflict(error)) res.status(409).json({ error: 'La evidencia editorial cambió o no es compatible.' });
      else next(error);
    } finally { db?.release(); }
  };
  router.get('/:dominio/:id', handler(null));
  router.post('/:dominio/:id/confirmar', handler('confirmar'));
  router.post('/:dominio/:id/retirar', handler('retirar'));
  return router;
}
