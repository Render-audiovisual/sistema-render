import { createHash } from 'node:crypto';
import { goalQuotaObservation } from './goal-quota-review.js';
import { captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function assertPreparationRevision(value) {
  if (value === undefined) throw fail(428, 'Abrí el objetivo del mes antes de confirmar la preparación.');
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) {
    throw fail(400, 'La observación de preparación no es válida.');
  }
}
const peopleIds = people => {
  if (!Array.isArray(people) || people.some(person => !positive(person?.id))) throw new Error('Invalid goal preparation assignments');
  return [...new Set(people.map(person => person.id))].sort((a, b) => a - b);
};
export function goalPreparationRevision(client, objective, pieces, period, byType, byAccount) {
  if (!client) return null;
  const observation = goalQuotaObservation(client, objective, pieces, period);
  const formats = ['video', 'carrusel'].map(type => [type, peopleIds(byType?.[type] || [])]);
  const accounts = client.cuentas.map(account => [account.id, peopleIds(byAccount?.[account.id] || [])]).sort((a, b) => a[0] - b[0]);
  const membership = [...pieces].sort((a,b) => a.id-b.id).map(piece => [piece.id, piece.preparation_membership || []]);
  return createHash('sha256').update(JSON.stringify(['goal-preparation-v1', observation.revision, formats, accounts, membership])).digest('hex');
}
export function parseGoalPreparation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['periodo', 'clave', 'responsables', 'responsables_por_formato', 'responsables_por_cuenta', 'expected_preparation_revision'].includes(key))
    || typeof body.clave !== 'string' || !/^(?:cliente|grupo)-[1-9]\d*$/.test(body.clave)
    || body.clave.trim() !== body.clave || !positive(Number(body.clave.split('-')[1]))) {
    throw fail(400, 'Campos de preparación no válidos.');
  }
  assertPreparationRevision(body.expected_preparation_revision);
  return { period: body.periodo, key: body.clave, responsibleIds: body.responsables,
    responsibleByType: body.responsables_por_formato, responsibleByAccount: body.responsables_por_cuenta };
}
export async function lockGoalPreparer(db, auth) {
  const authority = captureOwnerProfileWriteAuthority(auth);
  const observed = Object.freeze({ id: auth?.id, session_version: auth?.session_version, rol: auth?.rol });
  if (!positive(observed.id) || !positive(observed.session_version) || typeof observed.rol !== 'string') throw fail(401, 'Necesitás una sesión verificada.');
  await retainCapturedOwnerProfileAuthority(db, authority, { lockMode: 'share' });
  const current = (await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [observed.id])).rows[0];
  if (!current || current.id !== observed.id || current.activo !== true || current.session_version !== observed.session_version || current.rol !== observed.rol) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  if (!['admin', 'community'].includes(current.rol)) throw fail(403, 'No tenés permiso para preparar objetivos.');
  return current;
}
