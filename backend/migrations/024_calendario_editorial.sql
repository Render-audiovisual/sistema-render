ALTER TABLE cliente_configuraciones
  ADD COLUMN IF NOT EXISTS dias_reels smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dias_carruseles smallint[] NOT NULL DEFAULT '{}';

ALTER TABLE publicaciones
  ADD COLUMN IF NOT EXISTS origen_calendario text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS calendario_clave text,
  ADD COLUMN IF NOT EXISTS fecha_bloqueada boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS publicaciones_calendario_clave_uidx
  ON publicaciones (calendario_clave)
  WHERE calendario_clave IS NOT NULL;

CREATE INDEX IF NOT EXISTS publicaciones_fecha_programada_idx
  ON publicaciones (fecha_programada);

ALTER TABLE publicaciones DROP CONSTRAINT IF EXISTS publicaciones_origen_calendario_check;
ALTER TABLE publicaciones ADD CONSTRAINT publicaciones_origen_calendario_check
  CHECK (origen_calendario IN ('manual', 'automatico'));
