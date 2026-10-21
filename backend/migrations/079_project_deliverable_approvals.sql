-- New revisions begin here; legacy approvals remain explicitly unversioned.
-- No historical approval or business row is rewritten/backfilled.
ALTER TABLE proyecto_entregables
  ADD COLUMN contenido_revision INTEGER NOT NULL DEFAULT 1 CHECK(contenido_revision>0),
  ADD COLUMN entregable_revision INTEGER NOT NULL DEFAULT 1 CHECK(entregable_revision>0),
  ADD COLUMN aprobacion_actual_id UUID,
  ADD CONSTRAINT proyecto_entregables_identity_unique UNIQUE(proyecto_id,id);

CREATE TABLE proyecto_entregable_aprobaciones (
  id UUID PRIMARY KEY,
  proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE RESTRICT,
  entregable_id UUID NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[a-f0-9]{64}$'),
  observed_project_revision INTEGER NOT NULL CHECK(observed_project_revision>0),
  observed_entregable_revision INTEGER NOT NULL CHECK(observed_entregable_revision>0),
  contenido_revision INTEGER NOT NULL CHECK(contenido_revision>0),
  entregable_revision INTEGER NOT NULL CHECK(entregable_revision=observed_entregable_revision+1),
  contenido_hash TEXT NOT NULL CHECK(length(contenido_hash)=64 AND contenido_hash ~ '^[a-f0-9]{64}$'),
  titulo TEXT NOT NULL CHECK(length(btrim(titulo)) BETWEEN 1 AND 250),
  url TEXT NOT NULL,
  observaciones TEXT NOT NULL CHECK(length(observaciones)<=20000),
  aprobado_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id,request_id),
  UNIQUE(entregable_id,entregable_revision),
  UNIQUE(id,proyecto_id,entregable_id),
  FOREIGN KEY(proyecto_id,entregable_id) REFERENCES proyecto_entregables(proyecto_id,id) ON DELETE RESTRICT
);
CREATE INDEX proyecto_entregable_aprobaciones_resource_idx ON proyecto_entregable_aprobaciones(proyecto_id,entregable_id);
CREATE INDEX proyecto_entregable_aprobaciones_entregable_idx ON proyecto_entregable_aprobaciones(entregable_id);
ALTER TABLE proyecto_entregables ADD CONSTRAINT proyecto_entregables_current_approval_fk
  FOREIGN KEY(aprobacion_actual_id,proyecto_id,id)
  REFERENCES proyecto_entregable_aprobaciones(id,proyecto_id,entregable_id) ON DELETE RESTRICT;
CREATE INDEX proyecto_entregables_current_approval_idx ON proyecto_entregables(aprobacion_actual_id);

CREATE FUNCTION proyecto_entregable_approval_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='proyecto_entregable_approval_immutable',
    MESSAGE='La evidencia de aprobación es inmutable.';
END $$;
CREATE TRIGGER proyecto_entregable_approval_immutable_guard
  BEFORE UPDATE OR DELETE ON proyecto_entregable_aprobaciones
  FOR EACH ROW EXECUTE FUNCTION proyecto_entregable_approval_immutable();

CREATE FUNCTION proyecto_entregable_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE content_changed BOOLEAN; approval_changed BOOLEAN; proof proyecto_entregable_aprobaciones%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.contenido_revision:=1;
    NEW.entregable_revision:=1;
    IF NEW.estado='aprobado' OR NEW.aprobacion_actual_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='proyecto_entregables_explicit_approval',
        MESSAGE='La aprobación requiere revisar un entregable guardado.';
    END IF;
    RETURN NEW;
  END IF;
  content_changed := ROW(NEW.titulo,NEW.url,NEW.observaciones) IS DISTINCT FROM ROW(OLD.titulo,OLD.url,OLD.observaciones);
  NEW.contenido_revision:=OLD.contenido_revision + CASE WHEN content_changed THEN 1 ELSE 0 END;
  IF content_changed THEN
    NEW.aprobacion_actual_id:=NULL;
    NEW.aprobado_por_id:=NULL;
    NEW.aprobado_at:=NULL;
    IF OLD.estado='aprobado' OR NEW.estado='aprobado' THEN NEW.estado:='en_revision'; END IF;
  END IF;
  IF NEW.estado<>'aprobado' THEN
    NEW.aprobacion_actual_id:=NULL;
    NEW.aprobado_por_id:=NULL;
    NEW.aprobado_at:=NULL;
  END IF;
  approval_changed:=ROW(NEW.estado,NEW.aprobacion_actual_id,NEW.aprobado_por_id,NEW.aprobado_at)
    IS DISTINCT FROM ROW(OLD.estado,OLD.aprobacion_actual_id,OLD.aprobado_por_id,OLD.aprobado_at);
  NEW.entregable_revision:=OLD.entregable_revision + CASE WHEN content_changed OR approval_changed THEN 1 ELSE 0 END;
  IF NEW.estado='aprobado' THEN
    -- An untouched pre-079 approval remains legacy, never silently certified.
    IF NEW.aprobacion_actual_id IS NULL THEN
      IF OLD.estado IS DISTINCT FROM 'aprobado' OR content_changed OR approval_changed THEN
        RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='proyecto_entregables_explicit_approval',
          MESSAGE='La aprobación requiere evidencia de la versión observada.';
      END IF;
    ELSE
      SELECT * INTO proof FROM proyecto_entregable_aprobaciones WHERE id=NEW.aprobacion_actual_id;
      IF NOT FOUND OR proof.proyecto_id<>NEW.proyecto_id OR proof.entregable_id<>NEW.id
        OR proof.contenido_revision<>NEW.contenido_revision OR proof.entregable_revision<>NEW.entregable_revision
        OR ROW(proof.titulo,proof.url,proof.observaciones) IS DISTINCT FROM ROW(NEW.titulo,NEW.url,NEW.observaciones)
        OR proof.actor_id IS DISTINCT FROM NEW.aprobado_por_id OR proof.aprobado_at IS DISTINCT FROM NEW.aprobado_at THEN
        RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='proyecto_entregables_approval_version',
          MESSAGE='La aprobación no corresponde a la versión actual.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proyecto_entregables_revision_guard BEFORE INSERT OR UPDATE ON proyecto_entregables
  FOR EACH ROW EXECUTE FUNCTION proyecto_entregable_revision_guard();
