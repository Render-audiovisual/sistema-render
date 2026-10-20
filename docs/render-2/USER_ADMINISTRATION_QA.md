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

## Ediciones concurrentes y contactos

La migración local `074_user_administration_versions.sql` incorpora `usuarios.user_admin_version`, entero positivo inicialmente igual a 1. Un trigger BEFORE UPDATE lo incrementa incluso ante actualizaciones SQL sin cambios o secuencias que restauran valores anteriores. La versión no sustituye la identidad, el rol ni `session_version`: es una observación del registro, no una autorización.

El catálogo administrativo, el alta y las respuestas de las cinco PATCH incluyen `admin_revision`, con formato `ua1:ID:versión`. El catálogo operativo de empleados no la expone. Cada PATCH exige `expected_revision` de la cuenta abierta; la comparación ocurre bajo el bloqueo del objetivo, después de revalidar al actor. Devuelve 428 si falta, 400 si es inválida y 409 `USER_ADMIN_REVISION_CONFLICT` si pertenece a otra cuenta o quedó atrasada. La respuesta confirmada contiene la versión posterior al trigger.

| Operación | Campos de negocio exigidos además de la revisión |
| --- | --- |
| Acceso | `activo`, booleano |
| Identidad | `nombre`, `usuario`, `rol`, textos validados |
| Avisos | `email_notificaciones`, texto válido o desvinculación explícita |
| Google | `google_email`, texto válido o desvinculación explícita |
| WhatsApp | `whatsapp`, texto telefónico válido o desvinculación explícita |

Los cuerpos son cerrados: omitir un contacto, enviar un objeto, un arreglo, un booleano, un número o campos adicionales no lo desvincula. La eliminación de un contacto exige un texto vacío tras recortar espacios o `null` explícito. WhatsApp admite el formato internacional y separadores telefónicos, no letras ni un número fuera de 10 a 15 dígitos.

Cada editor retiene su observación original. Un conflicto o resultado ambiguo conserva el borrador y bloquea nuevas escrituras del mismo usuario. La recuperación tiene dos pasos dentro del panel: “Conservar borrador” no lee ni escribe; “Descartar y recargar” carga la versión guardada de ese mismo usuario con la sesión y el contexto originales. No hay recarga ni reintento automáticos. La confirmación aparece sólo durante la recuperación, sin un aviso permanente en cada cuenta. Una respuesta de guardado debe avanzar exactamente una versión para aceptarse.

Los errores conocidos del parser JSON y del límite de tamaño devuelven mensajes constantes antes del log genérico, sin registrar el cuerpo presentado. Esta corrección no certifica la redacción de todos los demás logs del sistema.

## Verificación

Las corridas iniciales de la pantalla conectada, con los cambios congelados, aprobaron:

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

### Verificación de versiones y recuperación

La integración de versiones aprobó 107 pruebas físicas de ocho suites: `render2-user-revisions`, `render2-user-administration`, `render2-user-authority`, `render2-phase1`, `render2-login-identity`, `render2-personal-home`, `render2-assignments` y `render2-projects`, todas con sufijo `.integration.test.js`. Se ejecutaron secuencialmente desde `backend` con `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1` y esos ocho archivos.

La suite nueva difiere únicamente la migración real 074 dentro del arnés generado. Carga usuarios, asignaciones, comentarios y listas anteriores; aplica el SQL real y registra su ejecución. Compara cada fila de usuario sin la nueva columna y el historial operativo: permanecen idénticos. No altera columnas o constraints para simular un resultado. Prueba también dos escritores encolados con una sola observación —un ganador y un conflicto—, ABA y no-op SQL, fotos y épocas de sesión que invalidan una observación, entradas mal formadas sin efectos y desvinculaciones explícitas válidas. Las suites anteriores conservan sus barreras y negativas de autorización; ahora envían observaciones explícitas donde corresponde.

El canario sintético `QA86_PRIVATE_BODY_CANARY` en JSON escalar o malformado obtiene 400 sin eco y no aparece en el log final de la corrida física. La corrida general backend aprobó 1418 pruebas y omitió 66 de activación explícita; frontend aprobó 1082. Los 22 casos focalizados de contratos, parser y esquema también aprobaron. Compilación y revisión de espacios correctas. Las pruebas de callbacks de React no equivalen a un montaje completo.

El navegador real confirmó el conflicto entre Franco QA y una escritura HTTP autenticada como Agustín QA: el borrador anterior siguió visible y no sobrescribió la versión nueva. A 390 por 844 se comprobó cancelar la recuperación, confirmar la carga de la versión guardada, volver a editar sólo el nombre visible y recargar manteniendo el guardado final. El usuario de acceso y el rol no cambiaron. El ancho del documento fue de 390 px. La primera variante de recuperación mediante confirmación nativa no pudo completarse con el control del navegador; fue reemplazada por la confirmación integrada y el recorrido completo se repitió sobre una compilación y un arnés nuevos.

Los arneses visuales `/private/tmp/render2-local-94cw2I` y `/private/tmp/render2-local-aDJm0B` fueron detenidos y eliminados. Las pestañas temporales se cerraron y el viewport volvió a su configuración original. No se usaron cuentas, correos ni bases reales. Registros finales:

- `/private/tmp/render2-users86-http-final.log`
- `/private/tmp/render2-users86-backend-final.log`
- `/private/tmp/render2-users86-frontend-final.log`
- `/private/tmp/render2-users86-targeted-final.log`
- `/private/tmp/render2-users86-build-final.log`
- `/private/tmp/render2-users86-conflict-desktop.png`
- `/private/tmp/render2-users86-reloaded-mobile.png`

## Riesgos y siguientes pasos

- La revalidación transaccional está implementada y probada para las seis escrituras de cuentas, no para todos los módulos. El envío externo de invitaciones permanece fuera de la garantía transaccional y requiere un contrato de aceptación, autorización y entrega adecuado a ese efecto externo.
- El cambio de contrato requiere aplicar 074 mediante el procedimiento autorizado y actualizar backend e interfaz de forma coordinada. Un cliente antiguo sin revisión no puede escribir: recibe 428. La comprobación de arranque exige la columna; no intenta repararla ni migrarla implícitamente. 074 sólo fue aplicada a arneses temporales, no a una base configurada.
- Las observaciones son enteros acotados; agotar el contador falla sin reiniciarlo. No deben restablecerse versiones ni reutilizarse IDs mediante SQL externo. Los resultados inciertos por pérdida de respuesta aún necesitan comprobantes durables en los módulos que carecen de ellos; la interfaz conserva el borrador, no prueba por sí sola si el commit ocurrió.
- El cambio de contraseña del perfil necesita adoptar una política coherente, sin rotaciones automáticas de credenciales existentes.
- La activación general de sesiones por cookie, la aceptación en dispositivos reales, el proxy y los proveedores externos conservan sus propias condiciones de despliegue. No se habilitan en esta integración.

El bloqueo de borrado físico y las pruebas locales no constituyen un despliegue ni certifican la finalización de Render 2.0.
