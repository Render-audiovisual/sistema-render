import express from 'express';
import { requireRole } from './auth.js';

export const GOALS_START_PERIOD = '2026-10';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function goalPeriod(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''))) throw fail('Elegí un mes válido.');
  return String(value);
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
    }
    group.cuentas.push({ id: row.id, nombre: row.nombre });
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
  const clients = await loadGoalClients(db, period);
  const objectives = await db.query(`SELECT id,clave,nombre,cuentas,reels,carruseles,
    to_char(periodo,'YYYY-MM') periodo FROM cliente_objetivos_mensuales WHERE periodo=$1::date`, [`${period}-01`]);
  const pieces = await db.query(`SELECT p.id,p.objetivo_id,p.tipo,p.numero,p.tarea_id,p.publicacion_id,p.titulo,p.copy,
    p.responsables,p.estado,p.completada_at,p.updated_at
    FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id
    WHERE o.periodo=$1::date ORDER BY p.tipo DESC,p.numero`, [`${period}-01`]);
  const byKey = new Map(objectives.rows.map(row => [row.clave, row]));
  for (const stored of objectives.rows) {
    if (!clients.some(client => client.clave === stored.clave)) clients.push({ ...stored, cliente_id: stored.cuentas[0]?.id });
  }
  const assignments = await loadGoalAssignments(db, clients, period);
  return { periodo: period, inicio_seguimiento: GOALS_START_PERIOD, clientes: clients.map(client => {
    const stored = byKey.get(client.clave);
    return { ...client, ...(stored || {}), preparado: Boolean(stored), responsables_por_formato: assignments.get(client.clave),
      piezas: stored ? pieces.rows.filter(piece => piece.objetivo_id === stored.id) : [] };
  }) };
}

export async function prepareGoal(pool, { period, key, responsibleIds, responsibleByType, actor, persistResponsibles = false }) {
  goalPeriod(period);
  if (period < GOALS_START_PERIOD) throw fail('El nuevo seguimiento comienza en octubre de 2026. El historial anterior no se modifica.');
  if (!Array.isArray(responsibleIds) || !responsibleIds.length || responsibleIds.length > 20 ||
    responsibleIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw fail('Elegí al menos un responsable para las tareas nuevas.');
  if (responsibleByType && (Object.keys(responsibleByType).some(type => !['video','carrusel'].includes(type)) ||
    ['video','carrusel'].some(type => !Array.isArray(responsibleByType[type]) ||
      responsibleByType[type].some(id => !responsibleIds.includes(id))))) throw fail('Revisá los responsables de cada formato.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serializa preparaciones simultáneas del mismo feed/mes sin duplicar tareas.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`objetivo:${period}:${key}`]);
    const client = (await loadGoalClients(db, period)).find(item => item.clave === key);
    if (!client) throw fail('No hay un cliente activo para ese mes.', 404);
    if (client.reels > 100 || client.carruseles > 100) throw fail('Revisá el objetivo mensual antes de generar tareas.');
    const users = await db.query('SELECT id,nombre,usuario FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id', [[...new Set(responsibleIds)]]);
    if (users.rows.length !== new Set(responsibleIds).size) throw fail('Uno de los responsables ya no está disponible.');
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
    const existing = await db.query(`SELECT * FROM cliente_objetivos_mensuales WHERE clave=$1 AND periodo=$2::date FOR UPDATE`, [key, `${period}-01`]);
    let objective = existing.rows[0];
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
      ORDER BY (t.estado='publicada') DESC,t.id FOR UPDATE OF t`, [ids, period]);
    const publications = await db.query(`SELECT p.id,p.cliente_id,p.tipo,p.idea,p.copy,p.estado,
      to_char(p.fecha_programada,'YYYY-MM-DD') fecha_programada
      FROM publicaciones p WHERE p.cliente_id=ANY($1::int[]) AND to_char(p.fecha_programada,'YYYY-MM')=$2
        AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas link WHERE link.publicacion_id=p.id)
      ORDER BY (p.estado='publicada') DESC,p.id FOR UPDATE OF p`, [ids, period]);
    let created = 0, reused = 0;
    const seenPublications = new Set();
    for (const [type, quota] of [['video', objective.reels], ['carrusel', objective.carruseles]]) {
      const names = namesByType[type];
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
          const label = type === 'video' ? `Reel ${index}` : `Carrusel ${index}`;
          const title = type === 'carrusel' && piece?.idea ? piece.idea : `${label} · ${objective.nombre}`;
          const result = await db.query(`INSERT INTO tareas(titulo,estado,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,
            propiedades_extra,fecha_vencimiento) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
          [title, piece?.estado === 'publicada' ? 'publicada' : 'pendiente', names[0], piece?.cliente_id || client.cliente_id, piece?.id || null,
            type === 'video' ? 'edicion' : 'diseno', type === 'video' ? 'reel' : 'carrusel',
            JSON.stringify({ workspace: 'render_os', objetivo_periodo: period, colaboradores: names.slice(1),
              ...(piece ? { origen_pieza: true } : {}), copy_trabajo: piece?.copy || '' }), piece?.fecha_programada || null]);
          task = { ...result.rows[0], pieza_copy: piece?.copy || '' };
          created++;
        }
        const responsible = [...new Set([task.asignado_a, ...(Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [])].filter(Boolean))];
        await db.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy,responsables,estado,completada_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,CASE WHEN $9='publicada' THEN now() ELSE NULL END)`,
        [objective.id, type, index, task.id, task.publicacion_id, task.titulo,
          task.propiedades_extra?.copy_trabajo || task.pieza_copy || '', JSON.stringify(responsible), task.estado]);
      }
    }
    await db.query('COMMIT');
    return { creadas: created, vinculadas: reused, objetivo_id: objective.id };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function inheritedGoalResponsibles(db, client, period) {
  return (await loadGoalAssignments(db, [client], period)).get(client.clave);
}

async function loadGoalAssignments(db, clients, period) {
  // Sólo asignaciones explícitas: nunca inferir por la profesión ni por nombres parecidos.
  if (!clients.length) return new Map();
  const ids = [...new Set(clients.flatMap(client => client.cuentas.map(account => account.id)))];
  const configured = await db.query(`SELECT r.clave,r.tipo,u.id,u.nombre,u.usuario
    FROM cliente_objetivo_responsables r JOIN usuarios u ON u.id=r.usuario_id
    WHERE r.clave=ANY($1::text[]) ORDER BY u.id`, [clients.map(client => client.clave)]);
  const publications = await db.query(`SELECT cliente_id,tipo,responsable,"responsable_diseño","responsable_edición",
    "responsable_revisión",responsable_publicacion FROM publicaciones
    WHERE cliente_id=ANY($1::int[]) AND to_char(fecha_programada,'YYYY-MM')=$2`, [ids, period]);
  const designers = await db.query(`SELECT DISTINCT ON(cliente_id) cliente_id,disenador_responsable FROM cliente_configuraciones
    WHERE cliente_id=ANY($1::int[]) AND vigente_desde <= $2::date ORDER BY cliente_id,vigente_desde DESC`,
  [ids, `${period}-01`]);
  const tasks = await db.query(`SELECT t.cliente_id,t.titulo,t.subtipo,t.tipo_tarea,t.historia_id,t.tarea_padre_id,
    to_char(COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at),'YYYY-MM') periodo_asignacion,
    t.asignado_a,t.propiedades_extra,p.tipo pieza_tipo FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id
    WHERE t.cliente_id=ANY($1::int[]) AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at) < ($2 || '-01')::date + INTERVAL '1 month'
      ORDER BY COALESCE(p.fecha_programada,t.fecha_vencimiento,t.created_at) DESC,t.id DESC`, [ids,period]);
  const users = (await db.query('SELECT id,nombre,usuario FROM usuarios ORDER BY id')).rows;
  return new Map(clients.map(client => [client.clave, Object.fromEntries(['video','carrusel'].map(type => {
    const accountIds = new Set(client.cuentas.map(account => account.id));
    const explicit = configured.rows.filter(row => row.clave === client.clave && row.tipo === type);
    if (explicit.length) return [type, explicit.map(({id,nombre,usuario}) => ({id,nombre:nombre || usuario}))];
    const names = new Set(publications.rows.filter(row => accountIds.has(row.cliente_id) && row.tipo === type).flatMap(row =>
      [row.responsable, row[type === 'video' ? 'responsable_edición' : 'responsable_diseño'], row.responsable_revisión, row.responsable_publicacion]).filter(Boolean).map(name => name.trim().toLowerCase()));
    if (type === 'carrusel') designers.rows.filter(row => accountIds.has(row.cliente_id)).forEach(row => { if (row.disenador_responsable) names.add(row.disenador_responsable.trim().toLowerCase()); });
    // Las ediciones hijas aportan la identidad del editor, pero siguen sin
    // contarse como piezas adicionales en candidateTasks/prepareGoal.
    const relevantTasks = tasks.rows.filter(row => accountIds.has(row.cliente_id) && goalTaskType({...row,tarea_padre_id:null}) === type);
    // Si no existe una configuración explícita, heredar la última asignación
    // registrada para ese cliente/formato, no deducir personas por su rol.
    const taskMonth = relevantTasks.some(row => row.periodo_asignacion === period) ? period : relevantTasks[0]?.periodo_asignacion;
    const sourceTasks = relevantTasks.filter(row => row.periodo_asignacion === taskMonth);
    (taskMonth === period || !names.size ? sourceTasks : []).forEach(row => {
      for (const name of [row.asignado_a,...(Array.isArray(row.propiedades_extra?.colaboradores) ? row.propiedades_extra.colaboradores : [])]) {
        if (typeof name === 'string' && name.trim()) names.add(name.trim().toLowerCase());
      }
    });
    return [type, users.filter(user => names.has((user.nombre || '').trim().toLowerCase()) || names.has((user.usuario || '').trim().toLowerCase())).map(user => ({id:user.id,nombre:user.nombre || user.usuario}))];
  }))]));
}

export async function reconcileMonthlyGoals(pool, period) {
  goalPeriod(period);
  const result = { periodo: period, creadas: 0, vinculadas: 0, pendientes: [] };
  if (period < GOALS_START_PERIOD) return result;
  const clients = await loadGoalClients(pool, period);
  const assignments = await loadGoalAssignments(pool, clients, period);
  for (const client of clients) {
    if (!client.reels && !client.carruseles) continue;
    try {
      const byType = assignments.get(client.clave);
      const missing = [['video',client.reels],['carrusel',client.carruseles]].filter(([type, quota]) => quota > 0 && !byType[type].length);
      if (missing.length) { result.pendientes.push({ clave: client.clave, motivo: 'Faltan responsables configurados', formatos: missing.map(([type]) => type) }); continue; }
      const responsibleByType = Object.fromEntries(Object.entries(byType).map(([type, users]) => [type, users.map(user => user.id)]));
      const prepared = await prepareGoal(pool, { period, key:client.clave, responsibleByType,
        responsibleIds:[...new Set(Object.values(responsibleByType).flat())], persistResponsibles:true, actor:'Generación mensual automática' });
      result.creadas += prepared.creadas; result.vinculadas += prepared.vinculadas;
    } catch (error) {
      if (!error.status) throw error;
      result.pendientes.push({ clave:client.clave, motivo:error.message });
    }
  }
  return result;
}

export async function editGoalContent(pool, id, body = {}) {
  if (!Number.isSafeInteger(id) || id <= 0) throw fail('Pieza inválida.');
  if (Object.keys(body).some(key => !['titulo','copy','expected_updated_at'].includes(key)) ||
    typeof body.titulo !== 'string' || !body.titulo.trim() || body.titulo.length > 500 ||
    typeof body.copy !== 'string' || body.copy.length > 20000 ||
    typeof body.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_updated_at))) {
    throw fail('Revisá el título y el copy antes de guardar.');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // La pertenencia se verifica en la base: una etiqueta enviada por el cliente
    // no permite editar tareas privadas, reasignar ni cambiar estados.
    const piece = (await db.query(`SELECT t.id,t.updated_at FROM cliente_objetivo_piezas p
      JOIN tareas t ON t.id=p.tarea_id WHERE p.id=$1 AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true' FOR UPDATE OF t`, [id])).rows[0];
    if (!piece) throw fail('La tarea vinculada ya no está disponible.', 404);
    const updated = await db.query(`UPDATE tareas SET titulo=$1,
      propiedades_extra=COALESCE(propiedades_extra,'{}'::jsonb) || jsonb_build_object('copy_trabajo',$2::text), updated_at=now()
      WHERE id=$3 AND date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$4::timestamptz) RETURNING updated_at`,
    [body.titulo.trim(),body.copy,piece.id,body.expected_updated_at]);
    if (!updated.rows.length) throw fail('La tarea cambió mientras editabas. Recargá para no sobrescribir el trabajo de otra persona.', 409);
    await db.query('COMMIT'); return updated.rows[0];
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export function createClientGoalsRouter({ pool }) {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try { res.json(await readGoals(pool, goalPeriod(req.query.periodo))); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  router.get('/responsables', requireRole('admin', 'community'), async (_req, res, next) => {
    try { const result = await pool.query('SELECT id,nombre,rol FROM usuarios ORDER BY nombre'); res.json(result.rows); }
    catch (error) { next(error); }
  });
  router.patch('/piezas/:id/contenido', async (req, res, next) => {
    try { res.json(await editGoalContent(pool, Number(req.params.id), req.body)); }
    catch (error) { if (error.status) return res.status(error.status).json({ error:error.message }); next(error); }
  });
  router.post('/preparar', requireRole('admin', 'community'), async (req, res, next) => {
    try { res.json(await prepareGoal(pool, { period: req.body.periodo, key: String(req.body.clave || ''),
      responsibleIds: req.body.responsables, responsibleByType:req.body.responsables_por_formato,
      persistResponsibles:true, actor: req.auth.nombre || req.auth.usuario })); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  return router;
}
