# Arranque y preparación explícita — Render Platform

Este procedimiento describe el contrato local de seguridad, no una aprobación de despliegue. Render2 no se declara listo para producción. Ver [contrato de arranque](render-2/STARTUP_SAFETY_CONTRACT.md) y [estado de integración](render-2/STATUS.md).

Preparación offline de Hostinger: [protocolo, variables propuestas y controles de datos nuevos](render-2/HOSTINGER_SAFE_PUBLICATION_RUNBOOK.md). No importar su plantilla sobre variables existentes ni confundir prepare/check con ejecución productiva. Los correos personales pendientes no autorizan borrar SMTP. Ningún comando nuevo habilita apply/deploy.

Último candidato verificado (27/10/2026): [auditoría integrada y preparación de publicación](render-2/EDITING_AUDIT_INTEGRATION_AND_RELEASE_CANDIDATE.md). Incluye la migración oficial `20261027144706_editing_progress_unified_ledger.sql`, ensayo de41 migraciones sobre otra restauración del respaldo reciente y preservación de tareas/datos. Arranque rechaza el binding de auditoría faltante, deshabilitado o alterado. No hay actualización productiva ni ejecutor productivo habilitado; el procedimiento local descrito abajo no es una vía para sortear ese bloqueo. No reejecutar051/052 ni reemplazar la base viva por la copia.

## Separar build, migración y arranque

El comando heredado `npm run seed:usuarios` está deshabilitado y no conecta a PostgreSQL: su roster compartido “Líder” y contraseña predeterminada no son un mecanismo de identidad válido para Render2. Con un administrador existente y accesible, crear los accesos independientes desde **Usuarios y equipo**, verificando el login propio de cada integrante antes de cambiar accesos antiguos. No se renombra, promueve, convierte ni elimina una cuenta existente automáticamente. No compartir credenciales ni usar el selector visual como autenticación. Esta vía no resuelve una instalación con cero administradores: el bootstrap inicial requiere un procedimiento separado y autorizado; no usar un seed histórico ni modificar roles a mano como solución implícita.

El backend sirve /api y el frontend compilado desde un mismo proceso. El build no autoriza cambios de datos. `npm start`, `npm run start:hostinger` y `npm run dev:backend` no deben ejecutar migraciones, seeds ni jobs implícitos.

La migración092 añade procedencia de comentarios (`actor_usuario_id` nullable, FK restrictiva e índice) sin atribuir por nombre los comentarios históricos o automáticos. Writer humano, DTO, recuperación y frontend deben desplegarse coordinadamente después del ensayo/backup y autorización del destino. El arranque comprueba columna y FK, no repara ni aplica SQL. Una reversión a código anterior puede volver a escribir NULL: la compatibilidad de una columna nullable no garantiza trazabilidad universal. No convertir autores antiguos por nombres o recibos ni eliminar usuarios para sortear la FK. Hasta aquí092 solo fue aplicada en fixtures descartables, no en una base existente ni producción.

- Instalar dependencias y compilar en una fase separada.
- Configurar explícitamente DATABASE_URL (PostgreSQL) y RENDER_DB_ENVIRONMENT: development, sandbox, test o production. No se aceptan destinos heredados de PGHOST/PGDATABASE ni entornos desconocidos.
- Mantener SETUP_DEMO_DATA=false, RENDER_BACKGROUND_JOBS vacío y RENDER_ALLOW_BACKGROUND_WRITES=false.
- Antes de escuchar, el servidor comprueba el ledger sin crearlo ni repararlo. Ledger ausente/inválido, archivos pendientes o nombres aplicados desconocidos impiden arrancar.
- Un rechazo de arranque no autoriza a crear una baseline, alterar el ledger ni repetir la cadena histórica.

No imprimir URLs, credenciales, claves, tokens ni contenido SQL en diagnósticos. HOST=127.0.0.1 permite limitar la escucha local; PORT=0 permite un puerto efímero para verificaciones autorizadas.

## Inspección y migración local autorizada

Sin subcomando, el CLI muestra ayuda sin conectar:

```sh
npm run migrate
```

Solo después de autorizar un destino local no productivo identificado:

```sh
npm run migrate -- status
```

Status inspecciona sin escribir y entrega identidad segura, nombres/hashes pendientes y hash del plan. Aplicar requiere aprobación explícita del plan y de la identidad observados:

La salida JSON tiene forma `{environment, identity, status, planHash: "HASHSTRING"}`.
Al parsearla como `parsed`, el hash es `parsed.planHash` (string), no
`parsed.plan.planHash`. `buildMigrationPlan(...)` devuelve directamente ese
string; no un objeto contenedor. Usar ese valor observado para `--plan`.

```sh
npm run migrate -- apply --plan HASH_APROBADO --database BASE_CONFIRMADA --user USUARIO_CONFIRMADO
```

Los valores anteriores son placeholders, no instrucciones para una base existente. El runner vuelve a comprobar identidad y plan bajo lock; un cambio invalida la aprobación. Producción no admite apply ni override en este bloque. No ejecutar migraciones contra una base desconocida. La cadena histórica incluye DML y eliminaciones: que un archivo figure como pendiente no autoriza su ejecución.

El comando raíz delega directamente al CLI, pasando argumentos sin instalar dependencias. Desde backend, la misma interfaz usa `npm run migrate -- ...`.

## Arranque normal

Con dependencias instaladas, frontend compilado y esquema previamente aprobado/completo:

```sh
npm start
```

En el directorio raíz, `npm run start:hostinger` ejecuta directamente el servidor, sin migraciones ni instalación. Esto no certifica el hosting ni despliega nada. Configurar JWT_SECRET propio y las integraciones necesarias mediante gestión segura del entorno; consultar backend/.env.example sin copiar secretos a logs.

Google requiere el Client ID correspondiente tanto en backend como al compilar frontend (VITE_GOOGLE_CLIENT_ID). SMTP y Drive son integraciones separadas; esta política de arranque no verifica proveedores ni convierte las APIs de negocio en solo lectura.

## Sin bootstrap automático

`npm run setup --prefix backend` está bloqueado y termina con código 1 sin conectar a DB. El código histórico de demo/seed permanece como referencia, no se ejecuta. SETUP_DEMO_DATA=true se rechaza durante el arranque ordinario incluso en desarrollo.

No recomendar seed:usuarios como alta de Render2, ni crear cuentas de líderes compartidas o contraseñas iniciales comunes. Los scripts explícitos históricos de seed/import/backfill no están certificados por este bloque. Altas, vínculos reales y recuperación de cuentas requieren procedimientos autorizados por separado; ver [recuperación de administrador existente](RECUPERACION_ADMIN.md).

## Jobs y workers: autorización separada

RENDER_BACKGROUND_JOBS es una lista explícita sin duplicados de editorial,trash,wilson,supervisor; por defecto está vacía. Los flags antiguos de cada servicio no bastan. Los jobs seleccionados requieren RENDER_ALLOW_BACKGROUND_WRITES=true, destino no productivo loopback e identidad real verificada. Producción queda bloqueada para habilitación de jobs en este bloque.

Sin opt-in no se registra scheduler ni primer tick. Las unidades externas ops/openclaw/mia-render-os-events.timer y scripts/systemd/render-visit-material.timer son independientes y llaman workers con --send: no habilitarlas para QA ni asumir que arrancar npm las controla.

## Desarrollo y QA

```sh
npm run dev:backend
npm run dev:frontend
```

Desarrollo respeta las mismas restricciones de arranque; no prepara DB automáticamente. Las fixtures nuevas y descartables tienen su autorización y guardas propias: [pruebas locales](render-2/LOCAL_TESTING.md). No usar una URL loopback o un nombre de base como autorización suficiente.

El preview-client-goals y los opt-ins antiguos de integración de objetivos quedan bloqueados antes de conectar; su código/assertions son referencia histórica. No afirmar que esa QA fue migrada exitosamente. No iniciar servidores ordinarios, ejecutar fixtures, migraciones ni workers sin autorización específica.
