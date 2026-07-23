# Deploy — Render Platform

Este documento reemplaza al servidor misterioso de `66.94.104.21`: acá está
todo lo necesario para levantar el sistema en un servidor nuevo, de forma
reproducible, sin depender de que alguien recuerde comandos sueltos.

## Qué cambió respecto al server viejo

- **Antes:** frontend (Vite, puerto 5173) y backend (Express, puerto 3001)
  corrían como dos procesos separados. Funcionaba solo porque estaban en la
  misma máquina — el proxy de Vite reenviaba `/api/*` a `localhost:3001`.
  En cualquier hosting con servicios separados esto se rompe.
- **Ahora:** un solo proceso. El backend sirve la API bajo `/api/*` **y**
  los archivos estáticos del frontend ya compilado, desde el mismo puerto.
  No hace falta CORS ni coordinar dos URLs.
- **Antes:** no existía ningún `schema.sql`. Las tablas del servidor viejo
  se crearon a mano, en algún momento, por alguien — no reproducible.
- **Ahora:** `backend/migrations/000_initial_schema.sql` crea las 8 tablas
  desde cero. `npm start` corre las migraciones automáticamente antes de
  arrancar (es seguro correrlas más de una vez).

## Variables de entorno necesarias

| Variable | Para qué | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Conexión a Postgres | `postgres://user:pass@host:5432/render_platform` |
| `PORT` | Puerto donde escucha el server | `3001` (o el que asigne el hosting) |
| `JWT_SECRET` | Firma los tokens de sesión | generar con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SMTP_HOST` | Servidor de correo para avisos de tareas | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto SMTP | `465` |
| `SMTP_SECURE` | Usar TLS desde el inicio | `true` |
| `SMTP_USER` | Cuenta que envía los avisos | `notificaciones@ejemplo.com` |
| `SMTP_PASS` | Contraseña de aplicación del correo | secreto del proveedor |
| `EMAIL_FROM` | Remitente visible (opcional si coincide con `SMTP_USER`) | `RENDER <notificaciones@ejemplo.com>` |
| `EMAIL_REPLY_TO` | Dirección para respuestas (opcional) | `equipo@ejemplo.com` |
| `APP_URL` | URL usada en el botón “Abrir tarea” | `https://sistema-render-xuwo.onrender.com` |

**`JWT_SECRET` es obligatorio.** Sin él, el login no genera tokens válidos.
Nunca lo dejes vacío ni reutilices uno de otro proyecto.

Los avisos por email se envían solamente al crear una tarea o cuando cambia
su responsable. Si el SMTP no está configurado o el integrante no tiene
`email_notificaciones`, la tarea se guarda igual y el envío se omite. Para
Gmail se debe usar una contraseña de aplicación; nunca la contraseña normal
de la cuenta.

## Primer deploy, paso a paso

1. **Base de datos:** crear una instancia de Postgres (16 o superior) en el
   mismo hosting, o usar una externa. Copiar su `DATABASE_URL`.

2. **Build:**
   ```
   npm run build
   ```
   Compila el frontend a `frontend/dist`.

3. **Start:**
   ```
   npm start
   ```
   Instala dependencias del backend, corre las migraciones pendientes
   (crea las 8 tablas si no existen) y arranca el server. Sirve la API en
   `/api/*` y el frontend compilado en todo lo demás.

4. **Crear los 6 usuarios** (una sola vez, después del primer deploy):
   ```
   SEED_PASSWORD_DEFAULT="una-contraseña-fuerte" npm run seed:usuarios
   ```
   Crea `agustin`, `franco` (admin), `augusto` (diseño), `luciano`
   (edición), `german` (producción), `oriana` (community) — son los únicos
   usuarios que el frontend reconoce (ver `USUARIO_A_RUTA` en
   `frontend/src/main.jsx`). Todos arrancan con la misma contraseña inicial;
   cada uno puede cambiarla después desde `/perfil`. Correr este comando de
   nuevo no pisa contraseñas ya cambiadas — solo crea los usuarios que
   falten.

5. **Clientes:** se siembran solos en el primer arranque (`clientes` ya
   tenía un seed en `backend/src/setup-demo-data.js`, no cambió).

## Desarrollo local (sin tocar nada de esto)

Sigue funcionando exactamente igual que antes:
```
cd backend && npm run dev     # Express en :3001
cd frontend && npm run dev    # Vite en :5173, proxya /api a :3001
```
El server detecta que no existe `frontend/dist` y no intenta servir
estáticos — usa el flujo de Vite dev normal.

## ⚠️ Pendiente de seguridad (heredado, no resuelto en este deploy)

`docs/DIAGNOSTICO_RENDER.md` ya lo marcaba como crítico y sigue así: **las
rutas de la API no validan el token JWT.** Cualquiera con la URL puede leer
y modificar clientes, historias, publicaciones y tareas sin loguearse. Esto
no se tocó en este trabajo porque es un cambio de seguridad grande que
merece revisión aparte, no algo para meter de paso. No lo dejes en producción
con datos reales de clientes sin resolver esto primero.
