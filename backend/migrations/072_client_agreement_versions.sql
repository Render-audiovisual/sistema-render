-- Server-owned monotonic observations; no business state or historical amounts
-- are reinterpreted. Existing rows start at version1. Never trust caller versions.
ALTER TABLE clientes ADD COLUMN agreement_version INTEGER NOT NULL DEFAULT 1 CHECK(agreement_version > 0);
ALTER TABLE grupos_feed ADD COLUMN agreement_version INTEGER NOT NULL DEFAULT 1 CHECK(agreement_version > 0);

CREATE FUNCTION client_agreement_monotonic_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.agreement_version := OLD.agreement_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER client_agreement_monotonic_version BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION client_agreement_monotonic_version();
CREATE TRIGGER group_agreement_monotonic_version BEFORE UPDATE ON grupos_feed
  FOR EACH ROW EXECUTE FUNCTION client_agreement_monotonic_version();

CREATE FUNCTION client_agreement_child_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected INTEGER;
BEGIN
  FOR affected IN SELECT id FROM public.clientes WHERE id=ANY(
    CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.cliente_id]
      WHEN 'DELETE' THEN ARRAY[OLD.cliente_id] ELSE ARRAY[OLD.cliente_id,NEW.cliente_id] END
  ) ORDER BY id LOOP
    UPDATE public.clientes SET agreement_version=agreement_version WHERE id=affected;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER client_configuration_agreement_changed AFTER INSERT OR UPDATE OR DELETE ON cliente_configuraciones
  FOR EACH ROW EXECUTE FUNCTION client_agreement_child_changed();
CREATE TRIGGER client_fee_agreement_changed AFTER INSERT OR UPDATE OR DELETE ON cliente_abonos
  FOR EACH ROW EXECUTE FUNCTION client_agreement_child_changed();
