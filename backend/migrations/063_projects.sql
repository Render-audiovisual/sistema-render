-- Additive principal projects; existing tasks remain the sole workflow.
-- Only the existing task-type CHECK is widened; no historical rows are changed.
ALTER TABLE tareas DROP CONSTRAINT tareas_tipo_tarea_check;
ALTER TABLE tareas ADD CONSTRAINT tareas_tipo_tarea_check
  CHECK (tipo_tarea IN ('diseno','edicion','produccion','community','administracion','desarrollo'));

CREATE TABLE proyectos (
  id UUID CONSTRAINT proyectos_pk PRIMARY KEY,
  titulo TEXT NOT NULL CONSTRAINT proyectos_titulo CHECK (length(btrim(titulo)) BETWEEN 1 AND 250),
  cliente_id INTEGER NOT NULL CONSTRAINT proyectos_cliente_fk REFERENCES clientes(id) ON DELETE RESTRICT,
  responsable_id INTEGER NOT NULL CONSTRAINT proyectos_responsable_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CONSTRAINT proyectos_tipo CHECK (tipo IN ('web','chatbot','mantenimiento','automatizacion','otro')),
  descripcion TEXT NOT NULL DEFAULT '' CONSTRAINT proyectos_descripcion CHECK (length(descripcion) <= 20000),
  estado TEXT NOT NULL DEFAULT 'planificado' CONSTRAINT proyectos_estado
    CHECK (estado IN ('planificado','en_curso','en_revision','pausado','finalizado','cancelado')),
  fecha_inicio DATE,
  fecha_entrega DATE,
  archivado BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 1 CONSTRAINT proyectos_revision CHECK (revision > 0),
  creado_por_id INTEGER NOT NULL CONSTRAINT proyectos_creador_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por_id INTEGER NOT NULL CONSTRAINT proyectos_actualizador_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL CONSTRAINT proyectos_request_hash
    CHECK (length(request_hash) = 64 AND request_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proyectos_fechas CHECK (fecha_inicio IS NULL OR fecha_entrega IS NULL OR fecha_inicio <= fecha_entrega),
  CONSTRAINT proyectos_request_unique UNIQUE (creado_por_id, request_id)
);
CREATE INDEX proyectos_cliente_idx ON proyectos(cliente_id);
CREATE INDEX proyectos_responsable_idx ON proyectos(responsable_id);
CREATE INDEX proyectos_actualizador_idx ON proyectos(actualizado_por_id);

CREATE TABLE proyecto_miembros (
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_miembros_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL CONSTRAINT proyecto_miembros_usuario_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT proyecto_miembros_pk PRIMARY KEY (proyecto_id, usuario_id)
);
CREATE INDEX proyecto_miembros_usuario_idx ON proyecto_miembros(usuario_id);

CREATE TABLE proyecto_etapas (
  id UUID CONSTRAINT proyecto_etapas_pk PRIMARY KEY,
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_etapas_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL CONSTRAINT proyecto_etapas_titulo CHECK (length(btrim(titulo)) BETWEEN 1 AND 250),
  posicion INTEGER NOT NULL CONSTRAINT proyecto_etapas_posicion CHECK (posicion >= 0),
  estado TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT proyecto_etapas_estado CHECK (estado IN ('pendiente','en_progreso','completada')),
  CONSTRAINT proyecto_etapas_tuple_unique UNIQUE (proyecto_id, id),
  CONSTRAINT proyecto_etapas_posicion_unique UNIQUE (proyecto_id, posicion) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE proyecto_hitos (
  id UUID CONSTRAINT proyecto_hitos_pk PRIMARY KEY,
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_hitos_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  etapa_id UUID,
  titulo TEXT NOT NULL CONSTRAINT proyecto_hitos_titulo CHECK (length(btrim(titulo)) BETWEEN 1 AND 250),
  fecha DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT proyecto_hitos_estado CHECK (estado IN ('pendiente','completado','cancelado')),
  CONSTRAINT proyecto_hitos_etapa_fk FOREIGN KEY (proyecto_id, etapa_id)
    REFERENCES proyecto_etapas(proyecto_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX proyecto_hitos_etapa_idx ON proyecto_hitos(proyecto_id, etapa_id);

CREATE TABLE proyecto_entregables (
  id UUID CONSTRAINT proyecto_entregables_pk PRIMARY KEY,
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_entregables_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL CONSTRAINT proyecto_entregables_titulo CHECK (length(btrim(titulo)) BETWEEN 1 AND 250),
  url TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '' CONSTRAINT proyecto_entregables_observaciones CHECK (length(observaciones) <= 20000),
  estado TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT proyecto_entregables_estado CHECK (estado IN ('pendiente','en_revision','aprobado','correcciones')),
  aprobado_por_id INTEGER CONSTRAINT proyecto_entregables_aprobador_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  aprobado_at TIMESTAMPTZ,
  CONSTRAINT proyecto_entregables_aprobacion CHECK (
    (estado = 'aprobado' AND aprobado_por_id IS NOT NULL AND aprobado_at IS NOT NULL)
    OR (estado <> 'aprobado' AND aprobado_por_id IS NULL AND aprobado_at IS NULL)
  )
);
CREATE INDEX proyecto_entregables_proyecto_idx ON proyecto_entregables(proyecto_id);
CREATE INDEX proyecto_entregables_aprobador_idx ON proyecto_entregables(aprobado_por_id);

CREATE TABLE proyecto_tareas (
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_tareas_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  tarea_id INTEGER NOT NULL CONSTRAINT proyecto_tareas_tarea_fk REFERENCES tareas(id) ON DELETE RESTRICT,
  etapa_id UUID,
  CONSTRAINT proyecto_tareas_pk PRIMARY KEY (proyecto_id, tarea_id),
  CONSTRAINT proyecto_tareas_tarea_unique UNIQUE (tarea_id),
  CONSTRAINT proyecto_tareas_etapa_fk FOREIGN KEY (proyecto_id, etapa_id)
    REFERENCES proyecto_etapas(proyecto_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX proyecto_tareas_etapa_idx ON proyecto_tareas(proyecto_id, etapa_id);

CREATE TABLE proyecto_actividad (
  id BIGSERIAL CONSTRAINT proyecto_actividad_pk PRIMARY KEY,
  proyecto_id UUID NOT NULL CONSTRAINT proyecto_actividad_proyecto_fk REFERENCES proyectos(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL CONSTRAINT proyecto_actividad_actor_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  accion TEXT NOT NULL CONSTRAINT proyecto_actividad_accion CHECK (accion IN (
    'crear_proyecto','editar_proyecto','crear_etapa','editar_etapa','ordenar_etapas',
    'crear_hito','editar_hito','crear_entregable','editar_entregable','vincular_tarea','desvincular_tarea'
  )),
  recurso_id UUID,
  -- Historical task identity is not a live relationship: preserve the event
  -- after explicit unlink and later task purge, without blocking that purge.
  tarea_id INTEGER CONSTRAINT proyecto_actividad_tarea_positive CHECK (tarea_id IS NULL OR tarea_id > 0),
  estado_anterior TEXT CONSTRAINT proyecto_actividad_estado_anterior CHECK (estado_anterior IS NULL OR estado_anterior IN (
    'planificado','en_curso','en_revision','pausado','finalizado','cancelado',
    'pendiente','en_progreso','completada','completado','aprobado','correcciones'
  )),
  estado_nuevo TEXT CONSTRAINT proyecto_actividad_estado_nuevo CHECK (estado_nuevo IS NULL OR estado_nuevo IN (
    'planificado','en_curso','en_revision','pausado','finalizado','cancelado',
    'pendiente','en_progreso','completada','completado','aprobado','correcciones'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX proyecto_actividad_reciente_idx ON proyecto_actividad(proyecto_id, created_at DESC, id DESC);
CREATE INDEX proyecto_actividad_actor_idx ON proyecto_actividad(actor_id);

CREATE FUNCTION proyectos_incrementar_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER proyectos_revision_cambio BEFORE UPDATE ON proyectos
  FOR EACH ROW EXECUTE FUNCTION proyectos_incrementar_revision();

-- Cross-domain guards rely on fresh statement snapshots after task-row waits.
-- Reject unsupported isolation explicitly instead of missing concurrent links.
CREATE FUNCTION proyectos_require_read_committed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='proyectos_isolation',
      MESSAGE='Los cambios de vínculos y dominio de proyectos requieren READ COMMITTED.';
  END IF;
END $$;

-- This predicate takes NO row/advisory locks. In particular, task UPDATE must
-- not lock project after task while structural writers hold project locks.
CREATE FUNCTION proyectos_assert_task_domain(task_row tareas, expected_client INTEGER) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF task_row.cliente_id IS DISTINCT FROM expected_client
    OR task_row.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'
    OR task_row.historia_id IS NOT NULL OR task_row.publicacion_id IS NOT NULL
    OR (task_row.tipo_tarea = 'produccion' AND lower(translate(concat_ws(' ',task_row.titulo,task_row.subtipo,
      task_row.propiedades_extra->>'clickup_lista'),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')) LIKE '%visita%')
    OR EXISTS(SELECT 1 FROM cliente_objetivo_piezas g WHERE g.tarea_id=task_row.id)
    OR EXISTS(SELECT 1 FROM produccion_visitas v WHERE v.tarea_origen_id=task_row.id)
    OR EXISTS(SELECT 1 FROM produccion_videos v WHERE v.tarea_edicion_id=task_row.id OR v.tarea_entrega_id=task_row.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='proyectos_tarea_domain',
      MESSAGE='La tarea vinculada debe conservar el cliente y dominio operativo del proyecto.';
  END IF;
END $$;

CREATE FUNCTION proyectos_guard_task_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_row tareas%ROWTYPE; project_client INTEGER;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.proyecto_id IS NOT DISTINCT FROM OLD.proyecto_id AND NEW.tarea_id IS NOT DISTINCT FROM OLD.tarea_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM proyectos_require_read_committed();
  -- Shared API order: objective advisory -> project advisory -> tasks -> project.
  -- UPDATE task locks also serialize reverse goal/registry bindings below.
  SELECT * INTO task_row FROM tareas WHERE id=NEW.tarea_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF; -- named FK reports missing identity
  IF COALESCE(task_row.propiedades_extra->>'archivada_render_os','false')='true'
    OR COALESCE(task_row.propiedades_extra->>'papelera_render_os','false')='true' THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='proyectos_tarea_hidden_link',
      MESSAGE='No se puede vincular una tarea archivada o en papelera.';
  END IF;
  SELECT cliente_id INTO project_client FROM proyectos WHERE id=NEW.proyecto_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM proyectos_assert_task_domain(task_row,project_client);
  RETURN NEW;
END $$;
CREATE TRIGGER proyecto_tareas_domain_guard BEFORE INSERT OR UPDATE OF proyecto_id,tarea_id ON proyecto_tareas
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_task_link();

CREATE FUNCTION proyectos_guard_linked_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_client INTEGER;
BEGIN
  IF ROW(NEW.cliente_id,NEW.historia_id,NEW.publicacion_id,NEW.tipo_tarea,NEW.titulo,NEW.subtipo,
    NEW.propiedades_extra->>'workspace',NEW.propiedades_extra->>'clickup_lista') IS NOT DISTINCT FROM
    ROW(OLD.cliente_id,OLD.historia_id,OLD.publicacion_id,OLD.tipo_tarea,OLD.titulo,OLD.subtipo,
    OLD.propiedades_extra->>'workspace',OLD.propiedades_extra->>'clickup_lista') THEN RETURN NEW; END IF;
  PERFORM proyectos_require_read_committed();
  SELECT p.cliente_id INTO project_client FROM proyectos p JOIN proyecto_tareas pt ON pt.proyecto_id=p.id WHERE pt.tarea_id=OLD.id;
  IF FOUND THEN PERFORM proyectos_assert_task_domain(NEW,project_client); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proyectos_linked_task_guard BEFORE UPDATE ON tareas
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_linked_task();

CREATE FUNCTION proyectos_guard_client_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id THEN RETURN NEW; END IF;
  PERFORM proyectos_require_read_committed();
  IF EXISTS(SELECT 1 FROM proyecto_tareas WHERE proyecto_id=OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='proyectos_cliente_linked',
      MESSAGE='No se puede cambiar el cliente de un proyecto con tareas vinculadas.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proyectos_cliente_guard BEFORE UPDATE OF cliente_id ON proyectos
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_client_change();

-- Reverse binding guards prevent later direct goal/registry writers from
-- adopting a project task. Unchanged binding columns skip task locks entirely.
CREATE FUNCTION proyectos_guard_external_task_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_ids INTEGER[];
BEGIN
  IF TG_TABLE_NAME='produccion_visitas' THEN
    IF TG_OP='UPDATE' THEN IF NEW.tarea_origen_id IS NOT DISTINCT FROM OLD.tarea_origen_id THEN RETURN NEW; END IF; END IF;
    task_ids := ARRAY[NEW.tarea_origen_id];
  ELSIF TG_TABLE_NAME='produccion_videos' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.tarea_edicion_id IS NOT DISTINCT FROM OLD.tarea_edicion_id AND NEW.tarea_entrega_id IS NOT DISTINCT FROM OLD.tarea_entrega_id THEN RETURN NEW; END IF;
    END IF;
    task_ids := ARRAY[NEW.tarea_edicion_id,NEW.tarea_entrega_id];
  ELSE
    IF TG_OP='UPDATE' THEN IF NEW.tarea_id IS NOT DISTINCT FROM OLD.tarea_id THEN RETURN NEW; END IF; END IF;
    task_ids := ARRAY[NEW.tarea_id];
  END IF;
  PERFORM proyectos_require_read_committed();
  PERFORM id FROM tareas WHERE id=ANY(task_ids) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM proyecto_tareas WHERE tarea_id=ANY(task_ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='proyectos_external_task_binding',
      MESSAGE='Una tarea de proyecto no puede vincularse a objetivos editoriales o Producciones.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proyectos_visit_source_guard BEFORE INSERT OR UPDATE OF tarea_origen_id ON produccion_visitas
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_external_task_binding();
CREATE TRIGGER proyectos_video_task_guard BEFORE INSERT OR UPDATE OF tarea_edicion_id,tarea_entrega_id ON produccion_videos
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_external_task_binding();
CREATE TRIGGER proyectos_goal_task_guard BEFORE INSERT OR UPDATE OF tarea_id ON cliente_objetivo_piezas
  FOR EACH ROW EXECUTE FUNCTION proyectos_guard_external_task_binding();
