// Operational task credit, never payroll. Callers own authorization, the
// transaction and canonical resource locks; these helpers acquire no new locks.
export const EDITING_PROGRESS_TIMEZONE = 'America/Argentina/Buenos_Aires';
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const states = ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada'];
const fail = (message, status = 409, code = 'editing_progress_conflict') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('El esquema de progreso de edición no está disponible.', 503, 'editing_progress_schema_unavailable');

// Strict catalog contract. Whitespace only is ignored: changing grouping,
// casts, predicates, FK targets or constraint kinds must fail closed. These
// PostgreSQL deparse spellings need physical verification before integration.
export const EDITING_PROGRESS_SCHEMA = Object.freeze({
  columns: Object.freeze({
    id: ['bigint', true], tarea_id: ['bigint', true], editor_clave: ['text', true],
    titulo_snapshot: ['text', true], cliente_id: ['integer', false], estado_actual: ['text', true],
    entregada_at: ['timestamp with time zone', true], activa: ['boolean', true],
    baja_at: ['timestamp with time zone', false], created_at: ['timestamp with time zone', true],
    updated_at: ['timestamp with time zone', true], editor_user_id: ['integer', false],
    origen_registro: ['text', false], delivery_id: ['uuid', false], task_revision: ['integer', false],
  }),
  constraints: Object.freeze({
    editing_progress_v1_source: "CHECK (((origen_registro IS NULL) OR (origen_registro = 'canonical_delivery'::text)))",
    editing_progress_v1_identity: 'CHECK (CASE WHEN (origen_registro IS NULL) THEN ((editor_user_id IS NULL) AND (((delivery_id IS NULL) AND (task_revision IS NULL)) OR ((delivery_id IS NOT NULL) AND (task_revision IS NOT NULL) AND (task_revision > 0)))) ELSE ((editor_user_id IS NOT NULL) AND (editor_user_id > 0) AND (delivery_id IS NOT NULL) AND (task_revision IS NOT NULL) AND (task_revision > 0)) END)',
    editing_progress_v1_state: "CHECK ((estado_actual = ANY (ARRAY['pendiente'::text, 'en_progreso'::text, 'en_revision'::text, 'aprobada'::text, 'finalizada'::text, 'publicada'::text])))",
    editing_progress_v1_task_unique: 'UNIQUE (tarea_id)',
    editing_progress_v1_editor_fk: 'FOREIGN KEY (editor_user_id) REFERENCES usuarios(id) ON DELETE RESTRICT',
    editing_progress_v1_delivery_fk: 'FOREIGN KEY (tarea_id, delivery_id) REFERENCES task_editing_deliveries(task_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  }),
});
const compact = value => typeof value === 'string' ? value.replace(/\s+/g, '') : null;

export async function assertEditingProgressSchema(db) {
  const result = await db.query(`SELECT
    (SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull))
      FROM pg_attribute a WHERE a.attrelid=to_regclass('public.progreso_edicion_entregas')
      AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT json_agg(json_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),
      'validated',c.convalidated,'deferred',c.condeferrable))
      FROM pg_constraint c WHERE c.conrelid=to_regclass('public.progreso_edicion_entregas')) AS constraints`);
  const catalog = result.rows[0];
  if (!Array.isArray(catalog?.columns) || !Array.isArray(catalog?.constraints)) throw unavailable();
  for (const [name, [type, notNull]] of Object.entries(EDITING_PROGRESS_SCHEMA.columns)) {
    const found = catalog.columns.filter(c => c.name === name);
    if (found.length !== 1 || found[0].type !== type || found[0].notNull !== notNull) throw unavailable();
  }
  for (const [name, definition] of Object.entries(EDITING_PROGRESS_SCHEMA.constraints)) {
    const found = catalog.constraints.filter(c => c.name === name);
    if (found.length !== 1 || found[0].validated !== true || found[0].deferred !== false
      || compact(found[0].definition) !== compact(definition)) throw unavailable();
  }
  try {
    await db.query(`SELECT id,tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,
      activa,baja_at,created_at,updated_at,editor_user_id,origen_registro,delivery_id,task_revision
      FROM public.progreso_edicion_entregas LIMIT 0`);
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) throw unavailable();
    throw error;
  }
}

export function normalizeEditingProgressQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(k => !['periodo', 'editor_id'].includes(k))
    || typeof query.periodo !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(query.periodo)) {
    throw fail('Usá un período válido con formato YYYY-MM.', 400, 'editing_progress_query_invalid');
  }
  let editorId = null;
  if (Object.hasOwn(query, 'editor_id')) {
    if (typeof query.editor_id !== 'string' || !/^[1-9]\d*$/.test(query.editor_id) || !positive(Number(query.editor_id))) {
      throw fail('editor_id inválido.', 400, 'editing_progress_query_invalid');
    }
    editorId = Number(query.editor_id);
  }
  return Object.freeze({ periodo: query.periodo, editorId });
}

function revisionInput(input, deliveryRequired = false) {
  const keys = deliveryRequired ? ['taskId', 'deliveryId', 'expectedTaskRevision'] : ['taskId', 'expectedTaskRevision'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !keys.includes(k)) || !positive(input.taskId) || !positive(input.expectedTaskRevision)
    || (deliveryRequired && !uuid(input.deliveryId))) throw fail('Referencia de progreso inválida.', 400);
  return { ...input, ...(deliveryRequired ? { deliveryId: input.deliveryId.toLowerCase() } : {}) };
}

async function taskAtRevision(db, input) {
  const task = (await db.query(`SELECT id,revision,estado,tipo_tarea,titulo,cliente_id,propiedades_extra
    FROM tareas WHERE id=$1`, [input.taskId])).rows[0];
  if (!task || task.revision !== input.expectedTaskRevision || !states.includes(task.estado)) throw fail('La tarea cambió.');
  return task;
}

function active(task) {
  return task.tipo_tarea === 'edicion' && task.propiedades_extra?.workspace === 'render_os'
    && ![true, 'true'].includes(task.propiedades_extra?.papelera_render_os)
    && ['en_revision', 'aprobada', 'finalizada', 'publicada'].includes(task.estado);
}

async function creditedEditor(db, task) {
  const members = (await db.query(`SELECT a.usuario_id,a.tipo,u.activo FROM tarea_asignaciones a
    JOIN usuarios u ON u.id=a.usuario_id WHERE a.tarea_id=$1 ORDER BY a.usuario_id,a.tipo`, [task.id])).rows;
  const conflict = () => fail('Elegí un responsable por ID verificable.', 409, 'editing_progress_assignment_required');
  if (members.some(m => !positive(m.usuario_id) || !['responsable', 'colaborador'].includes(m.tipo))
    || new Set(members.map(m => m.usuario_id)).size !== members.length
    || members.filter(m => m.tipo === 'responsable').length > 1) throw conflict();
  const explicit = task.propiedades_extra?.edicion_responsable_id;
  let chosen;
  if (explicit !== undefined && explicit !== null) {
    if (!positive(explicit)) throw conflict();
    chosen = members.find(m => m.usuario_id === explicit);
  } else chosen = members.find(m => m.tipo === 'responsable');
  if (!chosen || chosen.activo !== true) throw conflict();
  return chosen.usuario_id;
}

export async function recordEditingProgressDelivery(db, value) {
  const input = revisionInput(value, true);
  await assertEditingProgressSchema(db);
  const task = await taskAtRevision(db, input);
  if (!active(task) || task.estado !== 'en_revision') throw fail('La tarea no tiene una entrega vigente en revisión.');
  const delivery = (await db.query(`SELECT id,task_id,task_revision,recorded_at FROM task_editing_deliveries
    WHERE task_id=$1 ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1`, [task.id])).rows[0];
  if (!delivery || delivery.id !== input.deliveryId || delivery.task_id !== task.id
    || delivery.task_revision !== task.revision) throw fail('La entrega no coincide con la revisión actual.');
  const previous = (await db.query(`SELECT tarea_id,editor_user_id,origen_registro,delivery_id,task_revision
    FROM public.progreso_edicion_entregas WHERE tarea_id=$1`, [task.id])).rows[0];
  if (previous) {
    if (previous.task_revision !== null && previous.task_revision > task.revision) throw fail('El progreso tiene una revisión posterior.');
    if (previous.delivery_id === delivery.id && previous.task_revision === task.revision) return { taskId: task.id, replayed: true };
    await db.query(`UPDATE public.progreso_edicion_entregas SET delivery_id=$2,task_revision=$3,
      estado_actual=$4,activa=TRUE,baja_at=NULL,updated_at=clock_timestamp() WHERE tarea_id=$1`,
    [task.id, delivery.id, task.revision, task.estado]);
  } else {
    const editor = await creditedEditor(db, task);
    await db.query(`INSERT INTO public.progreso_edicion_entregas
      (tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,activa,
       editor_user_id,origen_registro,delivery_id,task_revision)
      VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,'canonical_delivery',$8,$9)`,
    [task.id, `user:${editor}`, task.titulo, task.cliente_id, task.estado, delivery.recorded_at, editor, delivery.id, task.revision]);
  }
  return { taskId: task.id, replayed: false };
}

export async function projectEditingProgressTask(db, value) {
  const input = revisionInput(value);
  await assertEditingProgressSchema(db);
  const task = await taskAtRevision(db, input);
  // No INSERT: a state change is not evidence of a new delivery. The caller
  // must first persist/validate canonical approval/correction where applicable.
  const result = await db.query(`UPDATE public.progreso_edicion_entregas SET estado_actual=$2,
    task_revision=CASE WHEN delivery_id IS NOT NULL THEN $3 ELSE NULL END,
    activa=$4,baja_at=CASE WHEN $4 THEN NULL ELSE COALESCE(baja_at,clock_timestamp()) END,
    updated_at=clock_timestamp() WHERE tarea_id=$1 AND (task_revision IS NULL OR task_revision<=$3)
    AND (estado_actual IS DISTINCT FROM $2 OR task_revision IS DISTINCT FROM
      CASE WHEN delivery_id IS NOT NULL THEN $3 ELSE NULL END OR activa IS DISTINCT FROM $4)
    RETURNING tarea_id`, [task.id, task.estado, task.revision, active(task)]);
  return { taskId: task.id, changed: result.rows.length === 1 };
}

export async function loadEditingProgressAudit(db, query) {
  const { periodo, editorId } = normalizeEditingProgressQuery(query);
  await assertEditingProgressSchema(db);
  const rows = (await db.query(`SELECT pe.id::text,pe.tarea_id::text,pe.editor_clave,pe.titulo_snapshot,
      pe.estado_actual,pe.editor_user_id,pe.origen_registro,pe.delivery_id,pe.task_revision,
      to_char(pe.entregada_at AT TIME ZONE '${EDITING_PROGRESS_TIMEZONE}','YYYY-MM-DD') AS fecha_entrega,
      c.nombre AS cliente_nombre
    FROM public.progreso_edicion_entregas pe LEFT JOIN clientes c ON c.id=pe.cliente_id
    WHERE pe.activa IS TRUE AND (($2::int IS NULL AND pe.origen_registro IS NULL AND pe.editor_clave='luciano')
      OR ($2::int IS NOT NULL AND pe.origen_registro='canonical_delivery' AND pe.editor_user_id=$2))
      AND pe.entregada_at >= ($1::date::timestamp AT TIME ZONE '${EDITING_PROGRESS_TIMEZONE}')
      AND pe.entregada_at < (($1::date + INTERVAL '1 month') AT TIME ZONE '${EDITING_PROGRESS_TIMEZONE}')
    ORDER BY pe.entregada_at,pe.id`, [`${periodo}-01`, editorId])).rows;
  const seen = new Set();
  const entregas = rows.map(row => {
    const historical = row.origen_registro === null;
    if (!states.includes(row.estado_actual) || !['en_revision', 'aprobada', 'finalizada', 'publicada'].includes(row.estado_actual)
      || !/^[1-9]\d*$/.test(row.tarea_id) || seen.has(row.tarea_id)
      || (historical ? row.editor_user_id !== null || editorId !== null || row.editor_clave !== 'luciano'
        : row.origen_registro !== 'canonical_delivery' || !positive(row.editor_user_id) || row.editor_user_id !== editorId)
      || (row.delivery_id === null ? row.task_revision !== null : !uuid(row.delivery_id) || !positive(row.task_revision))
      || (!historical && row.delivery_id === null)
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.fecha_entrega) || row.fecha_entrega.slice(0, 7) !== periodo) throw fail('El ledger contiene evidencia incompatible.', 503);
    seen.add(row.tarea_id);
    return { id: row.id, tarea_id: row.tarea_id, editor_clave: row.editor_clave, titulo_snapshot: row.titulo_snapshot,
      estado_actual: row.estado_actual, fecha_entrega: row.fecha_entrega, cliente_nombre: row.cliente_nombre,
      editor_user_id: row.editor_user_id, origen_registro: row.origen_registro,
      atribucion: historical ? 'historica_no_verificada' : 'asignacion_id',
      estado_canonico: row.estado_actual === 'publicada' ? 'finalizada' : row.estado_actual,
      delivery_id: row.delivery_id, task_revision: row.task_revision };
  });
  const revisiones = entregas.filter(row => row.estado_canonico === 'en_revision');
  return { contrato: 'editing-progress-v1', periodo, zona_horaria: EDITING_PROGRESS_TIMEZONE,
    alcance: { tipo: editorId === null ? 'historico_clave' : 'usuario_id', editor_clave: editorId === null ? 'luciano' : null, editor_id: editorId },
    editor: editorId === null ? 'Registro histórico, clave luciano; identidad no verificada' : `Usuario #${editorId}`,
    finalizadas_registradas: entregas.filter(row => row.estado_canonico === 'finalizada').length,
    en_revision_actuales: revisiones.length, aprobadas_actuales: entregas.filter(row => row.estado_canonico === 'aprobada').length,
    total_operativo: entregas.length,
    desglose_origen: { historicas: entregas.filter(row => row.origen_registro === null).length,
      canonicas: entregas.filter(row => row.origen_registro === 'canonical_delivery').length }, entregas, revisiones };
}
