# Preferencias de vistas por usuario

## Función integrada

Tareas, Calendario, Producciones, Proyectos, Clientes y Reportes pueden recuperar la última vista y sus filtros al volver mediante la navegación interna de la barra lateral. Las preferencias se separan por ID estable de usuario y ruta. No contienen tareas, producciones, aprobaciones ni finanzas; el backend continúa como fuente de los datos operativos.

El defecto anterior era transversal: las páginas leían su selección desde la URL, pero el Sidebar volvía a un enlace vacío. Atrás podía conservar el contexto por historial; salir y reentrar por Sidebar no equivalía a recuperar esa vista.

## Contrato de almacenamiento

rememberedViews.js mantiene un esquema cerrado de parámetros visuales. Guarda JSON de versión1 bajo render:view:v1:<usuarioId>:<ruta>, con límite4KB e IDs int32. Admite vistas/estados conocidos, filtros por ID, mes y día gregorianos; excluye búsquedas libres, nombres, credenciales, paginación y recursos seleccionados como task, visita, proyecto o borrador. Los valores desconocidos no se convierten en contenido libre persistido.

Una URL explícita con query o hash siempre prevalece. La lectura recordada solo transforma un destino canónico vacío de las seis rutas soportadas. Storage bloqueado, registro corrupto o versión desconocida mantienen el enlace original; no impiden trabajar ni cerrar sesión. No se importan automáticamente las preferencias de la previsualización.

Clientes guarda solo período mensual y el ID del filtro Elegir cliente; no una pieza ni un detalle de operación. Cualquier query gestion se excluye del guardado y no sobrescribe la preferencia operativa anterior. El enlace administrativo explícito sigue teniendo prioridad. Reportes guarda únicamente mes_actual, mes_pasado o ultimos_30, no fechas calculadas, personas desplegadas, filas o importes. La elección por ID sigue sujeta a los datos autorizados que devuelva el backend.

Estas preferencias pertenecen a ese navegador y origen, no se sincronizan entre dispositivos. No confieren acceso a los IDs filtrados: cada petición conserva sus permisos de servidor.

## Ciclo de sesión y navegación

rememberedViewOwner.js captura la sesión verificada y comprueba su vigencia antes de leer o guardar. Su limpieza retira listeners y vuelve inertes callbacks retenidos. La prueba A/B/A usa observaciones cookie reales del kernel: volver al mismo ID con otra observación no reactiva al owner anterior; el owner nuevo puede recuperar las preferencias propias ya guardadas.

App instala el owner solo autenticado. La salida controlada por Sidebar resuelve el destino recordado antes del consentimiento, conservando las comprobaciones existentes de snapshot, ruta y lifetime. Logout comprueba el snapshot actual y guarda preferencias antes de retirar identidad; un callback anterior no actúa sobre otra cuenta.

Se guarda también al ocultar la pestaña, pagehide, beforeunload y before-navigation. Para popstate se programa una tarea posterior con setTimeout0, comprobando otra vez la sesión al ejecutar: los consumidores pueden terminar su restauración o rollback síncrono antes de leer la URL definitiva. Una microtarea no bastaba para separar todos los callbacks nativos. Se mantiene un solo timer ante varios Atrás y se cancela al retirar el owner. Las pruebas de esta ordenación usan reloj controlado, no un evento nativo del navegador.

Los writers de las seis vistas emiten además render:view-preference-change después de actualizar correctamente su URL. Esto incluye la aplicación diferida al cerrar el detalle de Objetivos y la normalización del período de Reportes. Conserva la selección final antes de un Atrás posterior, incluso sin ocultar ni recargar la pestaña. No se envuelve history, no se agregan entradas ni se despacha otro popstate. Guardar preferencias durante una navegación que luego se cancela no confirma ni ejecuta esa navegación.

## Archivos y coordinación

Erdos implementó el helper de preferencias y sus pruebas; luego conectó los writers reales de task-view-state/WorkspaceReadOnly, Calendar, Productions y Projects al evento compartido. El coordinador integró el owner por sesión, App, logout y las pruebas de lifecycle. Volta identificó el hueco de Atrás después de replaceState y revisó el contrato corregido sin hallazgos adicionales accionables.

Los nuevos módulos están en frontend/src/shared/navigation: rememberedViews, rememberedViewOwner y viewPreferenceEvent, con sus tests. viewPreferenceWriters.test.js ejecuta los writers de producción y comprueba que notifican después del cambio de URL, sin duplicar navegación. Los fixtures de extracción existentes reciben el helper real en lugar de reducir sus aserciones.

## Verificación vigente

Corte199: frontend2560 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-ChZ6GzXw.js y diff-check correctos. Logs /private/tmp/render2-goal199-frontend.log, /private/tmp/render2-goal199-backend.log y /private/tmp/render2-goal199-build.log.

Las11 pruebas adicionales comprueban aislamiento de las dos rutas nuevas, gestión administrativa explícita sin sobrescritura, exclusión de piezas/borradores/personas/importes y orden de escritores reales de Clientes/Reportes. El reloj controlado cubre contexto diferido, retirada de sesión, cancelación y coalescencia de timers. Las consultas y permisos de Reportes y Clientes no cambiaron.

Erdos conectó y probó los escritores de ClientesObjetivos y Reportes; el coordinador amplió las allowlists y el owner; Volta detectó el límite de microtareas y revisó la tarea separada final. El filtro cliente por ID se conserva como preferencia operativa equivalente al de las otras vistas, sin restaurar piezas ni conceder autoridad. No se iniciaron servicios ni se escribieron datos PostgreSQL en199.

## Verificación inicial

Regresión final frontend2549 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-BxclXGcr.js y diff-check correctos. Logs /private/tmp/render2-goal198-frontend-final.log, /private/tmp/render2-goal198-backend-final.log y /private/tmp/render2-goal198-build-final.log.

Las29 pruebas nuevas cubren allowlists, IDs, fechas, tamaño, datos excluidos, separación de cuentas, URLs explícitas, storage denegado, callbacks retirados, lifecycle, guardado previo a logout y notificación después de los writers. El caso de Atrás cambia la URL del fixture después de la notificación y comprueba la lectura de la selección anterior. Es evidencia de kernels, callbacks y writers reales con navegador simulado, no navegación nativa montada.

La primera corrida focal necesitó completar los campos públicos del DTO de sesión sintético y conservar el orden de hooks de App esperado por las pruebas de foco. La primera regresión backend detectó dos fixtures de extracción sin la nueva dependencia de notificación; se inyectó el helper real y la suite completa final pasó. No hubo fallos de permisos relajados ni migraciones para conseguir el resultado.

## Pendientes y límites

Falta el recorrido nativo A configura → sale/vuelve → B no hereda → A recupera, incluida la navegación Atrás real. La pestaña con diálogo bloqueado del corte197 no se operó nuevamente en este corte. No se iniciaron servicios ni fixtures PostgreSQL para estas preferencias.

La recuperación está integrada en Sidebar para las seis secciones indicadas. Enlaces genéricos de Inicio, clics modificados que abren otra pestaña y las demás áreas conservan su comportamiento explícito. Las subvariables administrativas y los módulos restantes todavía necesitan su integración correspondiente. No se declara completo el requisito global de vistas guardadas. Sin push, despliegue ni cambios en datos reales.
