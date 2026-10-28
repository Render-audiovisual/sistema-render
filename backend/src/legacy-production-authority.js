import { assertCurrentTaskWriteActor, captureTaskWriteActor } from './task-state-authority.js';
import { buildTaskAccessClause } from './task-access.js';

export const captureLegacyProductionActor = captureTaskWriteActor;

export async function retainLegacyProductionActor(db, captured, { leader = false } = {}) {
  const actor = await assertCurrentTaskWriteActor(db, captured);
  if (leader && actor.rol !== 'admin') throw Object.assign(new Error('Esta confirmación requiere administración.'), {status:403});
  const identity = (await db.query('SELECT nombre,usuario FROM usuarios WHERE id=$1', [actor.id])).rows[0];
  return Object.freeze({...actor,...identity});
}

// Wilson has its own transport/confirmation authentication, not a browser JWT
// epoch. A borrowed transaction still retains its mapped active admin by ID.
export async function retainIntegrationProductionLeader(db, id) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647)
    throw Object.assign(new Error('Identidad de confirmación inválida.'), {status:403});
  const actor = (await db.query('SELECT id,nombre,usuario,rol,activo FROM usuarios WHERE id=$1 FOR SHARE',[id])).rows[0];
  if (!actor || actor.activo !== true || actor.rol !== 'admin')
    throw Object.assign(new Error('La identidad ya no puede confirmar grabaciones.'), {status:403});
  return Object.freeze(actor);
}

export async function assertLegacyProductionTaskAccess(db, actor, taskId) {
  const access = buildTaskAccessClause(actor, 't', '$2');
  const params = [taskId]; if (access.value) params.push(access.value);
  const allowed = await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1
    AND t.propiedades_extra->>'workspace'='render_os'${access.sql}`,params);
  if (!allowed.rows.length) throw Object.assign(new Error('Visita no encontrada o no asignada a tu cuenta.'), {status:404});
}
