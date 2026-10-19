-- Forward-only identity constraints. No historical linking or data rewrites.
ALTER TABLE publicaciones ADD CONSTRAINT produccion_editorial_publicacion_cliente_unique
  UNIQUE (id, cliente_id);
ALTER TABLE tareas ADD CONSTRAINT produccion_editorial_tarea_publicacion_cliente_unique
  UNIQUE (id, publicacion_id, cliente_id);
ALTER TABLE produccion_visitas ADD CONSTRAINT produccion_editorial_visita_cliente_unique
  UNIQUE (id, cliente_id);

ALTER TABLE produccion_videos
  ADD COLUMN publicacion_id INTEGER,
  ADD COLUMN tarea_entrega_id INTEGER,
  ADD COLUMN cliente_editorial_id INTEGER,
  ADD CONSTRAINT produccion_editorial_tuple_complete CHECK (
    (publicacion_id IS NULL AND tarea_entrega_id IS NULL AND cliente_editorial_id IS NULL)
    OR (publicacion_id IS NOT NULL AND publicacion_id > 0
      AND tarea_entrega_id IS NOT NULL AND tarea_entrega_id > 0
      AND cliente_editorial_id IS NOT NULL AND cliente_editorial_id > 0)
  ),
  ADD CONSTRAINT produccion_editorial_publicacion_unique UNIQUE (publicacion_id),
  ADD CONSTRAINT produccion_editorial_tarea_entrega_unique UNIQUE (tarea_entrega_id),
  ADD CONSTRAINT produccion_editorial_edicion_matches_entrega CHECK (
    publicacion_id IS NULL OR tarea_edicion_id IS NULL OR tarea_edicion_id = tarea_entrega_id
  ),
  ADD CONSTRAINT produccion_editorial_publicacion_cliente_fk
    FOREIGN KEY (publicacion_id, cliente_editorial_id)
    REFERENCES publicaciones (id, cliente_id) MATCH FULL ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT produccion_editorial_tarea_publicacion_cliente_fk
    FOREIGN KEY (tarea_entrega_id, publicacion_id, cliente_editorial_id)
    REFERENCES tareas (id, publicacion_id, cliente_id) MATCH FULL ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- visita_id is always present, including on videos without editorial links.
  -- MATCH SIMPLE lets the nullable editorial client defer this FK until linked.
  ADD CONSTRAINT produccion_editorial_visita_cliente_fk
    FOREIGN KEY (visita_id, cliente_editorial_id)
    REFERENCES produccion_visitas (id, cliente_id) MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT;

-- One task cannot be an unlinked handoff for one video and the canonical
-- editorial delivery for another. The match CHECK above makes this one key
-- cover every existing/new use without a reverse-locking validation trigger.
CREATE UNIQUE INDEX produccion_editorial_canonical_task_unique
  ON produccion_videos ((COALESCE(tarea_entrega_id, tarea_edicion_id)))
  WHERE COALESCE(tarea_entrega_id, tarea_edicion_id) IS NOT NULL;

-- Existing 059 visita_id index and the new publication/task unique indexes cover
-- the leading columns of all referencing tuples.

CREATE FUNCTION produccion_editorial_guard_goal_tuple() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Task AFTER triggers update goal title/copy/state routinely. Do not acquire
  -- reverse locks (or even inspect videos) on those unrelated updates.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tarea_id IS NOT DISTINCT FROM OLD.tarea_id
      AND NEW.publicacion_id IS NOT DISTINCT FROM OLD.publicacion_id
      AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
      AND NEW.objetivo_id IS NOT DISTINCT FROM OLD.objetivo_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF EXISTS (SELECT 1 FROM produccion_videos v
      WHERE v.publicacion_id IS NOT NULL AND
        (v.publicacion_id = OLD.publicacion_id OR v.tarea_entrega_id = OLD.tarea_id)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'produccion_editorial_goal_existing_tuple',
        MESSAGE = 'El objetivo conserva el vínculo canónico de Producciones.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF EXISTS (SELECT 1 FROM produccion_videos v
    WHERE v.publicacion_id IS NOT NULL
      AND (v.publicacion_id = NEW.publicacion_id OR v.tarea_entrega_id = NEW.tarea_id)
      AND (NEW.tarea_id IS DISTINCT FROM v.tarea_entrega_id
        OR NEW.publicacion_id IS DISTINCT FROM v.publicacion_id
        OR NEW.tipo IS DISTINCT FROM 'video'
        OR NOT EXISTS (SELECT 1 FROM cliente_objetivos_mensuales o
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.cuentas) = 'array'
            THEN o.cuentas ELSE '[]'::jsonb END) account
          WHERE o.id = NEW.objetivo_id AND account->>'id' = v.cliente_editorial_id::text))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'produccion_editorial_goal_new_tuple',
      MESSAGE = 'El objetivo debe usar la misma tarea y publicación de Producciones.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER produccion_editorial_goal_tuple_guard
  BEFORE INSERT OR UPDATE OR DELETE ON cliente_objetivo_piezas
  FOR EACH ROW EXECUTE FUNCTION produccion_editorial_guard_goal_tuple();

CREATE FUNCTION produccion_editorial_guard_publication_format() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo IS DISTINCT FROM OLD.tipo
    AND (NEW.tipo IS NULL OR NEW.tipo NOT IN ('reel', 'video'))
    AND EXISTS (SELECT 1 FROM produccion_videos v WHERE v.publicacion_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'produccion_editorial_publicacion_format',
      MESSAGE = 'La publicación vinculada a un video debe conservar formato reel o video.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER produccion_editorial_publication_format_guard
  BEFORE UPDATE OF tipo ON publicaciones
  FOR EACH ROW EXECUTE FUNCTION produccion_editorial_guard_publication_format();

-- Initial association also validates intrinsic format/task-domain invariants.
-- Ordinary video edits and unchanged link tuples never take reverse row locks.
CREATE FUNCTION produccion_editorial_guard_video_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical_task RECORD; publication_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.publicacion_id IS NOT DISTINCT FROM OLD.publicacion_id
      AND NEW.tarea_entrega_id IS NOT DISTINCT FROM OLD.tarea_entrega_id
      AND NEW.cliente_editorial_id IS NOT DISTINCT FROM OLD.cliente_editorial_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.publicacion_id IS NULL THEN RETURN NEW; END IF;

  -- Existing association APIs already hold these locks in task -> publication
  -- order. SHARE also serializes direct SQL with non-key workspace/type edits.
  SELECT propiedades_extra, historia_id INTO canonical_task FROM tareas
    WHERE id = NEW.tarea_entrega_id FOR SHARE;
  IF FOUND AND (canonical_task.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'
    OR canonical_task.historia_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'produccion_editorial_tarea_domain',
      MESSAGE = 'La entrega canónica debe ser una tarea de RENDER OS sin historia.';
  END IF;
  SELECT tipo INTO publication_type FROM publicaciones WHERE id = NEW.publicacion_id FOR SHARE;
  IF FOUND AND (publication_type IS NULL OR publication_type NOT IN ('reel', 'video')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'produccion_editorial_initial_publicacion_format',
      MESSAGE = 'El video debe vincularse a una publicación reel o video.';
  END IF;
  -- Missing task/publication identities are rejected by the named tuple FKs.
  RETURN NEW;
END $$;

CREATE TRIGGER produccion_editorial_video_binding_guard
  BEFORE INSERT OR UPDATE OF publicacion_id, tarea_entrega_id, cliente_editorial_id ON produccion_videos
  FOR EACH ROW EXECUTE FUNCTION produccion_editorial_guard_video_binding();

CREATE FUNCTION produccion_editorial_guard_task_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.propiedades_extra->>'workspace' IS NOT DISTINCT FROM OLD.propiedades_extra->>'workspace'
    AND NEW.historia_id IS NOT DISTINCT FROM OLD.historia_id THEN RETURN NEW; END IF;
  IF (NEW.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os' OR NEW.historia_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM produccion_videos v WHERE v.tarea_entrega_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'produccion_editorial_bound_tarea_domain',
      MESSAGE = 'La entrega vinculada debe conservar su workspace y no puede asociarse a una historia.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER produccion_editorial_task_domain_guard
  BEFORE UPDATE OF propiedades_extra, historia_id ON tareas
  FOR EACH ROW EXECUTE FUNCTION produccion_editorial_guard_task_domain();

-- Same business semantics as 058, with task -> publication -> goal lock order.
-- Definitions only: installation never executes the trigger body on history.
CREATE OR REPLACE FUNCTION sincronizar_cliente_objetivo_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pieza cliente_objetivo_piezas%ROWTYPE;
BEGIN
  FOR pieza IN SELECT * FROM cliente_objetivo_piezas WHERE tarea_id = NEW.id LOOP
    IF pieza.publicacion_id IS NOT NULL
      AND NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo' THEN
      UPDATE publicaciones SET copy=COALESCE(NEW.propiedades_extra->>'copy_trabajo',''), updated_at=now()
        WHERE id=pieza.publicacion_id;
    END IF;
    UPDATE cliente_objetivo_piezas SET
      titulo = NEW.titulo,
      copy = CASE WHEN NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo'
        THEN COALESCE(NEW.propiedades_extra->>'copy_trabajo', '') ELSE copy END,
      responsables = (SELECT COALESCE(jsonb_agg(DISTINCT persona), '[]'::jsonb)
        FROM jsonb_array_elements_text(jsonb_build_array(NEW.asignado_a) ||
          CASE WHEN jsonb_typeof(NEW.propiedades_extra->'colaboradores') = 'array'
            THEN NEW.propiedades_extra->'colaboradores' ELSE '[]'::jsonb END) AS people(persona)
        WHERE trim(persona) <> ''),
      estado = NEW.estado,
      completada_at = CASE WHEN NEW.estado IN ('finalizada','publicada')
        THEN COALESCE(pieza.completada_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = pieza.id;
    IF pieza.estado IS DISTINCT FROM NEW.estado THEN
      INSERT INTO cliente_objetivo_eventos(pieza_id, estado_anterior, estado_nuevo, tarea_id)
        VALUES(pieza.id, pieza.estado, NEW.estado, NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
