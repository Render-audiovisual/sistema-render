import { editorialPieceIdentity } from './editorial-publication.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { editorialOperationalDto } from './operational-dto.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const domains = ['historia', 'publicacion'];
const common = ['estado','prioridad','idea','copy','material_referencia','aclaraciones'];
const story = ['cliente_id','fecha_programada','responsable','responsable_planificacion','responsable_diseño',
  'responsable_revisión','responsable_publicacion','fecha_diseño_entrega','fecha_revisión_aprobación',
  'notas_planificacion','notas_diseño','notas_revisión','notas_bloqueador','metadata'];
const publication = ['tipo','fecha_programada','responsable','duracion_segundos','num_imagenes',
  'responsable_diseño','responsable_edición','responsable_revisión','responsable_publicacion',
  'fecha_diseño_entrega','fecha_edición_entrega','fecha_revisión_aprobación','metadata'];

export function legacyPieceSelection(rawId, query = {}, write = false) {
  // Validate the ID even if the caller has not selected its domain yet.
  const identity = editorialPieceIdentity('historia', rawId);
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => key !== 'dominio')) throw fail('Selector de pieza inválido.');
  if (query.dominio !== undefined && !domains.includes(query.dominio)) throw fail('Dominio de pieza inválido.');
  if (write && query.dominio === undefined) throw fail('Elegí el dominio de la pieza antes de editar.', 428);
  return { id: identity.id, domain: query.dominio ?? null };
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && !value.startsWith('0000-') && parsed.toISOString().slice(0,10) === value;
}

export function normalizeEditorialPiecePatch(domain, body, legacy = false) {
  if (!domains.includes(domain) || !body || typeof body !== 'object' || Array.isArray(body)) throw fail('Edición editorial inválida.');
  const allowed = legacy ? common : [...common, ...(domain === 'historia' ? story : publication)];
  if (Object.keys(body).some(key => !['expected_revision',...allowed].includes(key))) throw fail('Campos editoriales inválidos.');
  if (!Object.hasOwn(body,'expected_revision')) throw fail('Actualizá la pieza para obtener su revisión antes de editar.',428);
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw fail('Revisión editorial inválida.');
  const fields = {};
  for (const key of allowed) {
    if (!Object.hasOwn(body,key) || body[key] === null) continue; // retain historical null-as-omission semantics
    const value = body[key];
    if (key === 'estado') {
      if (value === 'publicada') throw fail('Registrá la publicación real desde su confirmación editorial.',409);
      const states = domain === 'historia'
        ? ['pendiente','en_diseño','en_revision','en_revisión','lista','bloqueada']
        : ['pendiente','en_diseño','en_edición','en_revision','en_revisión','lista','bloqueada'];
      if (!states.includes(value)) throw fail('Estado editorial inválido.');
    } else if (key === 'prioridad') {
      if (!['baja','media','alta'].includes(value)) throw fail('Prioridad inválida.');
    } else if (key === 'tipo') {
      if (!['video','carrusel'].includes(value)) throw fail('Tipo de publicación inválido.');
    } else if (key === 'cliente_id') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw fail('Cliente inválido.');
    } else if (key.startsWith('fecha_')) {
      if (!date(value)) throw fail('Fecha editorial inválida.');
    } else if (['duracion_segundos','num_imagenes'].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw fail('Cantidad editorial inválida.');
    } else if (key === 'metadata') {
      if (typeof value !== 'object' || Array.isArray(value)) throw fail('Metadatos editoriales inválidos.');
    } else if (typeof value !== 'string' || value.includes('\u0000')) throw fail('Texto editorial inválido.');
    fields[key] = value;
  }
  if (!Object.keys(fields).length) throw fail('No hay campos editoriales para guardar.');
  if (Buffer.byteLength(JSON.stringify(fields),'utf8') > 1024 * 1024) throw fail('La edición supera el límite de 1 MiB.',413);
  return { expected_revision: body.expected_revision, fields };
}

function captureActor(auth) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1 || !Number.isSafeInteger(auth.session_version)
    || auth.session_version < 1 || typeof auth.rol !== 'string') throw fail('Sesión requerida.',401);
  return { id: auth.id, session_version: auth.session_version, rol: auth.rol };
}

async function currentActor(db, auth, write) {
  const user = (await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1${write ? ' FOR SHARE' : ''}`, [auth.id])).rows[0];
  if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version) throw fail('La sesión cambió. Volvé a ingresar.',401);
  if (write && user.rol !== 'admin') throw fail('Solo administración puede editar piezas.',403);
  if (user.rol !== auth.rol) throw fail('Los permisos de la sesión cambiaron.',401);
  return user;
}

// Only whitelisted tables/columns enter these templates. Piece -> version is the
// established trigger064 order. Every UPDATE advances that shared revision.
async function readPiece(db, identity) {
  const type = identity.domain === 'historia' ? "'historia'::text" : 'p.tipo';
  const rows = (await db.query(`SELECT p.*, '${identity.domain}'::text AS origen,${type} AS tipo,
    c.nombre AS cliente_nombre,to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada
    FROM ${identity.table} p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id=$1`,[identity.id])).rows;
  if (!rows.length) throw fail('Pieza no encontrada.',404);
  const [annotated] = await annotateEditorialEvidence(db,identity.domain,rows);
  const revision = annotated.publicacion_evidencia.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisión editorial no representable.');
  return { ...annotated, revision };
}

function legacyDto(row, user) {
  const keys = ['origen','id','tipo','estado','cliente_id','cliente_nombre','responsable','fecha_programada',
    'idea','copy','material_referencia','aclaraciones','prioridad','created_at','updated_at','revision','publicacion_evidencia'];
  return editorialOperationalDto(Object.fromEntries(keys.map(key=>[key,row[key]])),user);
}

export async function readLegacyEditorialPiece(pool, auth, rawId, query) {
  const selected = legacyPieceSelection(rawId,query), observed = captureActor(auth);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = await currentActor(db,observed,false);
    let domain = selected.domain;
    if (!domain) {
      const matches = (await db.query(`SELECT 'historia'::text AS dominio FROM historias WHERE id=$1
        UNION ALL SELECT 'publicacion'::text AS dominio FROM publicaciones WHERE id=$1`,[selected.id])).rows;
      if (!matches.length) throw fail('Pieza no encontrada.',404);
      if (matches.length !== 1) throw fail('Ese ID corresponde a más de una pieza. Elegí su dominio.',409);
      domain = matches[0].dominio;
    }
    const result = legacyDto(await readPiece(db,editorialPieceIdentity(domain,rawId)),user);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard=rollback; }
    throw error;
  } finally { db.release(discard); }
}

export async function writeEditorialPiece(pool, auth, domain, rawId, body, { legacy = false } = {}) {
  const identity = editorialPieceIdentity(domain,rawId), input = normalizeEditorialPiecePatch(domain,body,legacy);
  const observed = captureActor(auth), db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    const user = await currentActor(db,observed,true);
    const found = (await db.query(`SELECT cliente_id FROM ${identity.table} WHERE id=$1`,[identity.id])).rows[0];
    if (!found) throw fail('Pieza no encontrada.',404);
    const clients = [...new Set([found.cliente_id,input.fields.cliente_id].filter(Boolean))].sort((a,b)=>a-b);
    const locked = (await db.query('SELECT id FROM clientes WHERE id=ANY($1::int[]) AND activo IS DISTINCT FROM FALSE ORDER BY id FOR SHARE',[clients])).rows;
    if (locked.length !== clients.length) throw fail('El cliente no está disponible.',409);
    const current = (await db.query(`SELECT cliente_id,estado FROM ${identity.table} WHERE id=$1 FOR UPDATE`,[identity.id])).rows[0];
    if (!current) throw fail('Pieza no encontrada.',404);
    if (current.cliente_id !== found.cliente_id) throw fail('La pieza cambió de cliente. Actualizá antes de editar.',409);
    const version = (await db.query('SELECT revision FROM editorial_publicacion_versiones WHERE dominio=$1 AND pieza_id=$2',[domain,identity.id])).rows[0];
    if (Number(version?.revision ?? 0) !== input.expected_revision) throw fail('La pieza cambió. Actualizá antes de reintentar.',409);
    if (current.estado === 'publicada' && input.fields.estado !== undefined && input.fields.estado !== 'publicada') {
      throw fail('Retirá la confirmación desde el registro de publicación antes de cambiar su estado.',409);
    }
    const values = [], updates = [];
    for (const [key,value] of Object.entries(input.fields)) {
      const index = values.push(key === 'metadata' ? JSON.stringify(value) : value);
      if (key === 'metadata') updates.push(`metadata=COALESCE(metadata,'{}'::jsonb)||$${index}::jsonb`);
      else {
        updates.push(`${key}=$${index}`);
        if (key === 'fecha_programada' && domain === 'publicacion') updates.push(`fecha_bloqueada=CASE WHEN $${index}::date IS DISTINCT FROM fecha_programada THEN TRUE ELSE fecha_bloqueada END`);
      }
    }
    updates.push('updated_at=clock_timestamp()');
    const idIndex = values.push(identity.id);
    await db.query(`UPDATE ${identity.table} SET ${updates.join(',')} WHERE id=$${idIndex}`,values);
    const row = await readPiece(db,identity);
    const result = legacy ? legacyDto(row,user) : editorialOperationalDto(row,user);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard=rollback; }
    throw error;
  } finally { db.release(discard); }
}
