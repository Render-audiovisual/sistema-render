-- Add observations only. Existing contract amounts, dates and lifecycle stay as
-- stored; no relation to clientes is inferred from names.
ALTER TABLE contratos_financieros ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version > 0);
CREATE FUNCTION financial_contract_monotonic_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.contract_version := OLD.contract_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_contract_monotonic_version BEFORE UPDATE ON contratos_financieros
  FOR EACH ROW EXECUTE FUNCTION financial_contract_monotonic_version();
