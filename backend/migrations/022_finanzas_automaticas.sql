CREATE TABLE IF NOT EXISTS contratos_financieros (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  importe_mensual NUMERIC(14,2) NOT NULL CHECK (importe_mensual >= 0),
  inicia_el DATE NOT NULL,
  finaliza_el DATE,
  UNIQUE (nombre, inicia_el)
);

CREATE TABLE IF NOT EXISTS gastos_fijos_financieros (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('sueldos','impuestos','herramientas')),
  moneda TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  importe NUMERIC(14,2) NOT NULL CHECK (importe >= 0),
  dia_pago INTEGER CHECK (dia_pago BETWEEN 1 AND 31),
  inicia_el DATE NOT NULL,
  finaliza_el DATE,
  UNIQUE (nombre, inicia_el)
);

INSERT INTO contratos_financieros (nombre,importe_mensual,inicia_el) VALUES
  ('Litoralmaq',950000,'2026-08-01'),
  ('EAA',600000,'2026-08-01'),
  ('Bohle',500000,'2026-08-01'),
  ('Moketa',680000,'2026-08-01'),
  ('iPhone Shop',900000,'2026-08-01'),
  ('Bendita',550000,'2026-08-01'),
  ('Lavalle',1200000,'2026-08-01'),
  ('Chevrolet',1800000,'2026-08-01'),
  ('Bunker',390000,'2026-08-01'),
  ('Luzin',780000,'2026-08-01'),
  ('EOS Estética',550000,'2026-08-01'),
  ('Óptica Occhiali',650000,'2026-08-19'),
  ('Pope Burger',550000,'2026-09-01')
ON CONFLICT (nombre,inicia_el) DO UPDATE SET importe_mensual=EXCLUDED.importe_mensual;

INSERT INTO gastos_fijos_financieros (nombre,categoria,moneda,importe,dia_pago,inicia_el) VALUES
  ('Franco Romero — Programador','sueldos','ARS',75000,1,'2026-08-01'),
  ('ChatGPT','herramientas','USD',100,1,'2026-08-01'),
  ('Adobe — 2 cuentas','herramientas','ARS',36000,3,'2026-08-01'),
  ('Contabo / Servidor','herramientas','USD',10,5,'2026-08-01'),
  ('Google Drive / Google One','herramientas','ARS',18300,7,'2026-08-01'),
  ('Monotributo','impuestos','ARS',45000,20,'2026-08-01'),
  ('Ingresos Brutos','impuestos','ARS',50000,20,'2026-08-01'),
  ('Cloud Code','herramientas','ARS',30000,26,'2026-08-01')
ON CONFLICT (nombre,inicia_el) DO UPDATE SET categoria=EXCLUDED.categoria,moneda=EXCLUDED.moneda,
  importe=EXCLUDED.importe,dia_pago=EXCLUDED.dia_pago;
