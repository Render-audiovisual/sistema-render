-- Las cuentas reales conservan mayúsculas: Oriana, Augusto y Mariano.
-- Completa el mismo cierre autorizado, sin modificar las cuentas ni sus tareas.
WITH cuentas AS (
  SELECT id,nombre,rol,lower(trim(usuario)) AS cuenta,
    count(*) OVER (PARTITION BY lower(trim(usuario))) AS coincidencias
  FROM usuarios
  WHERE lower(trim(usuario)) IN ('oriana','augusto','mariano')
)
INSERT INTO reporte_cierres_mensuales
  (periodo,usuario_id,nombre_snapshot,porcentaje,motivo,autorizado_por)
SELECT DATE '2026-09-01',id,nombre,100,
  'Septiembre cerrado al 100% por indicación de dirección; conserva los registros operativos originales.',
  'Solicitud de Agustín del 13/10/2026'
FROM cuentas
WHERE coincidencias=1
  AND ((cuenta='oriana' AND rol='community')
    OR (cuenta IN ('augusto','mariano') AND rol='diseno'))
ON CONFLICT (periodo,usuario_id) DO NOTHING;
