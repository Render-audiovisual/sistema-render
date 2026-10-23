import { lockClientAdministration } from './client-agreement.js';
import { captureClientCreator, lockCurrentClientCreator } from './client-create-authority.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || !Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) throw fail('Los campos de planificación no son válidos.');
}
function exactDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw fail('La fecha no es válida.');
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  if (date.toISOString().slice(0, 10) !== value) throw fail('La fecha no es válida.');
  return value;
}
export function normalizePlanningCheck(body) {
  fields(body, ['cliente_id', 'fecha', 'publicado']);
  if (!Object.hasOwn(body, 'cliente_id') || !positive(body.cliente_id)) throw fail('Cliente inválido.');
  if (!Object.hasOwn(body, 'publicado') || typeof body.publicado !== 'boolean') throw fail('Indicá el estado del checklist con verdadero o falso.');
  if (!Object.hasOwn(body, 'fecha')) throw fail('La fecha no es válida.');
  return Object.freeze({ cliente_id: body.cliente_id, fecha: exactDate(body.fecha), publicado: body.publicado });
}
export function normalizeSpecialDatePatch(id, body) {
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !positive(Number(id)) || String(Number(id)) !== id) throw fail('Fecha especial inválida.');
  fields(body, ['estado', 'idea']);
  if (Object.hasOwn(body, 'estado') && !['pendiente', 'en_curso', 'hecho'].includes(body.estado)) throw fail('Estado inválido.');
  if (Object.hasOwn(body, 'idea') && (typeof body.idea !== 'string' || body.idea.includes('\0'))) throw fail('La idea debe ser un texto válido.');
  return Object.freeze({ id: Number(id), estado: Object.hasOwn(body, 'estado') ? body.estado : null, idea: Object.hasOwn(body, 'idea') ? body.idea : null });
}

export const PLANNING_CHECK_SQL = `INSERT INTO check_publicacion (cliente_id,fecha,publicado,confirmado_por,confirmado_at)
  VALUES ($1,$2::date,$3,$4,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END)
  ON CONFLICT (cliente_id,fecha) DO UPDATE SET publicado=EXCLUDED.publicado,
    confirmado_por=EXCLUDED.confirmado_por,confirmado_at=EXCLUDED.confirmado_at,updated_at=now()
  RETURNING id,cliente_id,to_char(fecha,'YYYY-MM-DD') AS fecha,publicado,confirmado_por,confirmado_at`;
export const SPECIAL_DATE_PATCH_SQL = `UPDATE fechas_especiales SET estado=COALESCE($1,estado),idea=COALESCE($2,idea),updated_at=now()
  WHERE id=$3 RETURNING id,to_char(fecha,'YYYY-MM-DD') AS fecha,evento,tipo,anticipacion_dias,idea,estado`;

async function writeAsPlanningAdmin(pool, captured, operation) {
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN');
    await lockClientAdministration(db);
    // Middleware is not authority retained through a queued write. Hold the
    // current account lock until commit, before touching any planning record.
    const actor = await lockCurrentClientCreator(db, captured);
    const row = await operation(db, actor);
    await db.query('COMMIT');
    return row;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}

export async function savePlanningCheck(pool, auth, body) {
  const captured = captureClientCreator(auth), input = normalizePlanningCheck(body);
  return writeAsPlanningAdmin(pool, captured, async (db, actor) => {
    if (!(await db.query('SELECT id FROM clientes WHERE id=$1 FOR SHARE', [input.cliente_id])).rows.length) throw fail('Cliente no encontrado.', 404);
    const name = input.publicado ? actor.nombre?.trim() || actor.usuario?.trim() || `Usuario ${actor.id}` : null;
    return (await db.query(PLANNING_CHECK_SQL, [input.cliente_id, input.fecha, input.publicado, name])).rows[0];
  });
}

export async function updateSpecialDate(pool, auth, id, body) {
  const captured = captureClientCreator(auth), input = normalizeSpecialDatePatch(id, body);
  return writeAsPlanningAdmin(pool, captured, async db => {
    const row = (await db.query(SPECIAL_DATE_PATCH_SQL, [input.estado, input.idea, input.id])).rows[0];
    if (!row) throw fail('Fecha especial no encontrada.', 404);
    return row;
  });
}
