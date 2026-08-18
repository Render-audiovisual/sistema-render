CREATE TABLE IF NOT EXISTS resumen_financiero_mensual (
  id SERIAL PRIMARY KEY,
  periodo DATE NOT NULL UNIQUE,
  facturacion NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (facturacion >= 0),
  sueldos NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (sueldos >= 0),
  impuestos NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (impuestos >= 0),
  herramientas NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (herramientas >= 0),
  actualizado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (periodo = date_trunc('month', periodo)::date)
);
