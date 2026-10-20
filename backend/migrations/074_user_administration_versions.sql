-- Observations only: do not rewrite identities, credentials or account state.
ALTER TABLE usuarios ADD COLUMN user_admin_version INTEGER NOT NULL DEFAULT 1 CHECK (user_admin_version > 0);
CREATE FUNCTION user_administration_monotonic_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.user_admin_version := OLD.user_admin_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER user_administration_monotonic_version BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION user_administration_monotonic_version();
