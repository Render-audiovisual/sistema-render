CREATE TABLE IF NOT EXISTS cliente_abonos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  vigente_desde DATE NOT NULL,
  importe NUMERIC(14,2) NOT NULL CHECK (importe >= 0),
  creado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, vigente_desde),
  CHECK (vigente_desde = date_trunc('month', vigente_desde)::date)
);

INSERT INTO cliente_abonos (cliente_id, vigente_desde, importe)
SELECT cliente_id, vigente_desde, abono_mensual FROM cliente_configuraciones
ON CONFLICT (cliente_id, vigente_desde) DO NOTHING;

CREATE TABLE IF NOT EXISTS empleado_compensaciones (
  id SERIAL PRIMARY KEY,
  empleado_clave TEXT NOT NULL,
  vigente_desde DATE NOT NULL,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('mensual', 'por_pieza')),
  sueldo_base NUMERIC(14,2), tarifa_facil NUMERIC(14,2), tarifa_intermedia NUMERIC(14,2),
  creado_por TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empleado_clave, vigente_desde),
  CHECK (vigente_desde = date_trunc('month', vigente_desde)::date),
  CHECK (COALESCE(sueldo_base,0) >= 0 AND COALESCE(tarifa_facil,0) >= 0 AND COALESCE(tarifa_intermedia,0) >= 0)
);

INSERT INTO empleado_compensaciones (empleado_clave, vigente_desde, modalidad, sueldo_base, tarifa_facil, tarifa_intermedia)
VALUES ('oriana','2026-09-01','mensual',450000,NULL,NULL), ('augusto','2026-09-01','mensual',560000,NULL,NULL),
 ('mariano','2026-09-01','mensual',600000,NULL,NULL), ('german','2026-09-01','mensual',650000,NULL,NULL),
 ('luciano','2026-09-01','por_pieza',NULL,5000,10000)
ON CONFLICT (empleado_clave, vigente_desde) DO NOTHING;

CREATE TABLE IF NOT EXISTS empleado_pagos_mensuales (
  id SERIAL PRIMARY KEY, empleado_clave TEXT NOT NULL, periodo_trabajo DATE NOT NULL,
  importe_final NUMERIC(14,2) NOT NULL CHECK (importe_final >= 0), confirmado_por TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empleado_clave, periodo_trabajo),
  CHECK (periodo_trabajo = date_trunc('month', periodo_trabajo)::date)
);

CREATE TABLE IF NOT EXISTS empleado_pagos_historial (
  id SERIAL PRIMARY KEY, pago_id INTEGER NOT NULL REFERENCES empleado_pagos_mensuales(id) ON DELETE CASCADE,
  importe_anterior NUMERIC(14,2), importe_nuevo NUMERIC(14,2) NOT NULL,
  modificado_por TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
