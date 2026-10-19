-- Forward-only receipts for confirmed Wilson task operations. No historical
-- JSON promotion, snapshots, ACL copies, backfill or automatic retention purge.
-- Application inserts once alongside mutation/confirmation/audit/outbox and
-- never edits/deletes a receipt. Retention remains a separate rollout decision.
CREATE TABLE task_operation_receipts (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  -- Deliberately no task FK: a purge cannot remove or invalidate its receipt.
  task_id BIGINT NOT NULL,
  -- Delete keeps the locked pre-delete revision; all other outcomes use the
  -- returned/current DB revision, including unchanged edits without an UPDATE.
  task_revision INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_receipts_actor_positive CHECK (actor_user_id > 0),
  CONSTRAINT task_receipts_operation CHECK (
    operation IN ('crear', 'editar', 'archivar', 'eliminar')
  ),
  CONSTRAINT task_receipts_key CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key = btrim(idempotency_key)
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT task_receipts_payload_hash CHECK (
    char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT task_receipts_task_positive CHECK (task_id > 0),
  CONSTRAINT task_receipts_revision_positive CHECK (task_revision > 0),
  CONSTRAINT task_receipts_outcome CHECK (
    outcome IN ('created', 'updated', 'unchanged', 'archived', 'deleted')
  ),
  CONSTRAINT task_receipts_operation_outcome CHECK (
    (operation = 'crear' AND outcome = 'created')
    OR (operation = 'editar' AND outcome IN ('updated', 'unchanged'))
    OR (operation = 'archivar' AND outcome = 'archived')
    OR (operation = 'eliminar' AND outcome = 'deleted')
  ),
  CONSTRAINT task_receipts_changed_fields_shape CHECK (
    CASE WHEN cardinality(changed_fields) = 0 THEN TRUE
      WHEN array_ndims(changed_fields) = 1 THEN array_position(changed_fields, NULL) IS NULL
      ELSE FALSE END
  ),
  CONSTRAINT task_receipts_changed_fields CHECK (
    changed_fields <@ ARRAY[
      'titulo', 'asignado_a', 'colaboradores', 'cliente_id',
      'fecha_vencimiento', 'tipo_tarea', 'subtipo', 'prioridad',
      'aclaraciones', 'material_referencia', 'referencia',
      'produccion_videos_previstos', 'asignado_a_id', 'colaborador_ids'
    ]::TEXT[]
  ),
  CONSTRAINT task_receipts_unchanged_fields CHECK (
    outcome <> 'unchanged' OR cardinality(changed_fields) = 0
  ),
  CONSTRAINT task_receipts_actor_operation_key_unique
    UNIQUE (actor_user_id, operation, idempotency_key)
);
