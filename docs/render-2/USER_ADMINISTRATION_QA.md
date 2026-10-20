# Administración de usuarios y conservación del historial

La administración canónica usa las identidades del servidor y conserva las cuentas al retirarles el acceso. Esta integración es local; no modifica bases configuradas, cuentas reales, credenciales existentes ni proveedores de correo.

## Responsabilidades

Carson integra la pantalla `frontend/src/pages/Empleados.jsx` y sus pruebas de sesión. Hypatia verifica los contratos y prepara las pruebas HTTP con PostgreSQL temporal. Beauvoir revisa los cambios de forma independiente. El coordinador integra el validador del alta, las rutas del servidor, las comprobaciones y esta documentación. `App.jsx`, la configuración de Vite y las referencias locales existentes quedan fuera de este cambio.

## Contratos de la API

`POST /api/usuarios` requiere administrador. Acepta únicamente `usuario`, `nombre`, `rol`, `password` y `email_notificaciones`. Valida tipos, nombres no vacíos, límites y caracteres de control. Conserva el normalizador existente de categorías laborales; una categoría personalizada no recibe permisos administrativos por parecerse al nombre de una persona.

Las contraseñas de cuentas nuevas requieren al menos 12 puntos de código Unicode y como máximo 72 bytes UTF-8, para impedir truncamiento silencioso en bcrypt. No se recortan espacios de la contraseña. Esta política no cambia contraseñas históricas ni el contrato de cambio de contraseña del perfil. La respuesta incluye el ID y el estado de acceso, nunca el hash ni la contraseña.

`PATCH /api/usuarios/:id/acceso` permite desactivar o reactivar y revoca las sesiones anteriores al incrementar su versión. La desactivación propia y la pérdida del último administrador activo siguen bloqueadas. Reactivar no vuelve a habilitar tokens emitidos antes de la desactivación.

`DELETE /api/usuarios/:id` ya no borra filas. Tras la autorización administrativa, responde 409 con `USER_DELETION_DISABLED` para un ID válido y 400 para un ID inválido. Los clientes antiguos deben utilizar la desactivación explícita. Esta decisión evita las cascadas sobre listas personales y otros datos asociados; no modifica las claves foráneas ni purga registros existentes.

El catálogo de usuarios activos continúa disponible para las asignaciones operativas. Los empleados reciben únicamente ID, nombre, usuario, rol, actividad, foto y fecha de creación, no los contactos administrativos. La pantalla de administración sigue reservada a administradores; el perfil propio es una sección separada.

## Autoridad dentro de la transacción

Las seis escrituras administrativas de cuentas revalidan la identidad dentro de la misma transacción que modifica PostgreSQL: alta, actividad, identidad y rol, correo de avisos, acceso Google y vínculo WhatsApp. `withUserAdministration` exige el ID y la versión de sesión observados por el middleware verificado; no admite llamadas sin actor ni deduce permisos por nombre.

La transacción utiliza READ COMMITTED. Primero adquiere el mutex administrativo, después lee al actor con `FOR SHARE` y comprueba su actividad, versión y rol actual. Finalmente modifica el objetivo y confirma. El bloqueo del actor dura hasta el commit. `administerUser` conserva, dentro de esa transacción, el bloqueo del objetivo y la protección del último administrador.

Si la revocación se confirma antes de leer al actor, la operación responde 401 `USER_ADMIN_SESSION_REVOKED` sin modificar cuentas ni historial. Un cambio de rol vigente responde 403 `USER_ADMIN_ROLE_CHANGED`. Si una escritura válida ya retiene la fila del actor, la revocación espera hasta su commit: la escritura queda ordenada antes de la revocación. Esto evita que una autorización leída antes de una espera siga habilitando una escritura posterior a la revocación confirmada.

Esta garantía corresponde a las seis escrituras DB indicadas. No abarca todos los escritores de la aplicación ni hace transaccional el envío SMTP. No requiere migraciones ni cambios de esquema.

## Instrucciones de acceso

La invitación distingue el destino de notificaciones de las credenciales de acceso. Sin Google explícito, indica el `usuario` real; con Google, conserva únicamente la cuenta vinculada explícitamente. El HTML escapa el nombre de acceso y no incorpora contraseñas, hashes ni secretos SMTP. Si faltan tanto el usuario como Google, no genera instrucciones falsas a partir del correo de avisos. El transporte, los remitentes y la configuración SMTP permanecen iguales.

## Pantalla conectada

Las lecturas y escrituras mantienen la sesión auténtica y el contexto observado mediante `useScopedRequest`. Las respuestas tardías de otra sesión o de un editor anterior no deben actualizar el editor actual. Un bloqueo compartido evita acciones dobles mientras se espera; las respuestas parciales se combinan con la fila conocida sin perder su estado de actividad.

La baja habitual utiliza `/acceso`, no DELETE. Las respuestas de guardado se validan antes de confirmarlas. Un fallo al refrescar la lista después de un guardado confirmado no se presenta como fallo del guardado ni dispara un reintento automático. Los formularios protegen el cierre y el cambio de cuenta seleccionada cuando hay cambios sin guardar. Esto no equivale a una garantía global de borradores al cerrar el navegador.

El alta no sugiere contraseñas basadas en nombres. El botón de generación utiliza `crypto.getRandomValues` y falla explícitamente si no está disponible; no utiliza `Math.random`. Las contraseñas nuevas permanecen ocultas en el campo y no se guardan en preferencias del navegador.

## Verificación

Las corridas finales, con los cambios congelados, aprobaron:

- Frontend: `node --test` desde `frontend`, 1073 pruebas. Incluye pruebas de referencia que no equivalen a módulos conectados.
- Backend: `npm test` desde `backend`, 1400 pruebas aprobadas y 64 omitidas por su activación explícita.
- HTTP y PostgreSQL: `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-user-administration.integration.test.js`, 12 pruebas aprobadas.
- Compilación: `npm run build` desde `frontend`; revisión de espacios con `git diff --check`, ambas correctas.

La prueba física utiliza exclusivamente el arnés `backend/scripts/render2-local-test.js`, una base nueva en loopback y datos sintéticos. Cubre el catálogo sin contactos privados, las mutaciones administrativas denegadas a empleados y anónimos, el alta validada, las sesiones revocadas, la reactivación sin rehabilitar tokens antiguos, el último administrador y el bloqueo de borrado incluso con hijos CASCADE. El cierre comprueba que su directorio temporal fue eliminado. La ausencia de configuración SMTP impide enviar invitaciones reales; denegar `fetch` por sí solo no sería una protección suficiente para SMTP.

Las 11 pruebas nuevas de interfaz ejecutan los callbacks reales con primitivas React inyectadas y el control compartido de sesión. No son un montaje React completo. Cubren respuestas tardías, cambio de identidad o contexto, doble envío, respuestas parciales, errores de refresco, generación criptográfica, descarte y baja mediante PATCH.

En el navegador real, Franco QA abrió Usuarios y equipo, cambió únicamente el nombre visible de una cuenta sintética y recargó. El nombre persistió; el usuario de acceso y el rol quedaron intactos. El panel y el alta se revisaron a 390 por 844, sin desbordamiento horizontal del documento. No se creó ninguna cuenta ni se introdujeron credenciales nuevas mediante la interfaz, ni se enviaron invitaciones. La baja, reactivación y protección del último administrador se verificaron por HTTP, no se cuentan como recorridos de navegador. El arnés visual `/private/tmp/render2-local-8VC7BT` fue detenido y eliminado; la pestaña temporal se cerró y se restableció el viewport.

Registros de comprobación:

- `/private/tmp/render2-users84-frontend-final.log`
- `/private/tmp/render2-users84-backend-final.log`
- `/private/tmp/render2-users84-http-final.log`
- `/private/tmp/render2-users84-build-final.log`
- `/private/tmp/render2-users84-name-desktop.png`
- `/private/tmp/render2-users84-reloaded-mobile.png`

### Verificación de autoridad y concurrencia

La integración de autoridad aprobó 42 pruebas físicas con el comando siguiente desde `backend`:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-user-authority.integration.test.js test/render2-user-administration.integration.test.js test/render2-phase1.integration.test.js
```

La suite nueva comprueba 24 combinaciones: seis escritores frente a versión revocada, actor inactivo, rol rebajado o actor inexistente mientras la solicitud ya autenticada espera el mutex. La espera se demuestra con `pg_locks` y `pg_blocking_pids`; las pausas sólo regulan el sondeo y no constituyen la evidencia. Tras cada rechazo, snapshots de cuentas, tareas, asignaciones, comentarios, listas y bloques permanecen intactos respecto del momento posterior a la revocación.

Otros casos verifican la autoedición sin interbloqueos, el orden inverso donde la revocación espera al escritor válido y dos autodegradaciones encoladas: una responde 200, otra 409 y queda exactamente un administrador activo. Los cambios directos de rol, actividad o borrado utilizados para forzar las carreras pertenecen exclusivamente a cuentas sintéticas de la base temporal.

La corrida final general aprobó 1408 pruebas backend, con 65 pruebas de activación explícita omitidas; frontend aprobó 1073. Compilación y `git diff --check` correctos. Las pruebas focalizadas de autorización e invitación sumaron 22 aprobadas, con transporte de correo falso. Los arneses y las conexiones dedicadas se cerraron; la suite nueva comprueba la eliminación de su directorio generado. No se efectuó un nuevo recorrido de navegador: no hubo cambios de interfaz en esta integración.

Registros: `/private/tmp/render2-users85-http-final.log`, `/private/tmp/render2-users85-backend-final.log`, `/private/tmp/render2-users85-frontend-final.log`, `/private/tmp/render2-users85-build-final.log` y `/private/tmp/render2-users85-targeted-final.log`.

## Riesgos y siguientes pasos

- La revalidación transaccional está implementada y probada para las seis escrituras de cuentas, no para todos los módulos. El envío externo de invitaciones permanece fuera de la garantía transaccional y requiere un contrato de aceptación, autorización y entrega adecuado a ese efecto externo.
- Las ediciones concurrentes del mismo usuario todavía no tienen una revisión persistente comparable al control de versiones de contratos financieros. El aislamiento de la interfaz no sustituye ese control del servidor.
- Los PATCH de contactos todavía convierten algunos valores ausentes o mal tipados en desvinculaciones. Necesitan contratos de entrada cerrados y pruebas negativas para evitar borrados accidentales de contactos por solicitudes mal formadas.
- El cambio de contraseña del perfil necesita adoptar una política coherente, sin rotaciones automáticas de credenciales existentes.
- La activación general de sesiones por cookie, la aceptación en dispositivos reales, el proxy y los proveedores externos conservan sus propias condiciones de despliegue. No se habilitan en esta integración.

El bloqueo de borrado físico y las pruebas locales no constituyen un despliegue ni certifican la finalización de Render 2.0.
