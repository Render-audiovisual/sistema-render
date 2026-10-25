// Minimum principal API shape. This is a read-only compatibility check, not a
// repair tool or a certification of every constraint/business invariant.
export const CORE_SCHEMA_COLUMNS = Object.freeze({
  usuarios: { id: 'integer', usuario: 'text', rol: 'text', activo: 'boolean', session_version: 'integer', user_admin_version:'integer' },
  auth_login_buckets: { bucket_key: 'text', attempts: 'integer', window_started_at: 'timestamp with time zone', expires_at: 'timestamp with time zone' },
  clientes: { id: 'integer', activo: 'boolean', cuota_reels: 'integer', cuota_carruseles: 'integer' },
  tareas: { id: 'integer', revision: 'integer', estado: 'text', propiedades_extra: 'jsonb', publicacion_id: 'integer' },
  tarea_asignaciones: { tarea_id: 'integer', usuario_id: 'integer', tipo: 'text' },
  publicaciones: { id: 'integer', cliente_id: 'integer', estado: 'text', fecha_programada: 'date', 'fecha_publicación_real': 'timestamp with time zone' },
  historias: { id: 'integer', cliente_id: 'integer', estado: 'text', fecha_programada: 'date', 'fecha_publicación_real': 'timestamp with time zone' },
  editorial_publicacion_versiones: { dominio: 'text', pieza_id: 'integer', historia_id: 'integer', publicacion_id: 'integer', revision: 'bigint', current_event_id: 'uuid' },
  editorial_publicacion_eventos: { id: 'uuid', dominio: 'text', pieza_id: 'integer', historia_id: 'integer', publicacion_id: 'integer', cliente_id: 'integer', actor_id: 'integer', action: 'text', source: 'text', request_id: 'uuid', intent_hash: 'text', expected_revision: 'bigint', occurred_at: 'timestamp with time zone', recorded_at: 'timestamp with time zone', previous_event_id: 'uuid' },
  editorial_create_receipts: { actor_user_id: 'integer', request_id: 'uuid', payload_hash: 'text', dominio: 'text', pieza_id: 'integer', tarea_id: 'integer', committed_at: 'timestamp with time zone' },
  editorial_archive_events: { id: 'uuid', actor_user_id: 'integer', request_id: 'uuid', payload_hash: 'text', dominio: 'text', pieza_id: 'integer', historia_id: 'integer', publicacion_id: 'integer', action: 'text', expected_revision: 'bigint', result_revision: 'bigint', motivo: 'text', recorded_at: 'timestamp with time zone' },
  moodboard_boards: { id: 'integer', category_revision: 'bigint' },
  moodboard_categories: { id: 'integer', board_id: 'integer', nombre: 'text', orden: 'integer' },
  moodboard_category_operations: { actor_user_id: 'integer', request_id: 'uuid', board_id: 'integer', payload_hash: 'text', result_revision: 'bigint' },
  moodboard_references: { id: 'integer', board_id: 'integer', category_id: 'integer', revision: 'bigint', archivo_nombre: 'text' },
  moodboard_reference_operations: { actor_user_id: 'integer', request_id: 'uuid', action: 'text', payload_hash: 'text', board_id: 'integer', reference_id: 'integer', result_revision: 'bigint', recorded_at: 'timestamp with time zone' },
  cliente_objetivos_mensuales: { id: 'integer', periodo: 'date' },
  cliente_objetivo_piezas: { id: 'integer', objetivo_id: 'integer', tarea_id: 'integer', publicacion_id: 'integer' },
  produccion_visitas: { id: 'uuid', fecha: 'date', revision: 'integer' },
  produccion_resultados: { id:'uuid', visita_id:'uuid', visita_revision:'integer', revision_resultante:'integer', registrado_por_id:'integer', request_id:'uuid', payload_hash:'text', registrado_at:'timestamp with time zone', resumen:'jsonb' },
  produccion_videos: { id: 'uuid', visita_id: 'uuid', publicacion_id: 'integer', tarea_entrega_id: 'integer' },
  produccion_fotos: { id: 'uuid', visita_id: 'uuid', estado: 'text' },
  notas_compartidas: { id: 'integer', feedback: 'jsonb', updated_at: 'timestamp with time zone' },
  feedback_operation_receipts: { actor_user_id: 'integer', operation: 'text', payload_hash: 'text', note_id: 'bigint' },
  feedback_browser_operations: { actor_user_id: 'integer', request_id: 'uuid', action: 'text', payload_hash: 'text', note_id: 'bigint', note_updated_at: 'timestamp with time zone', recorded_at: 'timestamp with time zone' },
  task_operation_receipts: { actor_user_id: 'integer', operation: 'text', payload_hash: 'text', task_id: 'bigint', task_revision: 'integer' },
  personal_list_create_receipts: { actor_user_id: 'integer', request_id: 'uuid', payload_hash: 'text', list_id: 'bigint', committed_at: 'timestamp with time zone' },
  task_comment_create_receipts: { actor_user_id: 'integer', request_id: 'uuid', payload_hash: 'text', tarea_id: 'integer', comment_id: 'integer', workspace: 'text', committed_at: 'timestamp with time zone' },
  task_editing_deliveries: { id: 'uuid', task_id: 'integer', actor_id: 'integer', request_id: 'uuid', payload_hash: 'text', task_revision: 'integer', url: 'text', notes: 'text', recorded_at: 'timestamp with time zone' },
  task_editing_reviews: { id: 'uuid', task_id: 'integer', delivery_id: 'uuid', actor_id: 'integer', action: 'text', task_revision: 'integer', notes: 'text', recorded_at: 'timestamp with time zone', request_id: 'uuid', payload_hash: 'text' },
  proyectos: { id: 'uuid', cliente_id: 'integer', responsable_id: 'integer', revision: 'integer', request_hash: 'text' },
  project_child_create_receipts: { actor_id:'integer', request_id:'uuid', proyecto_id:'uuid', recurso_tipo:'text', recurso_id:'uuid', expected_revision:'integer', payload_hash:'text', committed_at:'timestamp with time zone' },
  proyecto_miembros: { proyecto_id: 'uuid', usuario_id: 'integer' },
  proyecto_etapas: { id: 'uuid', proyecto_id: 'uuid', posicion: 'integer' },
  proyecto_hitos: { id: 'uuid', proyecto_id: 'uuid', etapa_id: 'uuid' },
  proyecto_entregables: { id: 'uuid', proyecto_id: 'uuid', aprobado_por_id: 'integer' },
  proyecto_tareas: { proyecto_id: 'uuid', tarea_id: 'integer' },
  proyecto_actividad: { proyecto_id: 'uuid', actor_id: 'integer' },
});

export async function assertCoreSchemaReady(db) {
  let rows;
  try {
    // pg returns name[] as a raw string; text[] has its supported array parser.
    const path = await db.query('SELECT current_schemas(false)::text[] AS schemas');
    const schemas = path.rows?.[0]?.schemas;
    if (!Array.isArray(schemas) || JSON.stringify(schemas.filter(schema => schema !== 'pg_catalog')) !== '["public"]') {
      throw new Error('Ambiguous principal schema path.');
    }
    ({ rows } = await db.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=ANY($1::text[])`, [Object.keys(CORE_SCHEMA_COLUMNS)]));
  } catch { throw new Error('Cannot inspect principal schema compatibility.'); }
  if (!Array.isArray(rows)) throw new Error('Invalid principal schema inspection.');
  const actual = new Map(rows.map(row => [`${row.table_name}.${row.column_name}`, row.data_type]));
  for (const [table, columns] of Object.entries(CORE_SCHEMA_COLUMNS)) {
    for (const [column, type] of Object.entries(columns)) {
      if (actual.get(`${table}.${column}`) !== type) throw new Error('Principal schema is not compatible. No repair was attempted.');
    }
  }
  // Browser and signed note writers share migration061's monotonic clock.
  // Inspect its enabled binding only; startup never installs or repairs it.
  let clock, referenceClock, personalListReceipt, projectChildReceipt, taskCommentReceipt;
  try {
    const result = await db.query(`SELECT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.notas_compartidas'::regclass AND t.tgname=$1
        AND p.proname=$1 AND n.nspname='public' AND NOT t.tgisinternal
        AND t.tgenabled IN ('O','A') AND t.tgtype=19 AND t.tgnargs=0
    ) AS ready, EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.moodboard_references'::regclass AND t.tgname=$2
        AND p.proname=$2 AND n.nspname='public' AND NOT t.tgisinternal
        AND t.tgenabled IN ('O','A') AND t.tgtype=19 AND t.tgnargs=0
    ) AS reference_ready, EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.personal_list_create_receipts'::regclass AND t.tgname=$3
        AND p.proname=$3 AND n.nspname='public' AND NOT t.tgisinternal
        AND t.tgenabled IN ('O','A') AND t.tgtype=27 AND t.tgnargs=0
    ) AS personal_list_receipt_ready, EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.project_child_create_receipts'::regclass AND t.tgname=$4
        AND p.proname=$4 AND n.nspname='public' AND NOT t.tgisinternal
        AND t.tgenabled IN ('O','A') AND t.tgtype=27 AND t.tgnargs=0
    ) AS project_child_receipt_ready, EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.task_comment_create_receipts'::regclass AND t.tgname=$5
        AND p.proname=$5 AND n.nspname='public' AND NOT t.tgisinternal
        AND t.tgenabled IN ('O','A') AND t.tgtype=27 AND t.tgnargs=0
    ) AS task_comment_receipt_ready`, ['feedback_notes_monotonic_version','moodboard_reference_advance_revision','personal_list_create_receipt_immutable','project_child_create_receipt_immutable','task_comment_create_receipt_immutable']);
    clock = result.rows?.[0]?.ready;
    referenceClock = result.rows?.[0]?.reference_ready;
    personalListReceipt = result.rows?.[0]?.personal_list_receipt_ready;
    projectChildReceipt = result.rows?.[0]?.project_child_receipt_ready;
    taskCommentReceipt = result.rows?.[0]?.task_comment_receipt_ready;
  } catch { throw new Error('Cannot inspect principal note clock.'); }
  if (clock !== true) throw new Error('Principal note clock is not compatible. No repair was attempted.');
  if (referenceClock !== true) throw new Error('Principal moodboard clock is not compatible. No repair was attempted.');
  // Verify only the enabled row/before binding from087. This does not certify
  // the function body, keys, constraints, indexes or migration preservation.
  if (personalListReceipt !== true) throw new Error('Principal personal-list receipt guard is not compatible. No repair was attempted.');
  if (projectChildReceipt !== true) throw new Error('Principal project-child receipt guard is not compatible. No repair was attempted.');
  if (taskCommentReceipt !== true) throw new Error('Principal task-comment receipt guard is not compatible. No repair was attempted.');
}
