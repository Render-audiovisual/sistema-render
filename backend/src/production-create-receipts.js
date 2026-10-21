import { createHash } from 'node:crypto';

const uuid = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const conflict = () => fail('Ese intento de creación ya se usó con otros datos. Revisá la visita guardada.', 409);

// Only POST /producciones uses this envelope; business validators never persist
// request metadata or accept it on PATCH/media/handoff routes.
export function extractProductionCreateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Campos no permitidos.');
  if (!Object.hasOwn(body, 'request_id')) return { requestId: null, body };
  if (!uuid(body.request_id)) throw fail('El identificador del intento no es válido.');
  const { request_id, ...business } = body;
  return { requestId: request_id.toLowerCase(), body: business };
}

// Input must be the full output of validateProductionVisit(), not raw JSON.
// Explicit field order plus sorted set IDs makes object/participant order inert.
export function productionCreateIntentHash(input) {
  const canonical = {
    cliente_id: input.cliente_id, fecha: input.fecha, titulo: input.titulo,
    participante_ids: [...input.participante_ids].sort((a, b) => a - b),
    observaciones: input.observaciones, drive_url: input.drive_url, tarea_origen_id: input.tarea_origen_id,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// Caller owns BEGIN/COMMIT and has already locked/revalidated current actor
// authority. Receipt mutex precedes all domain locks. Never retry writes here.
export async function withProductionCreateReceipt(db, { actorId, requestId, input }, { create, read }) {
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw fail('Identidad de producción inválida.', 401);
  if (requestId === null) return { visita: await create(), replayed: false };
  if (!uuid(requestId)) throw fail('El identificador del intento no es válido.');
  requestId = requestId.toLowerCase();
  const hash = productionCreateIntentHash(input);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify(['production-create-receipt-v1', actorId, requestId])]);
  const receipt = (await db.query(`SELECT payload_hash,visit_id FROM production_create_receipts
    WHERE actor_user_id=$1 AND request_id=$2`, [actorId, requestId])).rows[0];
  if (receipt) {
    if (receipt.payload_hash !== hash) throw conflict();
    const locked = await db.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR SHARE', [receipt.visit_id]);
    if (!locked.rows.length) throw fail('La visita guardada no está disponible. Revisá el registro antes de continuar.', 409);
    const visita = await read(receipt.visit_id);
    if (!visita || visita.id !== receipt.visit_id) throw fail('La visita guardada no está disponible. Revisá el registro antes de continuar.', 409);
    return { visita, replayed: true };
  }
  const visita = await create();
  if (!uuid(visita?.id)) throw new Error('Production creation did not return a visit identity.');
  await db.query(`INSERT INTO production_create_receipts(actor_user_id,request_id,payload_hash,visit_id)
    VALUES ($1,$2,$3,$4)`, [actorId, requestId, hash, visita.id]);
  return { visita, replayed: false };
}
