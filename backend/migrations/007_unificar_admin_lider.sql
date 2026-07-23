-- Unifica las dos cuentas administrativas históricas en una sola cuenta Líder.
-- Conserva la contraseña y la foto de la cuenta de Agustín, cambia su usuario
-- de acceso a `lider` y elimina únicamente la cuenta de acceso de Franco.
-- Las tareas históricas mantienen sus nombres originales para no perder trazabilidad.

UPDATE usuarios
SET usuario = 'lider', nombre = 'Líder', rol = 'admin'
WHERE lower(usuario) = 'agustin';

DELETE FROM usuarios
WHERE lower(usuario) = 'franco';
