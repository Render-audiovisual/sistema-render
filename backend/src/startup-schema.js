// Minimum principal API shape. This is a read-only compatibility check, not a
// repair tool or a certification of every constraint/business invariant.
export const CORE_SCHEMA_COLUMNS = Object.freeze({
  usuarios: { id: 'integer', usuario: 'text', rol: 'text', activo: 'boolean', session_version: 'integer' },
  clientes: { id: 'integer', activo: 'boolean', cuota_reels: 'integer', cuota_carruseles: 'integer' },
  tareas: { id: 'integer', revision: 'integer', estado: 'text', propiedades_extra: 'jsonb', publicacion_id: 'integer' },
  tarea_asignaciones: { tarea_id: 'integer', usuario_id: 'integer', tipo: 'text' },
  publicaciones: { id: 'integer', cliente_id: 'integer', estado: 'text', fecha_programada: 'date', 'fecha_publicación_real': 'timestamp with time zone' },
  cliente_objetivos_mensuales: { id: 'integer', periodo: 'date' },
  cliente_objetivo_piezas: { id: 'integer', objetivo_id: 'integer', tarea_id: 'integer', publicacion_id: 'integer' },
  produccion_visitas: { id: 'uuid', fecha: 'date', revision: 'integer' },
  produccion_videos: { id: 'uuid', visita_id: 'uuid', publicacion_id: 'integer', tarea_entrega_id: 'integer' },
  produccion_fotos: { id: 'uuid', visita_id: 'uuid', estado: 'text' },
  notas_compartidas: { id: 'integer', feedback: 'jsonb', updated_at: 'timestamp with time zone' },
  feedback_operation_receipts: { actor_user_id: 'integer', operation: 'text', payload_hash: 'text', note_id: 'bigint' },
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
}
