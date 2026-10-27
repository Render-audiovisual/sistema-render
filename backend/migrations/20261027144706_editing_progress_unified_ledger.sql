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
