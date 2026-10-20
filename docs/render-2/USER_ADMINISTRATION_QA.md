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

## Riesgos y siguientes pasos

- La autorización inicial del actor todavía necesita revalidación transaccional en los escritores administrativos que esperan bloqueos. No se declara resuelta la ventana entre autenticación y escritura.
- Las ediciones concurrentes del mismo usuario todavía no tienen una revisión persistente comparable al control de versiones de contratos financieros. El aislamiento de la interfaz no sustituye ese control del servidor.
- Las instrucciones de invitación sin Google todavía mencionan el correo de notificaciones como acceso. Debe corregirse el contenido y probarse con un transporte simulado, sin enviar correo real.
- El cambio de contraseña del perfil necesita adoptar una política coherente, sin rotaciones automáticas de credenciales existentes.
- La activación general de sesiones por cookie, la aceptación en dispositivos reales, el proxy y los proveedores externos conservan sus propias condiciones de despliegue. No se habilitan en esta integración.

El bloqueo de borrado físico y las pruebas locales no constituyen un despliegue ni certifican la finalización de Render 2.0.
