import { normalizeFeedbackResponsibleIds } from '../../shared/feedback-responsibles.mjs';

const own = (value,key) => Object.hasOwn(value ?? {},key);
const labels = value => [...new Set([...(Array.isArray(value?.responsables) ? value.responsables : []),value?.responsable]
  .filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
const comparable = value => labels(value).map(label => label.toLocaleLowerCase('es')).sort();
const fail = (status,message) => Object.assign(new Error(message),{status});

// This is operational selection, never a note ACL. Validate new selections on
// the writer's transaction client; preserve historical labels without guessing.
export async function resolveFeedbackResponsibleSelection(db,patch,current={}) {
  const next = {...patch};
  if (!own(patch,'responsable_ids')) {
    if (!own(current,'responsable_ids')) return next;
    if ((own(patch,'responsable') || own(patch,'responsables'))
      && JSON.stringify(comparable(patch)) !== JSON.stringify(comparable(current))) {
      throw fail(409,'Esta nota tiene responsables por ID. Elegí las personas explícitamente para cambiar la selección.');
    }
    next.responsable_ids = normalizeFeedbackResponsibleIds(current.responsable_ids);
    return next;
  }
  const ids = normalizeFeedbackResponsibleIds(patch.responsable_ids);
  if (own(current,'responsable_ids')
    && JSON.stringify(ids) === JSON.stringify(normalizeFeedbackResponsibleIds(current.responsable_ids))) {
    // An unrelated edit must not erase a retired account or reinterpret its
    // identity because the current active directory no longer lists it.
    const preserved=Array.isArray(current.responsables)?[...current.responsables]:labels(current);
    return {...next,responsable_ids:ids,responsables:preserved,responsable:current.responsable || preserved[0] || ''};
  }
  const rows = ids.length ? (await db.query(`SELECT id,nombre,usuario FROM usuarios
    WHERE id=ANY($1::integer[]) AND activo IS TRUE ORDER BY id FOR SHARE`,[ids])).rows : [];
  if (rows.length !== ids.length || rows.some((row,index) => row.id !== ids[index]
    || typeof row.nombre !== 'string' || typeof row.usuario !== 'string')) {
    throw fail(422,'Alguna persona seleccionada ya no está activa o no está disponible. Revisá los responsables.');
  }
  const names = rows.map(row => row.nombre || row.usuario);
  return {...next,responsable_ids:ids,responsables:names,responsable:names[0] || ''};
}
