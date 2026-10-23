import { createHash } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function personalListCreationRequestId(value) {
  if (value === undefined) throw fail(428, 'Falta el identificador del intento de creación.');
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw fail(400, 'El identificador del intento de creación no es válido.');
  }
  return value.toLowerCase();
}
const capture = auth => {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  return Object.freeze({ id: auth.id, session_version: auth.session_version, rol: auth.rol });
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const personalListCreationHash = payload => createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');

async function actor(db, observed, write) {
  // Direct exclusive acquisition, never SHARE -> UPDATE upgrade. This also
  // serializes MIA default creation, which SHARE-locks this target user first.
  const current = (await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [observed.id])).rows[0];
  if (!current || current.id !== observed.id || current.activo !== true || current.session_version !== observed.session_version || current.rol !== observed.rol) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
}
const receipt = async (db, actorId, requestId) => (await db.query(`SELECT payload_hash,list_id FROM personal_list_create_receipts
  WHERE actor_user_id=$1 AND request_id=$2`, [actorId, requestId])).rows[0];

async function ownedList(db, listId, userId, lock = false) {
  // Every child query remains owner-scoped, including after a tombstoned receipt.
  const list = (await db.query(`SELECT id,titulo,emoji,posicion,version,created_at,updated_at
    FROM listas_personales WHERE id=$1 AND usuario_id=$2${lock ? ' FOR SHARE' : ''}`, [listId, userId])).rows[0];
  if (!list) return null;
  const sections = (await db.query(`SELECT s.id,s.lista_id,s.titulo,s.posicion,s.version,s.created_at,s.updated_at
    FROM lista_secciones s JOIN listas_personales l ON l.id=s.lista_id
    WHERE l.id=$1 AND l.usuario_id=$2 ORDER BY s.posicion,s.id`, [listId, userId])).rows;
  const items = (await db.query(`SELECT i.id,i.seccion_id,i.texto,i.completado,i.posicion,i.version,i.created_at,i.updated_at
    FROM lista_items i JOIN lista_secciones s ON s.id=i.seccion_id JOIN listas_personales l ON l.id=s.lista_id
    WHERE l.id=$1 AND l.usuario_id=$2 ORDER BY i.posicion,i.id`, [listId, userId])).rows;
  const blocks = (await db.query(`SELECT b.id,b.lista_id,b.tipo,b.contenido,b.posicion,b.version,b.created_at,b.updated_at
    FROM lista_bloques b JOIN listas_personales l ON l.id=b.lista_id
    WHERE l.id=$1 AND l.usuario_id=$2 ORDER BY b.posicion,b.id`, [listId, userId])).rows;
  return { ...list, secciones: sections.map(section => ({ ...section, items: items.filter(item => String(item.seccion_id) === String(section.id)) })), bloques: blocks };
}
async function transaction(pool, observed, write, run) {
  const db = await pool.connect(); let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await actor(db, observed, write);
    const result = await run(db);
    await db.query('COMMIT'); return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}

// Input is the existing business normalizer's output; snapshot synchronously
// before the pool lease. The immutable hash excludes UUID/session/DB labels.
export async function createPersonalListWithReceipt(pool, auth, { requestId, payload }) {
  const observed = capture(auth), key = personalListCreationRequestId(requestId);
  const input = JSON.parse(JSON.stringify(payload)), hash = personalListCreationHash(input);
  return transaction(pool, observed, true, async db => {
    const previous = await receipt(db, observed.id, key);
    if (previous) {
      if (previous.payload_hash !== hash) throw fail(409, 'Ese intento ya se usó con otros datos. Revisá la lista guardada.');
      const list = await ownedList(db, previous.list_id, observed.id, true);
      if (!list) throw fail(409, 'La lista creada ya no está disponible. No se volvió a crear.');
      return { replayed: true, list: { ...list, creation_request_id: key } };
    }
    const count = (await db.query('SELECT COUNT(*)::int total FROM listas_personales WHERE usuario_id=$1', [observed.id])).rows[0];
    if (count.total >= 100) throw fail(409, 'Alcanzaste el límite de listas personales.');
    const list = (await db.query(`INSERT INTO listas_personales(usuario_id,titulo,emoji,posicion)
      VALUES($1,$2,$3,(SELECT COALESCE(MAX(posicion),-1)+1 FROM listas_personales WHERE usuario_id=$1))
      RETURNING id,titulo,emoji,posicion,version,created_at,updated_at`, [observed.id, input.titulo, input.emoji])).rows[0];
    await db.query(`INSERT INTO lista_secciones(lista_id,titulo,posicion) VALUES($1,'Pendientes',0)`, [list.id]);
    for (const [position, block] of input.bloques.entries()) await db.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion)
      VALUES($1,$2,$3::jsonb,$4)`, [list.id, block.tipo, JSON.stringify(block.contenido), position]);
    await db.query(`INSERT INTO personal_list_create_receipts(actor_user_id,request_id,payload_hash,list_id)
      VALUES($1,$2,$3,$4)`, [observed.id, key, hash, list.id]);
    const current = await ownedList(db, list.id, observed.id, true);
    if (!current) throw new Error('Personal list creation readback unavailable');
    return { replayed: false, list: { ...current, creation_request_id: key } };
  });
}

export async function findPersonalListCreation(pool, auth, requestId) {
  const observed = capture(auth), key = personalListCreationRequestId(requestId);
  return transaction(pool, observed, false, async db => {
    const previous = await receipt(db, observed.id, key);
    if (!previous) throw fail(404, 'No se encontró una creación para ese intento.');
    const list = await ownedList(db, previous.list_id, observed.id, true);
    if (!list) throw fail(409, 'La lista creada ya no está disponible. No se volvió a crear.');
    return { ...list, creation_request_id: key };
  });
}
