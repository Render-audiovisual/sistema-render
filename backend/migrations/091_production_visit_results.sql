-- Explicit results of identified media; never backfill or finalize old tasks.
CREATE TABLE produccion_resultados (
  id UUID PRIMARY KEY,
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  visita_revision INTEGER NOT NULL CHECK(visita_revision>0 AND visita_revision<2147483647),
  revision_resultante INTEGER NOT NULL CHECK(revision_resultante=visita_revision+1),
  registrado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  registrado_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resumen JSONB NOT NULL CHECK(jsonb_typeof(resumen)='object' AND resumen @> '{"version":1}'::jsonb),
  UNIQUE(visita_id,visita_revision),
  UNIQUE(registrado_por_id,request_id)
);
CREATE FUNCTION produccion_resultado_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Production results are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER produccion_resultado_immutable BEFORE UPDATE OR DELETE ON produccion_resultados
  FOR EACH ROW EXECUTE FUNCTION produccion_resultado_immutable();
