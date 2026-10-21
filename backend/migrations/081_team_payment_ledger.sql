-- Additive, empty manual ledger. Never infer actual transfers or recipient IDs
-- from salary calculations, legacy monthly overrides, names or completed work.
CREATE TABLE team_payments (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  recipient_name TEXT NOT NULL CHECK (length(btrim(recipient_name)) > 0),
  recorded_by_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  recorded_by_name TEXT NOT NULL CHECK (length(btrim(recorded_by_name)) > 0),
  fecha_pago DATE NOT NULL,
  periodo_trabajo DATE NOT NULL CHECK (periodo_trabajo = date_trunc('month',periodo_trabajo)::date),
  moneda TEXT NOT NULL CHECK (moneda = 'ARS'),
  importe NUMERIC(14,2) NOT NULL CHECK (importe > 0),
  referencia TEXT NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  drive_url TEXT,
  provenance TEXT NOT NULL DEFAULT 'manual' CHECK (provenance = 'manual'),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  void_reason TEXT,
  CHECK ((status='recorded' AND voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL)
    OR (status='voided' AND voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND length(btrim(void_reason)) BETWEEN 3 AND 500)),
  CHECK (drive_url IS NULL OR length(drive_url) <= 2000)
);
CREATE INDEX team_payments_actual_date ON team_payments(fecha_pago DESC,id DESC);
CREATE INDEX team_payments_recipient_date ON team_payments(recipient_id,fecha_pago DESC,id DESC);

CREATE TABLE team_payment_events (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES team_payments(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('recorded','voided')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_payment_events_payment ON team_payment_events(payment_id,id);

CREATE TABLE team_payment_receipts (
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operation_key UUID NOT NULL,
  intent_hash TEXT NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  payment_id INTEGER NOT NULL REFERENCES team_payments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,operation_key)
);

-- Original financial facts are immutable. Corrections are explicit voids plus
-- separate new manual records; a void never claims to reverse a bank transfer.
CREATE FUNCTION guard_team_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','version','voided_at','voided_by_id','void_reason'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','voided_at','voided_by_id','void_reason'])
     OR OLD.status <> 'recorded' OR NEW.status <> 'voided' OR NEW.version <> OLD.version+1 THEN
    RAISE EXCEPTION 'Payment history only permits an explicit versioned void' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_payment_history_guard BEFORE UPDATE OR DELETE ON team_payments
  FOR EACH ROW EXECUTE FUNCTION guard_team_payment_history();
