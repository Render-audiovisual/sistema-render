import { personalListCreationRequestId, personalListCreationHash } from './personal-list-create-receipts.js';
import { withPersonalListWrite } from './personal-list-write-authority.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

// Same bounded canonical BIGINT contract as personalRecordId, without importing
// the router (which imports this module). Never round database IDs via Number.
function listId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && !/\s/.test(value) && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n) return value;
  throw fail(400, 'El identificador personal no es válido.');
}
function capture(auth) {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  return Object.freeze({ id: auth.id, rol: auth.rol, session_version: auth.session_version });
}
async function ownedList(db, id, userId) {
  const row = (await db.query('SELECT id FROM listas_personales WHERE id=$1 AND usuario_id=$2 FOR SHARE', [id, userId])).rows[0];
  if (!row) throw fail(404, 'Lista no encontrada.');
}
const receipt = async (db, actorId, requestId) => (await db.query(`SELECT payload_hash,list_id,block_id
  FROM personal_list_block_create_receipts WHERE actor_user_id=$1 AND request_id=$2`, [actorId, requestId])).rows[0];

async function ownedBlock(db, blockId, parentId, userId, requestId) {
  const block = (await db.query(`SELECT b.id,b.lista_id,b.tipo,b.contenido,b.posicion,b.version,b.created_at,b.updated_at
    FROM lista_bloques b JOIN listas_personales l ON l.id=b.lista_id
    WHERE b.id=$1 AND b.lista_id=$2 AND l.usuario_id=$3 FOR SHARE OF b`, [blockId, parentId, userId])).rows[0];
  if (!block) throw fail(409, 'El bloque creado ya no está disponible. No se volvió a crear.');
  return { ...block, creation_request_id: requestId };
}

// Business normalization belongs to the caller. Capture its normalized deep
// payload/list/UUID before leasing; request/session metadata is not hashed.
export async function createPersonalListBlockWithReceipt(pool, auth, { requestId, listId: parentId, payload } = {}) {
  const key = personalListCreationRequestId(requestId), id = listId(parentId);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(field => !['tipo', 'contenido'].includes(field))
    || typeof payload.tipo !== 'string' || !payload.contenido || typeof payload.contenido !== 'object' || Array.isArray(payload.contenido)) {
    throw fail(400, 'Los campos del bloque no son válidos.');
  }
  const input = structuredClone({ listId: id, tipo: payload.tipo, contenido: payload.contenido });
  const hash = personalListCreationHash(input);
  return withPersonalListWrite(pool, auth, input, async (db, captured, actor) => {
    await ownedList(db, captured.listId, actor.id);
    const previous = await receipt(db, actor.id, key);
    if (previous) {
      if (previous.payload_hash !== hash || listId(previous.list_id) !== captured.listId) {
        throw fail(409, 'Ese intento ya se usó con otros datos. Revisá el bloque guardado.');
      }
      return { replayed: true, block: await ownedBlock(db, previous.block_id, captured.listId, actor.id, key) };
    }
    const stats = (await db.query(`SELECT COUNT(*)::int total,COALESCE(MAX(posicion),-1)+1 AS next_position
      FROM lista_bloques WHERE lista_id=$1`, [captured.listId])).rows[0];
    if (stats.total >= 80) throw fail(409, 'Esta página ya tiene demasiados bloques.');
    const block = (await db.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion)
      VALUES($1,$2,$3::jsonb,$4) RETURNING id,lista_id,tipo,contenido,posicion,version,created_at,updated_at`,
    [captured.listId, captured.tipo, JSON.stringify(captured.contenido), stats.next_position])).rows[0];
    if (!block) throw new Error('Personal block creation readback unavailable');
    await db.query(`INSERT INTO personal_list_block_create_receipts(actor_user_id,request_id,list_id,block_id,payload_hash)
      VALUES($1,$2,$3,$4,$5)`, [actor.id, key, captured.listId, block.id, hash]);
    return { replayed: false, block: { ...block, creation_request_id: key } };
  });
}

// Lookup performs no DML, never creates missing blocks or repairs tombstones.
export async function findPersonalListBlockCreation(pool, auth, parentId, requestId) {
  const observed = capture(auth), key = personalListCreationRequestId(requestId), id = listId(parentId);
  const db = await pool.connect(); let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const current = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [observed.id])).rows[0];
    if (!current || current.id !== observed.id || current.activo !== true
      || current.session_version !== observed.session_version || current.rol !== observed.rol) {
      throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
    }
    await ownedList(db, id, observed.id);
    const previous = await receipt(db, observed.id, key);
    if (!previous || listId(previous.list_id) !== id) throw fail(404, 'No se encontró una creación para ese intento en esta lista.');
    const result = await ownedBlock(db, previous.block_id, id, observed.id, key);
    await db.query('COMMIT'); return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
