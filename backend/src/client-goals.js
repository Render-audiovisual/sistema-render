import express from 'express';
import { requireRole } from './auth.js';
import { replaceTaskAssignments } from './task-assignments.js';
import { isTaskFinalized } from './workflow-contract.js';
import { buildTaskAccessClause } from './task-access.js';
import { lockClientAdministration } from './client-agreement.js';
import { GOAL_QUOTA_SOURCE, assertQuotaRevision, goalPieceInQuota, goalQuotaObservation, lockGoalQuotaReviewer, reviewGoalQuota } from './goal-quota-review.js';
import { assertPreparationRevision, goalPreparationRevision, lockGoalPreparer, parseGoalPreparation } from './goal-preparation.js';

export const GOALS_START_PERIOD = '2026-10';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function goalPeriod(value) {
  if (typeof value !== 'string' || value.length !== 7 || value.startsWith('0000-')
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw fail('Elegí un mes válido.');
  return value;
}

export function goalClients(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.grupo_feed_id ? `grupo-${row.grupo_feed_id}` : `cliente-${row.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { clave: key, cliente_id: row.id, nombre: row.grupo_feed_nombre || row.nombre,
        reels: Number(row.grupo_feed_id ? row.cuota_feed_reels : row.cuota_reels) || 0,
        carruseles: Number(row.grupo_feed_id ? row.cuota_feed_carruseles : row.cuota_carruseles) || 0, cuentas: [] };
      groups.set(key, group);
      Object.defineProperty(group, GOAL_QUOTA_SOURCE, { value: [] });
    }
    group.cuentas.push({ id: row.id, nombre: row.nombre });
    group[GOAL_QUOTA_SOURCE].push([row.id,row.agreement_version ?? null,row.grupo_feed_id ?? null,
      row.feed_agreement_version ?? null,row.cuota_reels ?? null,row.cuota_carruseles ?? null,
      row.cuota_feed_reels ?? null,row.cuota_feed_carruseles ?? null]);
  }
  return [...groups.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function goalTaskType(task) {
  if (task.historia_id || task.tipo_tarea === 'produccion') return null;
  if (task.pieza_tipo === 'carrusel') return 'carrusel';
  if (['reel', 'video'].includes(task.pieza_tipo)) return 'video';
  if (task.tarea_padre_id) return null;
  const text = `${task.titulo || ''} ${task.subtipo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/carrusel/.test(text)) return 'carrusel';
  if (/\breel\b|\bvideo\b/.test(text)) return 'video';
  return null;
}

export function candidateTasks(tasks, type, usedPublications = new Set()) {
  const seen = new Set(usedPublications);
  return tasks.filter(task => {
    if (goalTaskType(task) !== type) return false;
    if (task.publicacion_id && seen.has(Number(task.publicacion_id))) return false;
    if (task.publicacion_id) seen.add(Number(task.publicacion_id));
    return true;
  });
}

export async function loadGoalClients(db, period) {
  // Lista explícita: ningún campo financiero llega a este módulo ni a su API.
  const result = await db.query(`SELECT c.id,c.nombre,c.grupo_feed_id,gf.nombre grupo_feed_nombre,
    COALESCE(cfg.cuota_reels,c.cuota_reels,0) cuota_reels,
    COALESCE(cfg.cuota_carruseles,c.cuota_carruseles,0) cuota_carruseles,
    c.agreement_version,gf.agreement_version feed_agreement_version,
    gf.cuota_reels cuota_feed_reels,gf.cuota_carruseles cuota_feed_carruseles
    FROM clientes c LEFT JOIN grupos_feed gf ON gf.id=c.grupo_feed_id
    LEFT JOIN LATERAL (SELECT cuota_reels,cuota_carruseles FROM cliente_configuraciones cc
      WHERE cc.cliente_id=c.id AND cc.vigente_desde <= $1::date
      ORDER BY cc.vigente_desde DESC LIMIT 1) cfg ON TRUE
    WHERE (c.activo IS NOT FALSE OR c.fecha_fin >= $1::date)
      AND (c.fecha_inicio IS NULL OR c.fecha_inicio < $1::date + INTERVAL '1 month')
      AND (c.fecha_fin IS NULL OR c.fecha_fin >= $1::date)
    ORDER BY c.nombre`, [`${goalPeriod(period)}-01`]);
  return goalClients(result.rows);
}

export async function readGoals(db, period) {
  if (typeof db.connect === 'function' && typeof db.release !== 'function') {
    const client = await db.connect();
    let discard;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value = await readGoals(client, period);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
      throw error;
    } finally { client.release(discard); }
  }
  const clients = await loadGoalClients(db, period);
  const currentClients = new Map(clients.map(client => [client.clave,client]));
  const objectives = await db.query(`SELECT id,clave,nombre,cuentas,reels,carruseles,
    to_char(periodo,'YYYY-MM') periodo FROM cliente_objetivos_mensuales WHERE periodo=$1::date`, [`${period}-01`]);
  const pieces = await db.query(`SELECT p.id,p.objetivo_id,p.tipo,p.numero,p.tarea_id,p.publicacion_id,p.titulo,p.copy,
    p.responsables,p.estado,p.completada_at,p.updated_at,p.updated_at::text quota_piece_version,
    t.revision tarea_revision,t.updated_at tarea_updated_at,
    (SELECT COALESCE(jsonb_agg(jsonb_build_array(a.usuario_id,a.tipo) ORDER BY a.usuario_id,a.tipo),'[]'::jsonb)
      FROM tarea_asignaciones a WHERE a.tarea_id=t.id) AS preparation_membership
    FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id
    LEFT JOIN tareas t ON t.id=p.tarea_id
    WHERE o.periodo=$1::date ORDER BY p.tipo DESC,p.numero`, [`${period}-01`]);
  const byKey = new Map(objectives.rows.map(row => [row.clave, row]));
  for (const stored of objectives.rows) {
    if (!clients.some(client => client.clave === stored.clave)) clients.push({ ...stored, cliente_id: stored.cuentas[0]?.id });
  }
  const assignments = await loadGoalAssignments(db, clients, period);
  const accountAssignments = await loadGoalAccountAssignments(db, clients);
  return { periodo: period, inicio_seguimiento: GOALS_START_PERIOD, clientes: clients.map(client => {
    const stored = byKey.get(client.clave);
    const observedPieces = stored ? pieces.rows.filter(piece => piece.objetivo_id === stored.id) : [];
    const quota = goalQuotaObservation(currentClients.get(client.clave), stored, observedPieces, period);
    return { ...client, ...(stored || {}), preparado: Boolean(stored), responsables_por_formato: assignments.get(client.clave),
      responsables_por_cuenta: accountAssignments.get(client.clave) || {},
      cuota_actual: quota.current, cuota_desactualizada: quota.drift, cuota_revision: stored && quota.current ? quota.revision : null,
      preparacion_revision: goalPreparationRevision(currentClients.get(client.clave), stored, observedPieces, period,
        assignments.get(client.clave), accountAssignments.get(client.clave)),
      piezas: observedPieces.map(piece => {
        const { quota_piece_version, preparation_membership, ...publicPiece } = piece;
        return { ...publicPiece, en_cuota: goalPieceInQuota(piece, stored) };
      }) };
  }) };
}

export async function prepareGoal(pool, { period, key, responsibleIds, responsibleByType, responsibleByAccount, actor, persistResponsibles = false, quotaReview, preparation, automaticObservation }) {
  goalPeriod(period);
  if (quotaReview !== undefined && (typeof key !== 'string'
    || !/^(?:cliente|grupo)-[1-9]\d*$/.test(key) || /\s/.test(key)
    || !Number.isSafeInteger(Number(key.slice(key.indexOf('-') + 1)))
    || Number(key.slice(key.indexOf('-') + 1)) > 2147483647)) throw fail('Clave de objetivo no válida.');
  if (period < GOALS_START_PERIOD) throw fail('El nuevo seguimiento comienza en octubre de 2026. El historial anterior no se modifica.');
  if (preparation !== undefined) assertPreparationRevision(preparation?.expected);
  if (automaticObservation !== undefined) assertPreparationRevision(automaticObservation);
  if (!Array.isArray(responsibleIds) || !responsibleIds.length || responsibleIds.length > 20 ||
    responsibleIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw fail('Elegí al menos un responsable para las tareas nuevas.');
  if (responsibleByType && (Object.keys(responsibleByType).some(type => !['video','carrusel'].includes(type)) ||
    ['video','carrusel'].some(type => !Array.isArray(responsibleByType[type]) ||
      responsibleByType[type].some(id => !responsibleIds.includes(id))))) throw fail('Revisá los responsables de cada formato.');
  if (responsibleByAccount !== undefined && (!responsibleByAccount || typeof responsibleByAccount !== 'object' || Array.isArray(responsibleByAccount) ||
    Object.entries(responsibleByAccount).some(([id, selected]) => !/^[1-9]\d*$/.test(id) || !Array.isArray(selected) ||
      !selected.length || selected.some(userId => !responsibleIds.includes(userId))))) {
    throw fail('Revisá los responsables de carruseles de cada cuenta.');
  }
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN');
    // Every preparation path, including the internal scheduler, takes the
    // client mutex before user row locks. Never hold an actor while waiting
    // behind a scheduler that may need that same user row.
    await lockClientAdministration(db);
    let reviewer;
    if (preparation !== undefined) {
      const current = await lockGoalPreparer(db, preparation?.auth);
      actor = current.nombre || current.usuario;
    }
    if (quotaReview !== undefined) {
      assertQuotaRevision(quotaReview?.expected);
      reviewer = await lockGoalQuotaReviewer(db, quotaReview?.auth);
    }
    const client = (await loadGoalClients(db, period)).find(item => item.clave === key);
    if (!client) throw fail('No hay un cliente activo para ese mes.', 404);
    if (responsibleByAccount !== undefined && (client.cuentas.length < 2 ||
      Object.keys(responsibleByAccount).length !== client.cuentas.length ||
      client.cuentas.some(account => !Object.hasOwn(responsibleByAccount, String(account.id))))) {
      throw fail('Las cuentas deben pertenecer al mismo objetivo compartido.');
    }
    if (client.reels > 100 || client.carruseles > 100) throw fail('Revisá el objetivo mensual antes de generar tareas.');
    // All user locks precede task/editorial domain mutexes, matching task
    // writers. The client mutex already stabilizes quota/feed configuration.
    const storedAccounts = (await loadGoalAccountAssignments(db, [client])).get(key) || {};
    const accountIds = responsibleByAccount ?? Object.fromEntries(Object.entries(storedAccounts).map(([id, people]) => [id, people.map(person => person.id)]));
    const allIds = [...new Set([...responsibleIds, ...Object.values(accountIds).flat()])];
    const users = await db.query('SELECT id,nombre,usuario FROM usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE ORDER BY id FOR SHARE', [allIds]);
    if (users.rows.length !== allIds.length) throw fail('Uno de los responsables ya no está disponible.');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`objetivo:${period}:${key}`]);
    if (preparation !== undefined || automaticObservation !== undefined) {
      const objective = (await db.query('SELECT * FROM cliente_objetivos_mensuales WHERE clave=$1 AND periodo=$2::date FOR UPDATE', [key, `${period}-01`])).rows[0];
      let pieces = [];
      if (objective) {
        const found = (await db.query('SELECT id,tarea_id FROM cliente_objetivo_piezas WHERE objetivo_id=$1 ORDER BY id', [objective.id])).rows;
        const taskIds = [...new Set(found.map(piece => piece.tarea_id).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
        if (taskIds.length) await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [taskIds]);
        if (found.length) await db.query('SELECT id FROM cliente_objetivo_piezas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [found.map(piece => piece.id)]);
        pieces = (await db.query(`SELECT p.id,p.tipo,p.numero,p.tarea_id,p.publicacion_id,p.updated_at,p.updated_at::text quota_piece_version,p.estado,p.completada_at,t.revision tarea_revision,
          (SELECT COALESCE(jsonb_agg(jsonb_build_array(a.usuario_id,a.tipo) ORDER BY a.usuario_id,a.tipo),'[]'::jsonb)
            FROM tarea_asignaciones a WHERE a.tarea_id=t.id) AS preparation_membership
          FROM cliente_objetivo_piezas p LEFT JOIN tareas t ON t.id=p.tarea_id WHERE p.objetivo_id=$1 ORDER BY p.id`, [objective.id])).rows;
      }
      const formats = (await loadGoalAssignments(db, [client], period)).get(key);
      const accounts = (await loadGoalAccountAssignments(db, [client])).get(key);
      if (goalPreparationRevision(client, objective, pieces, period, formats, accounts) !== (preparation?.expected ?? automaticObservation)) {
        throw fail('La cuota, las cuentas, las piezas o los responsables cambiaron. Recargá antes de preparar.', 409);
      }
    }
    const namesByType = {};
    for (const type of ['video', 'carrusel']) {
      const selected = responsibleByType?.[type] || responsibleIds;
      namesByType[type] = users.rows.filter(user => selected.includes(user.id)).map(user => user.nombre || user.usuario);
      if (client[type === 'video' ? 'reels' : 'carruseles'] > 0 && !namesByType[type].length) {
        throw fail(`Configurá los responsables de ${type === 'video' ? 'reels' : 'carruseles'} de ${client.nombre}.`);
      }
      if (persistResponsibles) {
        await db.query('DELETE FROM cliente_objetivo_responsables WHERE clave=$1 AND tipo=$2', [key, type]);
        for (const user of users.rows.filter(user => selected.includes(user.id))) {
          await db.query('INSERT INTO cliente_objetivo_responsables(clave,tipo,usuario_id,actualizado_por) VALUES($1,$2,$3,$4)', [key, type, user.id, actor]);
        }
      }
    }
    if (persistResponsibles && responsibleByAccount !== undefined) {
      for (const account of client.cuentas) {
        const accountKey = `cliente-${account.id}`;
        await db.query("DELETE FROM cliente_objetivo_responsables WHERE clave=$1 AND tipo='carrusel'", [accountKey]);
        for (const userId of new Set(accountIds[account.id])) {
          await db.query("INSERT INTO cliente_objetivo_responsables(clave,tipo,usuario_id,actualizado_por) VALUES($1,'carrusel',$2,$3)", [accountKey, userId, actor]);
        }
      }
    }
    const existing = await db.query(`SELECT * FROM cliente_objetivos_mensuales WHERE clave=$1 AND periodo=$2::date FOR UPDATE`, [key, `${period}-01`]);
    let objective = existing.rows[0];
    if (objective) {
      if (quotaReview !== undefined) {
        const discovered = (await db.query('SELECT id,tarea_id FROM cliente_objetivo_piezas WHERE objetivo_id=$1 ORDER BY id', [objective.id])).rows;
        const taskIds = [...new Set(discovered.map(piece => piece.tarea_id).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a,b) => a-b);
        if (taskIds.length) await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [taskIds]);
        if (discovered.length) await db.query('SELECT id FROM cliente_objetivo_piezas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [discovered.map(piece => piece.id)]);
        const pieces = (await db.query(`SELECT p.id,p.tipo,p.numero,p.tarea_id,p.publicacion_id,p.updated_at,p.updated_at::text quota_piece_version,p.estado,p.completada_at,t.revision tarea_revision
          FROM cliente_objetivo_piezas p LEFT JOIN tareas t ON t.id=p.tarea_id WHERE p.objetivo_id=$1 ORDER BY p.id`, [objective.id])).rows;
        objective = await reviewGoalQuota(db, { client, objective, pieces, period, expected: quotaReview.expected, actorId: reviewer.id });
      } else if (goalQuotaObservation(client, objective, [], period).drift) {
        throw fail('Las cuotas del objetivo cambiaron. Administración debe reconciliarlas explícitamente.', 409);
      }
    } else if (quotaReview !== undefined) throw fail('Prepará el objetivo antes de reconciliar sus cuotas.', 409);
    if (!objective) {
      const inserted = await db.query(`INSERT INTO cliente_objetivos_mensuales
        (clave,periodo,cliente_id,nombre,cuentas,reels,carruseles,preparado_por)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
      [key, `${period}-01`, client.cliente_id, client.nombre, JSON.stringify(client.cuentas), client.reels, client.carruseles, actor]);
      objective = inserted.rows[0];
    }
    const linked = await db.query('SELECT tipo,numero FROM cliente_objetivo_piezas WHERE objetivo_id=$1', [objective.id]);
    const used = new Set(linked.rows.map(row => `${row.tipo}:${row.numero}`));
    const ids = objective.cuentas.map(account => account.id);
    const candidates = await db.query(`SELECT t.*,p.tipo pieza_tipo,p.copy pieza_copy
      FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id
      WHERE t.cliente_id=ANY($1::int[]) AND t.propiedades_extra->>'workspace'='render_os'
        AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
        AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
        AND COALESCE(t.propiedades_extra->>'objetivo_periodo',to_char(p.fecha_programada,'YYYY-MM'),to_char(t.fecha_vencimiento,'YYYY-MM'))=$2
        AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas link WHERE link.tarea_id=t.id OR link.publicacion_id=t.publicacion_id)
      ORDER BY t.id FOR UPDATE OF t`, [ids, period]);
    const publications = await db.query(`SELECT p.id,p.cliente_id,p.tipo,p.idea,p.copy,p.estado,
      to_char(p.fecha_programada,'YYYY-MM-DD') fecha_programada
      FROM publicaciones p WHERE p.cliente_id=ANY($1::int[]) AND to_char(p.fecha_programada,'YYYY-MM')=$2
        AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas link WHERE link.publicacion_id=p.id)
      ORDER BY p.id FOR UPDATE OF p`, [ids, period]);
    // Acquire row locks in canonical ID order, then preserve the existing
    // completion/publication preference in memory (never in lock acquisition).
    candidates.rows.sort((a, b) => Number(isTaskFinalized(b)) - Number(isTaskFinalized(a)) || a.id - b.id);
    publications.rows.sort((a, b) => Number(b.estado === 'publicada') - Number(a.estado === 'publicada') || a.id - b.id);
    let created = 0, reused = 0;
    const seenPublications = new Set();
    for (const [type, quota] of [['video', objective.reels], ['carrusel', objective.carruseles]]) {
      const available = candidateTasks(candidates.rows, type);
      for (let index = 1; index <= quota; index++) {
        if (used.has(`${type}:${index}`)) continue;
        let task = available.shift();
        if (task?.publicacion_id) seenPublications.add(Number(task.publicacion_id));
        if (task) reused++;
        else {
          const piece = publications.rows.find(row => row.tipo === type && !seenPublications.has(row.id) &&
            !candidates.rows.some(candidate => Number(candidate.publicacion_id) === row.id));
          if (piece) seenPublications.add(piece.id);
          const accountId = piece?.cliente_id || client.cliente_id;
          const selectedIds = type === 'carrusel' && accountIds[accountId]?.length
            ? accountIds[accountId] : (responsibleByType?.[type] || responsibleIds);
          const selectedUsers = users.rows.filter(user => selectedIds.includes(user.id));
          const names = selectedUsers.map(user => user.nombre || user.usuario);
          const label = type === 'video' ? `Reel ${index}` : `Carrusel ${index}`;
          const title = type === 'carrusel' && piece?.idea ? piece.idea : `${label} · ${objective.nombre}`;
          const result = await db.query(`INSERT INTO tareas(titulo,estado,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,
            propiedades_extra,fecha_vencimiento) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
          // Editorial publication alone is not approval/completion evidence for
          // a newly generated task. Reused task states are left untouched.
          [title, 'pendiente', names[0], accountId, piece?.id || null,
            type === 'video' ? 'edicion' : 'diseno', type === 'video' ? 'reel' : 'carrusel',
            JSON.stringify({ workspace: 'render_os', objetivo_periodo: period, colaboradores: names.slice(1),
              ...(piece ? { origen_pieza: true } : {}), copy_trabajo: piece?.copy || '' }), piece?.fecha_programada || null]);
          task = { ...result.rows[0], pieza_copy: piece?.copy || '' };
          // Names above remain display labels. Only explicitly selected IDs
          // grant task membership, atomically with the new task and goal piece.
          await replaceTaskAssignments(db, task.id, {
            ownerId: selectedUsers[0].id,
            collaboratorIds: selectedUsers.slice(1).map(user => user.id),
          });
          created++;
        }
        const responsible = [...new Set([task.asignado_a, ...(Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [])].filter(Boolean))];
        await db.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy,responsables,estado,completada_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,CASE WHEN $9 IN ('finalizada','publicada') THEN now() ELSE NULL END)`,
        [objective.id, type, index, task.id, task.publicacion_id, task.titulo,
          task.propiedades_extra?.copy_trabajo || task.pieza_copy || '', JSON.stringify(responsible), task.estado]);
      }
    }
    await db.query('COMMIT');
    return { creadas: created, vinculadas: reused, objetivo_id: objective.id };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally { db.release(discard); }
}

export async function inheritedGoalResponsibles(db, client, period) {
  return (await loadGoalAssignments(db, [client], period)).get(client.clave);
}

async function loadGoalAccountAssignments(db, clients) {
  const shared = clients.filter(client => client.cuentas.length > 1);
  if (!shared.length) return new Map();
  const result = await db.query(`SELECT r.clave,u.id,COALESCE(u.nombre,u.usuario) nombre
    FROM cliente_objetivo_responsables r JOIN usuarios u ON u.id=r.usuario_id
    WHERE r.clave=ANY($1::text[]) AND r.tipo='carrusel' AND u.activo IS TRUE ORDER BY u.id`,
  [shared.flatMap(client => client.cuentas.map(account => `cliente-${account.id}`))]);
  return new Map(shared.map(client => [client.clave, Object.fromEntries(client.cuentas.flatMap(account => {
    const people = result.rows.filter(row => row.clave === `cliente-${account.id}`).map(({id,nombre}) => ({id,nombre}));
    return people.length ? [[account.id,people]] : [];
  }))]));
}

async function loadGoalAssignments(db, clients, period) {
  // Sólo asignaciones explícitas: nunca inferir por la profesión ni por nombres parecidos.
  if (!clients.length) return new Map();
  const ids = [...new Set(clients.flatMap(client => client.cuentas.map(account => account.id)))];
  const configured = await db.query(`SELECT r.clave,r.tipo,u.id,u.nombre,u.usuario
    FROM cliente_objetivo_responsables r JOIN usuarios u ON u.id=r.usuario_id
    WHERE r.clave=ANY($1::text[]) AND u.activo IS TRUE ORDER BY u.id`, [clients.map(client => client.clave)]);
  const tasks = await db.query(`SELECT t.cliente_id,t.titulo,t.subtipo,t.tipo_tarea,t.historia_id,t.tarea_padre_id,
    to_char(COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at),'YYYY-MM') periodo_asignacion,
    a.usuario_id,u.nombre,u.usuario,p.tipo pieza_tipo FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id
    JOIN tarea_asignaciones a ON a.tarea_id=t.id
    JOIN usuarios u ON u.id=a.usuario_id AND u.activo IS TRUE
    WHERE t.cliente_id=ANY($1::int[]) AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at) < ($2 || '-01')::date + INTERVAL '1 month'
      ORDER BY COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at) DESC,t.id DESC`, [ids,period]);
  return new Map(clients.map(client => [client.clave, Object.fromEntries(['video','carrusel'].map(type => {
    const accountIds = new Set(client.cuentas.map(account => account.id));
    const explicit = configured.rows.filter(row => row.clave === client.clave && row.tipo === type);
    if (explicit.length) return [type, explicit.map(({id,nombre,usuario}) => ({id,nombre:nombre || usuario}))];
    // Las ediciones hijas aportan la identidad del editor, pero siguen sin
    // contarse como piezas adicionales en candidateTasks/prepareGoal.
    const relevantTasks = tasks.rows.filter(row => accountIds.has(row.cliente_id) && goalTaskType({...row,tarea_padre_id:null}) === type);
    // Si no existe una configuración explícita, heredar la última asignación
    // registrada para ese cliente/formato, no deducir personas por su rol.
    const taskMonth = relevantTasks.some(row => row.periodo_asignacion === period) ? period : relevantTasks[0]?.periodo_asignacion;
    const sourceTasks = relevantTasks.filter(row => row.periodo_asignacion === taskMonth);
    // Never resolve legacy display names into authority for future tasks.
    return [type, [...new Map(sourceTasks.map(row => [row.usuario_id,
      { id: row.usuario_id, nombre: row.nombre || row.usuario }])).values()]];
  }))]));
}

export async function reconcileMonthlyGoals(pool, period) {
  goalPeriod(period);
  const result = { periodo: period, creadas: 0, vinculadas: 0, pendientes: [] };
  if (period < GOALS_START_PERIOD) return result;
  // The job is trusted code, not a browser identity. Still bind its intended
  // assignments to one read-only observation so it cannot overwrite newer CM
  // choices after waiting for client administration or task locks.
  const clients = (await readGoals(pool, period)).clientes.filter(client => client.cuota_actual !== null);
  for (const client of clients) {
    if (client.cuota_desactualizada) {
      result.pendientes.push({ clave:client.clave, motivo:'Las cuotas del objetivo cambiaron. Administración debe reconciliarlas explícitamente.' });
      continue;
    }
    if (!client.reels && !client.carruseles) {
      continue;
    }
    try {
      const byType = client.responsables_por_formato;
      const missing = [['video',client.reels],['carrusel',client.carruseles]].filter(([type, quota]) => quota > 0 && !byType[type].length);
      if (missing.length) { result.pendientes.push({ clave: client.clave, motivo: 'Faltan responsables configurados', formatos: missing.map(([type]) => type) }); continue; }
      const responsibleByType = Object.fromEntries(Object.entries(byType).map(([type, users]) => [type, users.map(user => user.id)]));
      const prepared = await prepareGoal(pool, { period, key:client.clave, responsibleByType,
        responsibleIds:[...new Set(Object.values(responsibleByType).flat())], persistResponsibles:true, actor:'Generación mensual automática',
        automaticObservation:client.preparacion_revision });
      result.creadas += prepared.creadas; result.vinculadas += prepared.vinculadas;
    } catch (error) {
      if (!error.status) throw error;
      result.pendientes.push({ clave:client.clave, motivo:error.message });
    }
  }
  return result;
}

export async function editGoalContent(pool, id, body = {}, actor = {}) {
  if (!Number.isSafeInteger(id) || id <= 0) throw fail('Pieza inválida.');
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['titulo','copy','expected_updated_at','expected_revision'].includes(key)) ||
    typeof body.titulo !== 'string' || !body.titulo.trim() || body.titulo.length > 500 ||
    typeof body.copy !== 'string' || body.copy.length > 20000 ||
    typeof body.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_updated_at)) ||
    !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1) {
    throw fail('Revisá el título y el copy antes de guardar.');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // La pertenencia se verifica en la base: una etiqueta enviada por el cliente
    // no permite editar tareas privadas, reasignar ni cambiar estados.
    const access = buildTaskAccessClause(actor, 't', '$2');
    const piece = (await db.query(`SELECT t.id,t.updated_at FROM cliente_objetivo_piezas p
      JOIN tareas t ON t.id=p.tarea_id WHERE p.id=$1 AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'${access.sql} FOR UPDATE OF t`,
    access.value === null ? [id] : [id, access.value])).rows[0];
    if (!piece) throw fail('La tarea vinculada ya no está disponible.', 404);
    const updated = await db.query(`UPDATE tareas SET titulo=$1,
      propiedades_extra=COALESCE(propiedades_extra,'{}'::jsonb) || jsonb_build_object('copy_trabajo',$2::text), updated_at=now()
      WHERE id=$3 AND date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$4::timestamptz)
        AND revision=$5 RETURNING updated_at,revision`,
    [body.titulo.trim(),body.copy,piece.id,body.expected_updated_at,body.expected_revision]);
    if (!updated.rows.length) throw fail('La tarea cambió mientras editabas. Recargá para no sobrescribir el trabajo de otra persona.', 409);
    await db.query('COMMIT'); return updated.rows[0];
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const sameVersion = (actual, expected) => typeof expected === 'string' &&
  Number.isFinite(Date.parse(expected)) && new Date(actual).getTime() === Date.parse(expected);

async function goalLinkTask(db, id) {
  if (!positiveId(id)) throw fail('Elegí una tarea válida.');
  const task = (await db.query(`SELECT t.*,p.tipo pieza_tipo,p.copy pieza_copy,
    COALESCE(t.propiedades_extra->>'objetivo_periodo',to_char(p.fecha_programada,'YYYY-MM'),
      to_char(t.fecha_vencimiento,'YYYY-MM')) periodo_trabajo
    FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id WHERE t.id=$1`, [id])).rows[0];
  if (!task || task.propiedades_extra?.workspace !== 'render_os' ||
    String(task.propiedades_extra?.papelera_render_os) === 'true' ||
    String(task.propiedades_extra?.archivada_render_os) === 'true') throw fail('La tarea no está disponible en el tablero.', 404);
  // Una edición hija sólo se vincula explícitamente cuando está terminada;
  // jamás se cuenta una visita, historia o etapa de producción como entrega.
  const type = goalTaskType({ ...task, tarea_padre_id: null });
  if (!type || (task.tarea_padre_id && (task.tipo_tarea !== 'edicion' || !isTaskFinalized(task)))) {
    throw fail('Sólo podés vincular reels o carruseles. Una subtarea de edición debe estar completada.');
  }
  return { ...task, formato_objetivo: type };
}

async function taskFamilyLink(db, task, exceptPiece = 0) {
  return (await db.query(`SELECT p.id,p.numero,p.tipo,to_char(o.periodo,'YYYY-MM') periodo
    FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id
    LEFT JOIN tareas t ON t.id=p.tarea_id WHERE p.id<>$1 AND
      (p.tarea_id=$2 OR (p.publicacion_id IS NOT NULL AND p.publicacion_id=$3)
        OR COALESCE(t.tarea_padre_id,t.id)=$4) LIMIT 1`,
  [exceptPiece, task.id, task.publicacion_id, task.tarea_padre_id || task.id])).rows[0] || null;
}

export async function goalLinkOptions(db, taskId, period) {
  goalPeriod(period);
  if (period < GOALS_START_PERIOD) throw fail('El seguimiento comienza en octubre de 2026.');
  const task = await goalLinkTask(db, taskId);
  const linked = await taskFamilyLink(db, task);
  if (task.periodo_trabajo && task.periodo_trabajo !== period && !linked) {
    throw fail(`La tarea corresponde a ${task.periodo_trabajo}. Elegí ese mes para vincularla.`);
  }
  const objective = (await db.query(`SELECT id,nombre,reels,carruseles,to_char(periodo,'YYYY-MM') periodo
    FROM cliente_objetivos_mensuales WHERE periodo=$1::date AND
      EXISTS(SELECT 1 FROM jsonb_array_elements(cuentas) cuenta WHERE (cuenta->>'id')::int=$2)`,
  [`${period}-01`, task.cliente_id])).rows[0] || null;
  const slots = objective ? (await db.query(`SELECT p.id,p.tipo,p.numero,p.tarea_id,p.publicacion_id,p.titulo,p.estado,p.updated_at
    FROM cliente_objetivo_piezas p LEFT JOIN publicaciones pub ON pub.id=p.publicacion_id
    WHERE p.objetivo_id=$1 AND p.tipo=$2 AND p.estado='pendiente' AND p.completada_at IS NULL
      AND p.numero <= $3 AND (p.publicacion_id IS NULL OR pub.estado='pendiente') ORDER BY p.numero`,
  [objective.id, task.formato_objetivo,task.formato_objetivo === 'video' ? objective.reels : objective.carruseles])).rows : [];
  return { tarea: { id: task.id, titulo: task.titulo, estado: task.estado, tipo: task.formato_objetivo,
    revision: task.revision, updated_at: task.updated_at }, vinculo_actual: linked, objetivo: objective, casilleros: slots };
}

export async function linkGoalTask(pool, pieceId, body, actor) {
  if (!positiveId(pieceId) || !positiveId(body?.tarea_id) ||
    Object.keys(body).some(key => !['tarea_id','expected_tarea_updated_at','expected_pieza_updated_at'].includes(key)) ||
    !Number.isFinite(Date.parse(body.expected_tarea_updated_at)) ||
    !Number.isFinite(Date.parse(body.expected_pieza_updated_at))) throw fail('Recargá los datos antes de vincular.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
    const before = (await db.query(`SELECT p.tarea_id,p.publicacion_id,o.clave,to_char(o.periodo,'YYYY-MM') periodo
      FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id WHERE p.id=$1`, [pieceId])).rows[0];
    if (!before) throw fail('El casillero no existe.', 404);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`objetivo:${before.periodo}:${before.clave}`]);
    // Mismo orden que los triggers de estados: tarea antes de casillero.
    await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
      [[body.tarea_id, before.tarea_id].filter(Boolean)]);
    await db.query(`SELECT p.id FROM publicaciones p WHERE p.id=$2 OR p.id IN
      (SELECT publicacion_id FROM tareas WHERE id=$1) ORDER BY p.id FOR UPDATE`, [body.tarea_id,before.publicacion_id]);
    const task = await goalLinkTask(db, body.tarea_id);
    const piece = (await db.query(`SELECT p.*,to_char(o.periodo,'YYYY-MM') periodo,o.cuentas,o.reels,o.carruseles
      FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id
      WHERE p.id=$1 FOR UPDATE OF p`, [pieceId])).rows[0];
    if (!piece || !goalPieceInQuota(piece, piece)) throw fail('El casillero está fuera de la cuota actual.',409);
    if (!sameVersion(task.updated_at, body.expected_tarea_updated_at) ||
      !sameVersion(piece.updated_at, body.expected_pieza_updated_at) || before.tarea_id !== piece.tarea_id ||
      before.publicacion_id !== piece.publicacion_id) {
      throw fail('La tarea o el casillero cambiaron. Cerrá y volvé a abrir la vinculación.', 409);
    }
    // A generic task replacement cannot silently clear or swap an existing
    // editorial publication. It must not auto-link that publication either.
    if (piece.publicacion_id && piece.publicacion_id !== task.publicacion_id) {
      throw fail('El casillero ya tiene una publicación. Elegí su tarea canónica; no se reemplaza ni se borra ese vínculo.', 409);
    }
    if (piece.periodo < GOALS_START_PERIOD || !piece.cuentas.some(account => Number(account.id) === task.cliente_id) ||
      piece.tipo !== task.formato_objetivo || (task.periodo_trabajo && task.periodo_trabajo !== piece.periodo)) {
      throw fail('Cliente, mes y formato deben coincidir con el objetivo.');
    }
    if (piece.tarea_id === task.id || await taskFamilyLink(db, task, pieceId)) {
      throw fail('Esta tarea o una etapa de la misma pieza ya cuenta en un objetivo mensual.', 409);
    }
    const oldPublication = piece.publicacion_id && (await db.query('SELECT estado FROM publicaciones WHERE id=$1',[piece.publicacion_id])).rows[0];
    if (piece.estado !== 'pendiente' || piece.completada_at || (piece.publicacion_id && oldPublication?.estado !== 'pendiente')) {
      throw fail('Elegí un casillero pendiente. No se reemplaza trabajo ya realizado o programado.', 409);
    }
    const oldTask = piece.tarea_id && (await db.query('SELECT estado FROM tareas WHERE id=$1', [piece.tarea_id])).rows[0];
    if (oldTask && oldTask.estado !== 'pendiente') throw fail('La tarea inicial ya está en proceso. Elegí otro casillero.', 409);
    const people = [...new Set([task.asignado_a, ...(Array.isArray(task.propiedades_extra?.colaboradores)
      ? task.propiedades_extra.colaboradores : [])].filter(value => typeof value === 'string' && value.trim()))];
    await db.query(`INSERT INTO cliente_objetivo_vinculos(pieza_id,tarea_anterior_id,tarea_nueva_id,registro_anterior,actualizado_por)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [pieceId,piece.tarea_id,task.id,JSON.stringify(piece),actor]);
    await db.query(`UPDATE cliente_objetivo_piezas SET tarea_id=$2,publicacion_id=$3,titulo=$4,copy=$5,
      responsables=$6::jsonb,estado=$7,completada_at=CASE WHEN $7 IN ('finalizada','publicada') THEN now() ELSE NULL END,
      updated_at=now() WHERE id=$1`, [pieceId,task.id,task.publicacion_id,task.titulo,
      task.propiedades_extra?.copy_trabajo || task.pieza_copy || '',JSON.stringify(people),task.estado]);
    if (piece.estado !== task.estado) await db.query(`INSERT INTO cliente_objetivo_eventos
      (pieza_id,estado_anterior,estado_nuevo,tarea_id) VALUES($1,$2,$3,$4)`, [pieceId,piece.estado,task.estado,task.id]);
    const count = (await db.query(`SELECT count(*) FILTER(WHERE estado IN ('finalizada','publicada'))::int completadas,count(*)::int total
      FROM cliente_objetivo_piezas WHERE objetivo_id=$1 AND tipo=$2 AND numero <= $3`,
    [piece.objetivo_id,piece.tipo,piece.tipo === 'video' ? piece.reels : piece.carruseles])).rows[0];
    await db.query('COMMIT');
    return { pieza_id:pieceId, tarea_id:task.id, tarea_anterior_id:piece.tarea_id,
      publicacion_anterior_id:piece.publicacion_id, periodo:piece.periodo,
      tipo:piece.tipo, numero:piece.numero, ...count };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') throw fail('La tarea o publicación ya está vinculada. Recargá los datos.', 409);
    throw error;
  } finally { db.release(); }
}

export function createClientGoalsRouter({ pool }) {
  const router = express.Router();
  router.get('/tareas/:id/vinculo', requireRole('admin', 'community'), async (req, res, next) => {
    try { res.json(await goalLinkOptions(pool, Number(req.params.id), req.query.periodo)); }
    catch (error) { if (error.status) return res.status(error.status).json({error:error.message}); next(error); }
  });
  router.post('/piezas/:id/vincular', requireRole('admin', 'community'), async (req, res, next) => {
    try { res.json(await linkGoalTask(pool, Number(req.params.id), req.body, req.auth.nombre || req.auth.usuario)); }
    catch (error) { if (error.status) return res.status(error.status).json({error:error.message}); next(error); }
  });
  router.get('/', async (req, res, next) => {
    try { res.json(await readGoals(pool, goalPeriod(req.query.periodo))); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  router.get('/responsables', requireRole('admin', 'community'), async (_req, res, next) => {
    try { const result = await pool.query('SELECT id,nombre,rol FROM usuarios WHERE activo IS TRUE ORDER BY nombre'); res.json(result.rows); }
    catch (error) { next(error); }
  });
  router.patch('/piezas/:id/contenido', async (req, res, next) => {
    try { res.json(await editGoalContent(pool, Number(req.params.id), req.body, req.auth)); }
    catch (error) { if (error.status) return res.status(error.status).json({ error:error.message }); next(error); }
  });
  router.post('/preparar', requireRole('admin', 'community'), async (req, res, next) => {
    try { res.json(await prepareGoal(pool, { ...parseGoalPreparation(req.body),
      persistResponsibles:true, preparation: { expected:req.body.expected_preparation_revision,
        auth:{id:req.auth.id,rol:req.auth.rol,session_version:req.auth.session_version} } })); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  router.post('/reconciliar', requireRole('admin'), async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).some(key => !['periodo','clave','responsables','responsables_por_formato','responsables_por_cuenta','expected_quota_revision'].includes(key))) {
        throw fail('Campos de reconciliación no válidos.');
      }
      res.json(await prepareGoal(pool, { period: req.body.periodo, key: req.body.clave,
        responsibleIds: req.body.responsables, responsibleByType: req.body.responsables_por_formato,
        responsibleByAccount: req.body.responsables_por_cuenta, persistResponsibles: true,
        actor: req.auth.nombre || req.auth.usuario,
        quotaReview: { expected: req.body.expected_quota_revision, auth: req.auth } }));
    } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  return router;
}
