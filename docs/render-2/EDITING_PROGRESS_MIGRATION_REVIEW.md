# Prospective editing-progress migration — review candidate

Estado posterior: esta propuesta fue incorporada y ensayada en desarrollo. Ver EDITING_AUDIT_INTEGRATION_AND_RELEASE_CANDIDATE.md para la aceptación vigente; las afirmaciones de «no ejecutado» de esta revisión describen únicamente su etapa inicial. No se aplicó en producción.

2026-10-27. SQL proposal only; not executed or physically verified. Main owns incorporation into the officially CLI-generated filename `backend/migrations/20261027144706_editing_progress_unified_ledger.sql` (lexically after 093). No invented 094 filename. No production authorization is inferred from this document. Roles/email owner gates are explicitly deferred, not satisfied or fabricated.

## Scope and evidence

Matches the currently exported `EDITING_PROGRESS_SCHEMA` in `backend/src/editing-progress-ledger.js`, including its historical nullable-delivery branch. Main must rerun the actual exported assertion against PostgreSQL after incorporating this proposal; exact deparser strings are part of that assertion and are not certified by source inspection.

Historical source: recognition commit `43f02707e299293c5b0c2bb6f12386bd4642746b`, 051/052. Prior review also inspected schema-only output from the older private authorized backup, never table data. This is not verification of the latest capture. Never execute 051/052: they include historical backfill, payroll DELETE, and date correction.

Installation has two accepted inputs: no ledger/no legacy trigger (fresh), or the exact known old ledger plus known old trigger/function (upgrade). Anything partially upgraded or structurally different fails closed. Existing ledger/sequence/function ACLs and RLS/policies remain untouched. New objects are closed by the existing runner's inventory protector before COMMIT. No FORCE RLS, new policies, default privileges, roles, or grants.

## Candidate migration content

Run only inside the caller's transaction. No BEGIN/COMMIT in this content. Stop application writers before migration: locks are intentionally bounded by runner lock/statement timeouts. The known obsolete function is left unbound, preserving its OID/ACL; only its validated trigger is removed. A differently defined function/trigger must abort, never be silently replaced.

```sql
-- Prospective only: no historical task scan/backfill or data repair.
LOCK TABLE public.tareas IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
DECLARE
  old_ledger boolean := to_regclass('public.progreso_edicion_entregas') IS NOT NULL;
  relation_oid oid;
  actual jsonb;
  expected jsonb;
  legacy record;
BEGIN
  IF NOT old_ledger THEN
    IF to_regprocedure('public.registrar_progreso_edicion_tarea()') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_trigger
         WHERE tgrelid='public.tareas'::regclass AND tgname='progreso_edicion_tarea_cambio') THEN
      RAISE EXCEPTION 'Unexpected partial legacy editing-progress installation';
    END IF;
    CREATE TABLE public.progreso_edicion_entregas (
      id BIGSERIAL PRIMARY KEY,
      tarea_id BIGINT NOT NULL UNIQUE,
      editor_clave TEXT NOT NULL,
      titulo_snapshot TEXT NOT NULL,
      cliente_id INTEGER,
      estado_actual TEXT NOT NULL
        CHECK (estado_actual IN ('en_revision','publicada')),
      entregada_at TIMESTAMPTZ NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT TRUE,
      baja_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_progreso_edicion_editor_fecha
      ON public.progreso_edicion_entregas(editor_clave,entregada_at DESC)
      WHERE activa IS TRUE;
  END IF;

  LOCK TABLE public.progreso_edicion_entregas IN ACCESS EXCLUSIVE MODE;
  relation_oid := 'public.progreso_edicion_entregas'::regclass;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid
    AND relkind='r' AND NOT relispartition)
    OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid)
    OR EXISTS (SELECT 1 FROM pg_depend WHERE classid='pg_class'::regclass
      AND objid=relation_oid AND deptype='e') THEN
    RAISE EXCEPTION 'Unexpected ledger relation kind/ownership';
  END IF;

  SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
    a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated)
    ORDER BY a.attnum) INTO actual
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped;
  expected := jsonb_build_array(
    jsonb_build_array('id','bigint',true,
      'nextval(''progreso_edicion_entregas_id_seq''::regclass)','',''),
    jsonb_build_array('tarea_id','bigint',true,'','',''),
    jsonb_build_array('editor_clave','text',true,'','',''),
    jsonb_build_array('titulo_snapshot','text',true,'','',''),
    jsonb_build_array('cliente_id','integer',false,'','',''),
    jsonb_build_array('estado_actual','text',true,'','',''),
    jsonb_build_array('entregada_at','timestamp with time zone',true,'','',''),
    jsonb_build_array('activa','boolean',true,'true','',''),
    jsonb_build_array('baja_at','timestamp with time zone',false,'','',''),
    jsonb_build_array('created_at','timestamp with time zone',true,'now()','',''),
    jsonb_build_array('updated_at','timestamp with time zone',true,'now()','',''));
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Unexpected old ledger columns/defaults';
  END IF;
  -- pg18 represents NOT NULL as constraints; column validation above covers them.
  SELECT jsonb_object_agg(conname,pg_get_constraintdef(oid)) INTO actual
    FROM pg_constraint WHERE conrelid=relation_oid AND contype<>'n';
  expected := jsonb_build_object(
    'progreso_edicion_entregas_pkey','PRIMARY KEY (id)',
    'progreso_edicion_entregas_tarea_id_key','UNIQUE (tarea_id)',
    'progreso_edicion_entregas_estado_actual_check',
      'CHECK ((estado_actual = ANY (ARRAY[''en_revision''::text, ''publicada''::text])))');
  IF actual IS DISTINCT FROM expected OR EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid=relation_oid AND (NOT convalidated OR condeferrable)) THEN
    RAISE EXCEPTION 'Unexpected old ledger constraints';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=relation_oid AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=relation_oid) THEN
    RAISE EXCEPTION 'Unexpected ledger triggers/rules';
  END IF;
  IF pg_get_serial_sequence('public.progreso_edicion_entregas','id') IS DISTINCT FROM
      'public.progreso_edicion_entregas_id_seq' THEN
    RAISE EXCEPTION 'Unexpected ledger sequence dependency';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=relation_oid AND c.relname='idx_progreso_edicion_editor_fecha'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(i.indexrelid)=
        'CREATE INDEX idx_progreso_edicion_editor_fecha ON public.progreso_edicion_entregas USING btree (editor_clave, entregada_at DESC) WHERE (activa IS TRUE)')
    OR (SELECT count(*) FROM pg_index WHERE indrelid=relation_oid)<>3 THEN
    RAISE EXCEPTION 'Unexpected old ledger indexes';
  END IF;

  IF old_ledger THEN
    SELECT t.*,p.prosrc,p.prosecdef,p.proconfig,p.prokind,p.prorettype,
      l.lanname,p.pronargs INTO legacy
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_language l ON l.oid=p.prolang
      WHERE t.tgrelid='public.tareas'::regclass
        AND t.tgname='progreso_edicion_tarea_cambio';
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing known legacy trigger'; END IF;
    IF legacy.tgfoid IS DISTINCT FROM to_regprocedure('public.registrar_progreso_edicion_tarea()')::oid
      OR legacy.tgisinternal OR legacy.tgtype<>21 OR legacy.tgenabled<>'O'
      OR legacy.tgconstraint<>0 OR legacy.tgqual IS NOT NULL
      OR legacy.tgnargs<>0 OR octet_length(legacy.tgargs)<>0
      OR legacy.tgoldtable IS NOT NULL OR legacy.tgnewtable IS NOT NULL
      OR legacy.prosecdef OR legacy.proconfig IS NOT NULL
      OR legacy.prokind<>'f' OR legacy.prorettype<>'trigger'::regtype
      OR legacy.pronargs<>0 OR legacy.lanname<>'plpgsql'
      OR md5(legacy.prosrc)<>'694a50d5911f0688cd82bf43ad8fd922'
      OR (SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid='public.tareas'::regclass
          AND a.attnum=ANY(legacy.tgattr::smallint[])) IS DISTINCT FROM
        ARRAY['asignado_a','estado','propiedades_extra','tipo_tarea']::text[]
      OR (SELECT count(*) FROM pg_trigger WHERE tgfoid=legacy.tgfoid)<>1 THEN
      RAISE EXCEPTION 'Legacy trigger/function differs from recognized source';
    END IF;
    DROP TRIGGER progreso_edicion_tarea_cambio ON public.tareas;
  END IF;

  -- Rename existing UNIQUE: retain its index/OID instead of duplicating it.
  ALTER TABLE public.progreso_edicion_entregas
    RENAME CONSTRAINT progreso_edicion_entregas_tarea_id_key TO editing_progress_v1_task_unique;
  ALTER TABLE public.progreso_edicion_entregas
    DROP CONSTRAINT progreso_edicion_entregas_estado_actual_check,
    ADD COLUMN editor_user_id INTEGER,
    ADD COLUMN origen_registro TEXT,
    ADD COLUMN delivery_id UUID,
    ADD COLUMN task_revision INTEGER;
END;
$migration$;

-- Required referenced pair: UUID PK alone is not the FK target contract.
ALTER TABLE public.task_editing_deliveries
  ADD CONSTRAINT editing_progress_v1_delivery_pair_unique UNIQUE (task_id,id);

ALTER TABLE public.progreso_edicion_entregas
  ADD CONSTRAINT editing_progress_v1_source
    CHECK (origen_registro IS NULL OR origen_registro='canonical_delivery'),
  ADD CONSTRAINT editing_progress_v1_identity CHECK (
    CASE WHEN origen_registro IS NULL THEN
      editor_user_id IS NULL AND (
        (delivery_id IS NULL AND task_revision IS NULL) OR
        (delivery_id IS NOT NULL AND task_revision IS NOT NULL AND task_revision>0))
    ELSE editor_user_id IS NOT NULL AND editor_user_id>0
      AND delivery_id IS NOT NULL AND task_revision IS NOT NULL AND task_revision>0 END),
  ADD CONSTRAINT editing_progress_v1_state CHECK (estado_actual IN
    ('pendiente','en_progreso','en_revision','aprobada','finalizada','publicada')),
  ADD CONSTRAINT editing_progress_v1_editor_fk FOREIGN KEY (editor_user_id)
    REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  ADD CONSTRAINT editing_progress_v1_delivery_fk FOREIGN KEY (tarea_id,delivery_id)
    REFERENCES public.task_editing_deliveries(task_id,id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE FUNCTION public.project_existing_editing_progress_task()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
DECLARE is_active boolean;
BEGIN
  is_active := coalesce(NEW.tipo_tarea='edicion'
    AND NEW.propiedades_extra->>'workspace'='render_os'
    AND coalesce(NEW.propiedades_extra->>'papelera_render_os','false')<>'true'
    AND NEW.estado IN ('en_revision','aprobada','finalizada','publicada'),false);
  UPDATE public.progreso_edicion_entregas SET
    estado_actual=NEW.estado,
    task_revision=CASE WHEN delivery_id IS NOT NULL THEN NEW.revision ELSE NULL END,
    activa=is_active,
    baja_at=CASE WHEN is_active THEN NULL ELSE coalesce(baja_at,clock_timestamp()) END,
    updated_at=clock_timestamp()
  WHERE tarea_id=NEW.id AND (task_revision IS NULL OR task_revision<=NEW.revision)
    AND (estado_actual IS DISTINCT FROM NEW.estado
      OR task_revision IS DISTINCT FROM
        CASE WHEN delivery_id IS NOT NULL THEN NEW.revision ELSE NULL END
      OR activa IS DISTINCT FROM is_active);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER editing_progress_v1_task_projection
AFTER UPDATE ON public.tareas FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado
  OR OLD.tipo_tarea IS DISTINCT FROM NEW.tipo_tarea
  OR OLD.propiedades_extra IS DISTINCT FROM NEW.propiedades_extra
  OR OLD.revision IS DISTINCT FROM NEW.revision)
EXECUTE FUNCTION public.project_existing_editing_progress_task();
```

## Required coordination before copying SQL

- The legacy body MD5 is a strict equality guard, not a security signature. It was calculated from the exact function dollar-body in recognized 051. Verify the same value from a schema-only fresh backup; whitespace differences intentionally abort and require review, not relaxed matching.
- Set `search_path=public` as the current runner does before the old-default/index deparser checks. Do not reinterpret a mismatch as permission to overwrite an unknown object. Old relation ACL, per-column ACL, owner, RLS/FORCE flags, policies, sequence definition/state/ACL and all nonreplaced old definitions must be snapshotted and compared by physical QA. No promise of exact old schema beyond the explicit assertions: sequence options, column collation, dropped attributes, unusual relation options and dependency graph need the coordinated preflight verifier; extend guards before accepting a source with differences.
- `task_editing_deliveries` must first pass the existing 065 schema contract (columns/types, PK, restrictive FKs, immutable trigger and no unknown rules/triggers). Validate referenced `usuarios`/`tareas` identities too. This draft does not duplicate that whole prerequisite verifier. The pair UNIQUE changes only schema/indexes, not delivery rows. Unexpected name collisions fail transactionally.
- All six exported constraints must be validated/nondeferrable, and deparse exactly as `EDITING_PROGRESS_SCHEMA` expects. Physical assertion must use the actual application connection/search_path. FK deparse qualification and CHECK parentheses are acceptance gates, not assumed portable spelling. Main owns any coordinated constant changes; never loosen validation just to pass.
- Preserve historical rows by old-column projection, not full-row JSON (four NULL fields are added). No source names map to user IDs. An existing historical row may later acquire a delivery/revision while remaining historical with NULL editor ID/origin. The helper already specifies that branch.
- The projection trigger executes only on future UPDATE, never INSERT/DELETE and never creates ledger rows. It cannot prove authorization, approval, or delivery correctness: those remain canonical writer/transaction responsibilities. Row revision represents projection revision, not necessarily the immutable delivery revision. FK pair proves task/delivery identity, not equal revisions.
- AFTER UPDATE observes the final NEW revision after all BEFORE triggers. Main must verify ordered writer locks and duplicate projector no-op behavior. A task mutation followed by delivery insertion occurs in one transaction; trigger cannot insert progress and helper remains sole creator. No trigger touches task/editorial/payroll rows.
- The old function remains unbound with unchanged ACL, so no changed routine is missed by new-OID hardening. New projection function is created, not replaced; runner closes its EXECUTE grants before commit. Keeping an unbound old function is intentional; a trigger-returning routine cannot be invoked as an ordinary SQL function. No `CASCADE` cleanup.
- Existing ledger ACLs remain even if permissive. New columns inherit existing table-level grants: this proposal does not remediate that inherited exposure. Assess with main before release; do not claim API-role denial for an old table based on the new-object protector.
- Runner still rejects production, freezes file bytes, uses advisory serialization and one transaction per file. No override proposed. Failed migration rolls back this file, not earlier committed migrations. No concurrent index syntax inside this transaction. Reverting to old runtime after this migration is incompatible with the removed legacy trigger; recovery requires an approved forward fix or whole compatible restore, not replaying 051/052.

## Physical acceptance matrix — not yet run for this document

1. Fresh synthetic chain through 093 → migration → actual exported assertion; empty ledger remains empty, new table/sequence/routine closed before commit, absent anon/authenticated roles supported.
2. Synthetic old 051-shaped ledger/trigger/function and varied historical rows (including absent task IDs), no historical cleanup DML → migration: every old-column value/row ID/sequence value and every unrelated table unchanged; old table/column/sequence/function ACLs, owners and policies unchanged. Task UNIQUE index retained with renamed constraint.
3. Negative schema cases: extra/missing/wrong column, default/type/nullability/check/index/FK, disabled/modified trigger, unknown function body, SECURITY DEFINER, unexpected binding/rule/extension ownership, partial install. Entire migration rejects before any durable effect; no silent repairs.
4. Schema pair FK: delivery UUID belonging to another task rejects; historical NULL delivery permits missing old task. Invalid editor, source, zero revision, partial NULL pair and duplicate task reject. Historical NULL attribution plus valid pair succeeds without reclassification. All checks validated, not `NOT VALID` leftovers.
5. AFTER UPDATE transitions: revision increments, review→approved→finalized, alias published, corrections, trash/untrash, workspace/type changes. Existing rows only; missing row remains missing. No title/client/editor/date rewrites, no attribution by names, no payroll/publication changes, no-op update leaves updated_at unchanged.
6. Transactional writer: delivery/ledger/task/audit commit together; injected failure rolls all back; same request replay no second credit; competing deliveries/state changes serialize without lost revisions or newer-row regression. Assert final revision and delivery-task FK under real locks.
7. Exact deparser/validator tests on deployment-compatible PG17 and fixture PG18, plus wrong-but-named constraints rejected. Test privileges with backend runtime owner and role behavior separately, without inferring owner bypass for API roles.
8. Audit reads: historical-vs-ID scope separation, month bounds America/Argentina/Buenos_Aires, approved/finalized/published semantics, task purge preservation. Helpers/router fail 503 on missing or mismatched schema, never return an empty success.

## Verification status and references

Only source/catalog-contract review and documentation checks performed for this proposal. No SQL parse, migration, fixture or application test executed; earlier universe/core counts are unrelated and must not be used as evidence here. Main must resolve prerequisite exact-schema verification and run this matrix before treating the SQL as accepted.

PostgreSQL guidance: [constraints, nullable checks and composite foreign keys](https://www.postgresql.org/docs/current/ddl-constraints.html). Supabase/Postgres skills shaped fail-closed checks, transaction-bounded locks, and separation of RLS from grants. Changelog Markdown fetch was unavailable; no new Supabase product feature or CLI behavior is assumed in this SQL-only proposal.
