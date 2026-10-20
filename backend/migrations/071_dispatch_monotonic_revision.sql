-- Every future dispatch update must invalidate the opaque microsecond CAS token.
-- Includes FK ON DELETE SET NULL and non-HTTP writers. Installation intentionally
-- does not rewrite existing records or change their publication/deletion semantics.
CREATE FUNCTION publicacion_envios_monotonic_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = GREATEST(
    clock_timestamp(),
    OLD.updated_at + interval '1 microsecond'
  );
  RETURN NEW;
END $$;

CREATE TRIGGER publicacion_envios_monotonic_revision
  BEFORE UPDATE ON publicacion_envios
  FOR EACH ROW EXECUTE FUNCTION publicacion_envios_monotonic_revision();
