-- Cierre histórico solicitado por dirección el 13/10/2026.
-- Exclusivo de reportes: no cambia tareas, publicaciones, objetivos ni sueldos.
CREATE TABLE IF NOT EXISTS reporte_cierres_mensuales (
  periodo DATE NOT NULL CHECK (EXTRACT(DAY FROM periodo) = 1),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  nombre_snapshot TEXT NOT NULL,
  porcentaje SMALLINT NOT NULL CHECK (porcentaje = 100),
  motivo TEXT NOT NULL,
  autorizado_por TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (periodo, usuario_id)
);

INSERT INTO reporte_cierres_mensuales
  (periodo, usuario_id, nombre_snapshot, porcentaje, motivo, autorizado_por)
SELECT DATE '2026-09-01', id, nombre, 100,
  'Septiembre cerrado al 100% por indicación de dirección; conserva los registros operativos originales.',
  'Solicitud de Agustín del 13/10/2026'
FROM usuarios
WHERE (usuario = 'oriana' AND rol = 'community')
   OR (usuario IN ('augusto', 'mariano') AND rol = 'diseno')
ON CONFLICT (periodo, usuario_id) DO NOTHING;
