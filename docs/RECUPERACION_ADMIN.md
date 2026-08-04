# Recuperación segura de un administrador

Este procedimiento se usa únicamente cuando el login de un administrador existente no puede validarse. No crea cuentas y se niega a operar si la cuenta no es única, no es administradora, su hash actual no es bcrypt o la base conectada no coincide con el nombre confirmado.

## Antes de ejecutarlo

1. Confirmar en Hostinger que el servicio de `sistema.rendercorrientes.com` tiene `DATABASE_URL` y `JWT_SECRET` configurados, sin copiar ni mostrar sus valores.
2. Obtener desde el panel el nombre de la base productiva y usarlo como `RECOVERY_EXPECTED_DATABASE`.
3. Detenerse si la URL pertenece a Render o a un entorno distinto de Hostinger.
4. Elegir una contraseña nueva de al menos 12 caracteres y transmitirla fuera de logs, tickets y repositorios.

## Ejecución manual en Hostinger

Definir temporalmente, solo en la terminal del servicio, estas variables y ejecutar `npm run recover:admin --prefix backend`:

- `RECOVERY_ADMIN_USER`: usuario administrador existente.
- `RECOVERY_ADMIN_PASSWORD`: contraseña nueva.
- `RECOVERY_EXPECTED_DATABASE`: nombre exacto de la base confirmada.
- `RECOVERY_CONFIRMATION=RECUPERAR_ADMIN_HOSTINGER`.

Después se deben borrar esas variables del entorno de la terminal y probar esta secuencia desde el dominio canónico: login, logout, segundo login, logout y tercer login. El script nunca imprime la contraseña ni el hash.
