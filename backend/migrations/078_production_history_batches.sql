-- Append-only reviewed provenance. No backfill or changes to 069/070 history.
-- 015 allowed only one aggregate child per source, irrespective of video.
-- Retire ONLY that index. 059/060 canonical video/task uniqueness stays intact.
DROP INDEX public.tareas_render_os_origen_visita_unico;
CREATE INDEX tareas_origen_visita_history_lookup
  ON public.tareas ((propiedades_extra->>'origen_visita_id'))
  WHERE propiedades_extra->>'origen_visita_id' IS NOT NULL;
ALTER TABLE produccion_videos ADD CONSTRAINT produccion_videos_batch_binding_unique
  UNIQUE(id,visita_id,tarea_edicion_id);
CREATE TABLE produccion_revision_lotes (
  id UUID PRIMARY KEY,
  secuencia BIGSERIAL NOT NULL UNIQUE,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[a-f0-9]{64}$'),
  tarea_origen_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK(source_revision>0),
  source_history_hash TEXT NOT NULL CHECK(length(source_history_hash)=64 AND source_history_hash ~ '^[a-f0-9]{64}$'),
  context_hash TEXT NOT NULL CHECK(length(context_hash)=64 AND context_hash ~ '^[a-f0-9]{64}$'),
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  observed_visit_revision INTEGER CHECK(observed_visit_revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(actor_user_id,request_id),
  UNIQUE(id,visita_id)
);
CREATE INDEX produccion_revision_lotes_source_idx ON produccion_revision_lotes(tarea_origen_id);
CREATE INDEX produccion_revision_lotes_visit_idx ON produccion_revision_lotes(visita_id,secuencia DESC);

CREATE TABLE produccion_lote_edicion_mapeos (
  video_id UUID PRIMARY KEY REFERENCES produccion_videos(id) ON DELETE RESTRICT,
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  tarea_edicion_id INTEGER NOT NULL UNIQUE REFERENCES tareas(id) ON DELETE RESTRICT,
  task_revision INTEGER NOT NULL CHECK(task_revision>0),
  editor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  fecha_entrega DATE NOT NULL,
  lote_id UUID NOT NULL,
  FOREIGN KEY(lote_id,visita_id) REFERENCES produccion_revision_lotes(id,visita_id) ON DELETE RESTRICT,
  FOREIGN KEY(video_id,visita_id,tarea_edicion_id)
    REFERENCES produccion_videos(id,visita_id,tarea_edicion_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX produccion_lote_edicion_mapeos_visit_idx ON produccion_lote_edicion_mapeos(visita_id);
CREATE INDEX produccion_lote_edicion_mapeos_lote_idx ON produccion_lote_edicion_mapeos(lote_id);
CREATE INDEX produccion_lote_edicion_mapeos_editor_idx ON produccion_lote_edicion_mapeos(editor_id);

CREATE TABLE produccion_revision_lote_videos (
  lote_id UUID NOT NULL REFERENCES produccion_revision_lotes(id) ON DELETE RESTRICT,
  video_id UUID NOT NULL REFERENCES produccion_videos(id) ON DELETE RESTRICT,
  ordinal SMALLINT NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
  disposition TEXT NOT NULL CHECK(disposition IN ('adopt_original','manual_independent')),
  tarea_edicion_id INTEGER REFERENCES tareas(id) ON DELETE RESTRICT,
  PRIMARY KEY(lote_id,video_id),
  UNIQUE(lote_id,ordinal),
  UNIQUE(lote_id,tarea_edicion_id),
  UNIQUE(lote_id,video_id,tarea_edicion_id),
  CHECK((disposition='adopt_original')=(tarea_edicion_id IS NOT NULL))
);
CREATE INDEX produccion_revision_lote_videos_video_idx ON produccion_revision_lote_videos(video_id);
CREATE INDEX produccion_revision_lote_videos_task_idx ON produccion_revision_lote_videos(tarea_edicion_id);

CREATE TABLE produccion_revision_lote_hijos (
  lote_id UUID NOT NULL REFERENCES produccion_revision_lotes(id) ON DELETE RESTRICT,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE RESTRICT,
  task_revision INTEGER NOT NULL CHECK(task_revision>0),
  disposition TEXT NOT NULL CHECK(disposition IN ('mapped','preserve_unmapped')),
  video_id UUID,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  PRIMARY KEY(lote_id,tarea_id),
  UNIQUE(lote_id,video_id),
  FOREIGN KEY(lote_id,video_id) REFERENCES produccion_revision_lote_videos(lote_id,video_id) ON DELETE RESTRICT,
  FOREIGN KEY(lote_id,video_id,tarea_id)
    REFERENCES produccion_revision_lote_videos(lote_id,video_id,tarea_edicion_id) ON DELETE RESTRICT,
  CHECK((disposition='mapped')=(video_id IS NOT NULL))
);
CREATE INDEX produccion_revision_lote_hijos_task_idx ON produccion_revision_lote_hijos(tarea_id);
CREATE INDEX produccion_revision_lote_hijos_video_idx ON produccion_revision_lote_hijos(video_id);
