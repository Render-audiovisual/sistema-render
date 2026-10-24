# Preferencias de vistas por usuario

## Función integrada

Tareas, Calendario, Producciones, Proyectos, Clientes, Reportes, Historias, Publicaciones y Feedback pueden recuperar la última vista y sus filtros admitidos al volver mediante la navegación interna de la barra lateral. Desde205 también lo hacen los accesos genéricos de Inicio a destinos admitidos. Las preferencias se separan por ID estable de usuario y ruta. No contienen tareas, producciones, aprobaciones ni finanzas; el backend continúa como fuente de los datos operativos.

El defecto anterior era transversal: las páginas leían su selección desde la URL, pero el Sidebar volvía a un enlace vacío. Atrás podía conservar el contexto por historial; salir y reentrar por Sidebar no equivalía a recuperar esa vista.

## Contrato de almacenamiento

rememberedViews.js mantiene un esquema cerrado de parámetros visuales. Guarda JSON de versión1 bajo render:view:v1:<usuarioId>:<ruta>, con límite4KB e IDs int32. Admite vistas/estados conocidos, filtros por ID, mes y día gregorianos; excluye búsquedas libres, nombres, credenciales, paginación y recursos seleccionados como task, visita, proyecto o borrador. Los valores desconocidos no se convierten en contenido libre persistido.

Una URL explícita con query o hash siempre prevalece. La lectura recordada solo transforma un destino canónico vacío de las nueve rutas soportadas. Storage bloqueado, registro corrupto o versión desconocida mantienen el enlace original; no impiden trabajar ni cerrar sesión. No se importan automáticamente las preferencias de la previsualización.

Clientes guarda solo período mensual y el ID del filtro Elegir cliente; no una pieza ni un detalle de operación. Cualquier query gestion se excluye del guardado y no sobrescribe la preferencia operativa anterior. El enlace administrativo explícito sigue teniendo prioridad. Reportes guarda únicamente mes_actual, mes_pasado o ultimos_30, no fechas calculadas, personas desplegadas, filas o importes. La elección por ID sigue sujeta a los datos autorizados que devuelva el backend.

Estas preferencias pertenecen a ese navegador y origen, no se sincronizan entre dispositivos. No confieren acceso a los IDs filtrados: cada petición conserva sus permisos de servidor.

## Ciclo de sesión y navegación

rememberedViewOwner.js captura la sesión verificada y comprueba su vigencia antes de leer o guardar. Su limpieza retira listeners y vuelve inertes callbacks retenidos. La prueba A/B/A usa observaciones cookie reales del kernel: volver al mismo ID con otra observación no reactiva al owner anterior; el owner nuevo puede recuperar las preferencias propias ya guardadas.

App instala el owner solo autenticado. La salida controlada por Sidebar resuelve el destino recordado antes del consentimiento, conservando las comprobaciones existentes de snapshot, ruta y lifetime. Logout comprueba el snapshot actual y guarda preferencias antes de retirar identidad; un callback anterior no actúa sobre otra cuenta.

Se guarda también al ocultar la pestaña, pagehide, beforeunload y before-navigation. Para popstate se programa una tarea posterior con setTimeout0, comprobando otra vez la sesión al ejecutar: los consumidores pueden terminar su restauración o rollback síncrono antes de leer la URL definitiva. Una microtarea no bastaba para separar todos los callbacks nativos. Se mantiene un solo timer ante varios Atrás y se cancela al retirar el owner. Las pruebas de esta ordenación usan reloj controlado, no un evento nativo del navegador.

Los writers de las nueve vistas emiten además render:view-preference-change después de actualizar correctamente su URL. Esto incluye la aplicación diferida al cerrar el detalle de Objetivos y la normalización del período de Reportes. Conserva la selección final antes de un Atrás posterior, incluso sin ocultar ni recargar la pestaña. No se envuelve history, no se agregan entradas ni se despacha otro popstate. Guardar preferencias durante una navegación que luego se cancela no confirma ni ejecuta esa navegación.

## Archivos y coordinación

Erdos implementó el helper de preferencias y sus pruebas; luego conectó los writers reales de task-view-state/WorkspaceReadOnly, Calendar, Productions y Projects al evento compartido. El coordinador integró el owner por sesión, App, logout y las pruebas de lifecycle. Volta identificó el hueco de Atrás después de replaceState y revisó el contrato corregido sin hallazgos adicionales accionables.

Los nuevos módulos están en frontend/src/shared/navigation: rememberedViews, rememberedViewOwner y viewPreferenceEvent, con sus tests. viewPreferenceWriters.test.js ejecuta los writers de producción y comprueba que notifican después del cambio de URL, sin duplicar navegación. Los fixtures de extracción existentes reciben el helper real en lugar de reducir sus aserciones.

## Verificación vigente

Corte200: frontend2572 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-bKWi8tD_.js y diff-check correctos. Logs /private/tmp/render2-goal200-frontend.log, /private/tmp/render2-goal200-backend.log y /private/tmp/render2-goal200-build.log.

Historias recuerda vista, mes, cliente y filtro de Planilla por ID. El cliente también conserva el destino manual predeterminado de Nueva historia, comportamiento existente; no se abre ni se envía una historia automáticamente. Publicaciones recuerda pestaña, mes, cliente y los filtros separados de calendario y seguimiento por IDs/enums. seg_responsable queda excluido porque todavía utiliza nombres históricos, sin convertirlos heurísticamente a identidades. Volver a Preparar monta su compositor vacío como parte de esa pestaña, no un borrador anterior.

Feedback recuerda sección, categoría y papelera. Excluye búsqueda, nota abierta, contenido, límite, offset y expected_snapshot: reentra desde página cero con evidencia de lectura nueva. Sus preferencias se contrastan con readFeedbackNotesLocation; las de Publicaciones se contrastan con los parsers reales de calendario y seguimiento.

Las12 pruebas nuevas cubren aislamiento por ruta/usuario, exclusiones de texto/nombres/recursos, acuerdo con esos parsers y notificaciones posteriores a los writers. Erdos implementó wrappers editoriales locales y avisos de Feedback, sin ampliar el helper global url-context; el coordinador amplió las allowlists y verificó las suites; Volta revisó contrato y delta sin hallazgos adicionales. No hubo servicios, migraciones ni escrituras PostgreSQL en200. Esta cobertura sigue siendo automatizada con kernels y callbacks, no recorrido nativo.

## Verificación de Clientes y Reportes

Corte199: frontend2560 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-ChZ6GzXw.js y diff-check correctos. Logs /private/tmp/render2-goal199-frontend.log, /private/tmp/render2-goal199-backend.log y /private/tmp/render2-goal199-build.log.

Las11 pruebas adicionales comprueban aislamiento de las dos rutas nuevas, gestión administrativa explícita sin sobrescritura, exclusión de piezas/borradores/personas/importes y orden de escritores reales de Clientes/Reportes. El reloj controlado cubre contexto diferido, retirada de sesión, cancelación y coalescencia de timers. Las consultas y permisos de Reportes y Clientes no cambiaron.

Erdos conectó y probó los escritores de ClientesObjetivos y Reportes; el coordinador amplió las allowlists y el owner; Volta detectó el límite de microtareas y revisó la tarea separada final. El filtro cliente por ID se conserva como preferencia operativa equivalente al de las otras vistas, sin restaurar piezas ni conceder autoridad. No se iniciaron servicios ni se escribieron datos PostgreSQL en199.

## Verificación inicial

Regresión final frontend2549 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-BxclXGcr.js y diff-check correctos. Logs /private/tmp/render2-goal198-frontend-final.log, /private/tmp/render2-goal198-backend-final.log y /private/tmp/render2-goal198-build-final.log.

Las29 pruebas nuevas cubren allowlists, IDs, fechas, tamaño, datos excluidos, separación de cuentas, URLs explícitas, storage denegado, callbacks retirados, lifecycle, guardado previo a logout y notificación después de los writers. El caso de Atrás cambia la URL del fixture después de la notificación y comprueba la lectura de la selección anterior. Es evidencia de kernels, callbacks y writers reales con navegador simulado, no navegación nativa montada.

La primera corrida focal necesitó completar los campos públicos del DTO de sesión sintético y conservar el orden de hooks de App esperado por las pruebas de foco. La primera regresión backend detectó dos fixtures de extracción sin la nueva dependencia de notificación; se inyectó el helper real y la suite completa final pasó. No hubo fallos de permisos relajados ni migraciones para conseguir el resultado.

## Pendientes y límites

### Calendario poblado: A/B/A, enlace explícito, recarga y móvil — corte242

Objetivo: acreditar la memoria visual canónica por identidad real, sin convertir preferencias locales en persistencia de negocio. Supuesto de prueba: mismo navegador/origen con dos cuentas QA independientes; no dispositivos físicos. Plan y criterio: seleccionar controles reales, salir/reentrar, cambiar A/B/A, recargar y contrastar URL, selección y títulos servidos por API; después comprobar integridad y limpiar. Skills superpowers y verification orientaron contratos previos y separación entre fuente, navegador y PostgreSQL.

Erdos preparó `/private/tmp/render2-goal242-calendar-native.mjs`; coordinador inspeccionó y ejecutó, Volta revisó fuentes y límites en solo lectura sin confirmar un defecto de separación de preferencias. Su recomendación de conteos asumía las tres tareas el mismo día; el fixture definitivo distribuye fechas26/27/28 y las observaciones siguientes corresponden a esa distribución, no a dicha hipótesis.

Build canónico existente241 `index-BPLI3RjQ.js`, HTTP52838/PostgreSQL55883. Identidad exacta comprobada antes del setup. API creó tarea1 Luciano lunes26/10, tarea2 Luciano miércoles28/10, tarea3 Designer martes27/10, todas pendientes sin cliente ni colaboradores. Se esperaron las tres notificaciones privadas de creación por ID antes del baseline. No visitas ni piezas sembradas. El script mantiene el backend principal con sesión cookie, .env deshabilitado y fetch externo bloqueado en hijo; el frontend mostró control Google configurado, no se pulsó y no se acredita aislamiento externo de ese frontend.

Luciano91003 entró desde `/login` neutral. Sidebar Calendario mostró Lo mío/Todos/hoy24: celdas26/28 con1evento y27 con0. Eligió Entregas de tareas y día28: agenda mostró exclusivamente tarea2, encabezado1de1 y enlace `/workspace/tareas?task=2`. Inicio→Sidebar recuperó `mes=2026-10&dia=2026-10-28&scope=mine&tipo=tarea&pagina=0`. Cerró sesión desde el menú real: `/login` sin next.

Designer91004 entró sin corregir manualmente el login. Calendario mostró Lo mío/Todos/hoy24, no la selección de A: únicamente celda27 con1evento,26/28 con0. Eligió Equipo/Todos/día27: las tres fechas26/27/28 tuvieron1evento cada una; agenda27 mostró tarea3, no las de Luciano. Inicio→Sidebar conservó Equipo/Todos/día27. Cerró B de forma neutral y A volvió a entrar. Sidebar recuperó Lo mío/Entregas/día28 y tarea2. Recarga mantuvo esa selección y resultado.

A390×844, controles reales, día28 seleccionado y agenda con tarea2 presentes en AX; Inicio→menú móvil→Calendario restauró lo mismo y cerró menú. DOM: innerWidth390, documentElement.clientWidth390, scrollWidth390 y body.scrollWidth390. Captura `/private/tmp/render2-goal242-calendar-mobile.png` inspeccionada: filtros verticales y grilla sin corte horizontal; agenda por debajo del pliegue, no visible en esa captura. No prueba todos los tamaños, zoom, lectores ni todo menú nativo.

Enlace explícito del runner a Lo mío/Entregas/día26 ganó sobre28 y mostró tarea1. Atrás nativo recuperó28 y tarea2. Captura adicional `/private/tmp/render2-goal242-calendar-explicit-mobile.png`. No se abrieron/editaron tareas, no se inyectaron preferencias, respuestas o cookies en navegador. Un intento Playwright getByLabel no encontró el selector; se usó setValue del control AX observado, que sí actualizó selección y URL. Esto no demuestra falta de nombre accesible: AX sí mostraba Tipo.

Exact PID10524 verificado antes de SIGTERM; sesión del runner terminó0. Log `/private/tmp/render2-goal242-calendar-native.log`: `CALENDAR_DOMAIN_HASHES_UNCHANGED 105 EXACT_LOGOUT_EPOCHS A1 B1`, `FIXTURE_CLEANUP_ENOENT /private/tmp/render2-local-hxhkm5`. Snapshot de105 tablas salvo familias auth/browser_session; usuarios incluye todos los campos excepto session_version/user_admin_version, verificados separadamente con incremento1 exacto para91003/91004 y0 para otros. No prueba secuencias ni ausencia de peticiones fallidas. Pestaña propia43 cerrada y viewport restablecido.

Revisión final: recorrido descrito acreditado sin cambios de producto ni renovación de regresiones/build; no defecto nuevo encontrado. Reduce de siete a seis las rutas pendientes de A/B/A nativo: Producciones, Proyectos, Clientes, Historias, Publicaciones y Feedback. Calendario aún requiere filtro por cliente, otros tipos/miembros derivados, cambio de mes recordado, paginación poblada y más intercalados. No aceptación global ni despliegue; sin bases existentes, datos reales o proveedores autorizados.

### Accesos genéricos de Inicio integrados, corte205

QuickHome recibía el callback simple `navigate`, por lo que sus accesos bare ignoraban las preferencias aunque Sidebar sí las recuperara. App ahora entrega a QuickHome el mismo `navigateSidebar` protegido; Calendar conserva su callback anterior. No se envuelven history ni todos los anchors del documento, no cambia el parser de preferencias y no se agrega otra lógica comercial.

El destino recordado se resuelve antes del consentimiento existente y conserva snapshot, lifetime, epoch y ruta actuales. HomeLink/personalHomeNavigate no cambian: el href original permanece en el anchor y Ctrl/Cmd/Shift/Alt, clic central/secundario y eventos ya prevenidos no se interceptan. Los enlaces explícitos a Mis tareas, revisión o un recurso mantienen su contexto, sin mezclar filtros guardados. Esta prioridad no implica preservar literalmente un `?` vacío después de la normalización del navegador.

Cuatro pruebas nuevas ejecutan el callback de App cableado desde el JSX real de QuickHome con owner/reader reales: destinos bare, query/hash explícitos, callbacks/consentimientos obsoletos y semántica de clic. El router se sustituye en esas pruebas: acreditan delegación y guardas, no commit de historial ni cancelación efectiva. El protocolo de cancelación conserva sus pruebas existentes; no se reprodujo un editor sucio de Inicio en este recorrido nativo.

Regresión final: frontend2595 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build `index-CdLZjCjK.js`. Logs `/private/tmp/render2-goal205-frontend-final.log`, `/private/tmp/render2-goal205-backend.log`, `/private/tmp/render2-goal205-build.log`. La primera regresión frontend tuvo dos fallos en legacyRouteIntegration, que aún exigía el callback anterior para Home. Se actualizaron ambas aserciones al contrato nuevo, conservando Calendar sin cambios; no se retiraron pruebas. Diff-check correcto.

Navegador real, una cuenta Edición91003, origen nuevo HTTP52820/PostgreSQL55858: dos tareas sintéticas creadas por API antes del baseline. A eligió Por responsable y prioridad alta; Inicio → acceso Tareas dentro de Accesos de trabajo recuperó `?priority=alta&view=responsibles` y solo su video. Inicio → Ver todas mis tareas abrió `?view=list&responsible=id%3A91003`, prioridad Todas, sin heredar el filtro alta. Inicio → enlace del video abrió exactamente `?task=1` y su detalle; se cerró sin editar. Tras volver a configurar Por responsable/alta, el acceso genérico funcionó también a390×844; clientWidth375 y scrollWidth375, sin overflow horizontal de página en ese estado. No es aceptación nativa de todos los accesos o modificadores.

El script `/private/tmp/render2-goal205-native.mjs` comprobó identidad exacta y hashes invariantes de104 tablas completas, incluida usuarios, excluyendo solo familias auth/browser_session. No hubo logout ni excepción de contadores en esta ejecución. `DOMAIN_SNAPSHOT_UNCHANGED 104`; cleanup ENOENT de `/private/tmp/render2-local-4rTpua`, código0. Se cerró la pestaña y se restauró el viewport. Capturas reales `/private/tmp/render2-goal205-home-restored.png` y `/private/tmp/render2-goal205-home-mobile.png`; la primera inspeccionada visualmente. No hubo OAuth real ni credenciales comerciales.

Erdos implementó la conexión y pruebas, Volta revisó el alcance y advirtió sobre el router simulado, y el coordinador ejecutó regresiones/build/navegador/PostgreSQL. Sin backend modificado, push o despliegue. Las otras siete vistas siguen pendientes de A/B/A nativo y no se declara aceptación global.

### Tareas pobladas: A/B/A, historial y móvil, corte204

Se ejecutó el build203 sin modificar producto sobre un origen nuevo de QA, HTTP52819/PostgreSQL55857. El fixture verificó identidad exacta y creó mediante la API principal dos tareas sintéticas render_os: `QA204 video Luciano`, responsable91003 y prioridad alta, y `QA204 pieza Diseño`, responsable91004 y prioridad media, ambas pendientes con entrega2026-10-28. El baseline de integridad se tomó después de ese setup autorizado, no antes.

Luciano entró por login real y Sidebar → Tareas. Configuró Lista, responsable por ID91003 y prioridad alta: se mostró una sola tarea, su video. Atrás real llevó a Inicio; reentrar por Sidebar recuperó esas selecciones. Añadió estado Pendientes y búsqueda `QA204 video Luciano`; tras salir a Inicio y volver se conservaron los tres filtros y Lista, pero no `q` ni el texto de búsqueda libre.

Cerró sesión mediante el flujo neutral203. Designer91004 entró desde la URL que dejó la aplicación, sin navegación manual a login. Tareas mostró Tablero, todos los responsables/prioridades y las dos tareas: no heredó los filtros de Luciano. Eligió Por responsable, ID91004 y prioridad media; su pieza quedó como único resultado bajo su bloque. Inicio → Sidebar recuperó esa vista. Tras cerrar B y volver a A, se recuperaron Lista, Pendientes, ID91003 y prioridad alta. Recarga conservó la URL y el resultado; no se abrió ningún editor ni se cambió una tarea.

A390×844, Filtros mostró3 selecciones activas y sus controles reales. Inicio → menú móvil → Tareas recuperó Lista y la misma tarea. Medidas DOM con filtros abiertos: innerWidth390, documentElement.clientWidth375, documentElement.scrollWidth375, body.scrollWidth375; no hubo overflow horizontal de página en ese estado poblado. No certifica todos los tamaños o menús nativos del sistema operativo. Finalmente, el enlace explícito `?view=board` ganó sobre lo recordado; el writer normalizó el valor predeterminado a ruta sin query, mostrando ambas tareas y filtros generales.

Capturas útiles: `/private/tmp/render2-goal204-a-list.png`, `/private/tmp/render2-goal204-b-responsibles.png`, `/private/tmp/render2-goal204-mobile-filters.png` y `/private/tmp/render2-goal204-mobile-return.png`. Se inspeccionó visualmente la de filtros móviles. No se inyectaron preferencias ni respuestas en el navegador.

El script `/private/tmp/render2-goal204-native.mjs` comparó103 tablas completas y la proyección de usuarios sin session_version/user_admin_version. Ambos contadores aumentaron exactamente1 para91003 y91004, sin cambios para otros usuarios. Los demás hashes coincidieron: `DOMAIN_SNAPSHOT_UNCHANGED 104 EXACT_LOGOUT_EPOCHS A1 B1`. Cleanup ENOENT de `/private/tmp/render2-local-zhcV0Q`, código0. Se cerró la pestaña y se restauró el viewport.

Volta revisó parsers/writers en solo lectura y recomendó separar el orden manual y las colas de revisión de esta prueba. El coordinador ejecutó el recorrido; no se renovaron suites globales ni build, que no cambiaron desde203. Esto acredita los valores y roles descritos de Tareas, no el calendario, papelera, orden manual, todas las prioridades/estados ni las otras siete vistas recordadas. Sin producción ni despliegue.

### Cierre explícito y cambio de cuenta corregidos, corte203

La observación de202 tenía un efecto real: App trataba el cierre voluntario como cualquier retirada de sesión y generaba `login?next=<URL de A>`. Otra persona podía entrar directamente al período anterior aunque sus preferencias estuvieran correctamente separadas. No era acceso financiero ni mezcla de identidades del backend; era arrastre del contexto de navegación.

App ahora registra una intención de cierre ligada a la observación vigente antes de llamar al logout existente. `explicitLogoutNavigation.js` observa las transiciones y el gate anónimo usa `/login` neutral únicamente para la retirada correspondiente. Una observación distinta, incluso del mismo ID, cancela ese dueño; doble clic no duplica logout. `destination()` observa también de forma síncrona, cubriendo un render anterior al listener propio. Suscripciones e intentos pendientes se limpian al desmontar. No cambia utils, controlador de sesión, endpoints, Web Lock ni revocación. Un resultado unconfirmed sigue sin equivaler a revocación confirmada.

Expiración,401 y entrada directa anónima sin intención explícita conservan el retorno validado anterior. Las pruebas cubren callbacks tardíos A/B, loading/error intermedio, trabajo terminado sin retirada, rechazo, fallo síncrono, cleanup durante publicación y nueva sesión A seguida de expiración. App real se prueba por extracción de sus callbacks/gate; no se confunde ese fixture con React montado nativo.

Regresión final: frontend2591 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build `index-DVfpz-1a.js`, diff-check correcto. Logs `/private/tmp/render2-goal203-frontend-final.log`, `/private/tmp/render2-goal203-backend.log`, `/private/tmp/render2-goal203-build.log`. Las integraciones backend omitidas no se presentan como ejecutadas de nuevo.

El build se probó mediante UI real en HTTP52818/PostgreSQL55856, con cuentas sintéticas91003 y91004. A eligió Mes pasado → cierre explícito a `/login` sin query → B entró a Inicio → Sidebar recuperó su propio Últimos30días → cierre neutral → A entró a Inicio → Sidebar recuperó Mes pasado. No se retiró `next` manualmente. Las preferencias preexistían en ese mismo origen desde202; no es una prueba de primer ingreso en navegador limpio. Luego A cerró sesión, abrió directamente Reportes con `periodo=mes_actual`, recibió login con ese `next` y, tras autenticarse, volvió al período explícito. Esa última navegación es deliberada, no una mezcla de preferencias. No se reprodujo un401 durante una operación pendiente ni fallo offline en navegador; esos casos tienen evidencia automatizada del contrato.

El fixture final `/private/tmp/render2-local-ldfRwY` verificó103 tablas completas y la proyección de `usuarios` excluyendo solo `session_version` y `user_admin_version`. Para esos dos campos comprobó por separado incrementos exactos de2 para91003 y1 para91004, sin cambios para los demás IDs. El segundo contador aumenta por el trigger074 en cada UPDATE de usuario. Resultado final: `EXACT_LOGOUT_EPOCHS_VERIFIED A2 B1`, `DOMAIN_SNAPSHOT_UNCHANGED 104` y cleanup ENOENT, código0. Excluye tablas auth/browser_session que tienen efectos legítimos de autenticación; no equivale a toda la base sin escrituras.

La primera ejecución nativa limpió `/private/tmp/render2-local-v5ylUW` pero falló por comparar usuarios completos sin considerar revocación. Se descartó esa afirmación de invariancia. Un segundo fixture `/private/tmp/render2-local-A0y3gO` se retiró antes de acciones UI al detectar también el contador del trigger; su expectativa de logouts no ejecutados falló y su cleanup confirmó ENOENT. Solo la ejecución final acredita integridad bajo el contrato corregido, sin excluir la tabla completa ni relajar campos comerciales.

Erdos implementó App/helper/tests, Volta revisó carreras y el coordinador ejecutó regresión, build y recorridos. Capturas reales útiles: `/private/tmp/render2-goal203-neutral-login.png` y `/private/tmp/render2-goal203-restored-a.png`, ambas del primer recorrido funcional. La captura `/private/tmp/render2-goal203-final-a.png` salió vacía durante la repetición y se descartó como evidencia visual; el árbol accesible posterior confirmó identidad91003 y Mes pasado. Pestañas temporales cerradas; sin cambios de viewport en203. Sin OAuth real, datos comerciales, push ni despliegue. La skill de trabajo estructurado guio la separación entre contrato, revisión independiente y validación nativa.

### Recorrido nativo de Reportes, corte202

El 24 de octubre de2026 se ejecutó el build existente del corte200 contra Express y un PostgreSQL nuevo en55856, HTTP52818. El harness verificó base, usuario, dirección, puerto y directorio exactos. No se usó una base configurada. El script de esta ejecución quedó en `/private/tmp/render2-goal202-native.mjs`; no es una prueba automatizada del navegador.

Mediante controles reales de la aplicación, en una misma pestaña y origen:

1. `qa_luciano`, ID91003, inició sesión por contraseña sintética y obtuvo su inicio personal. En Reportes eligió Mes pasado: URL `periodo=mes_pasado` y control seleccionado coincidieron.
2. Salió a Inicio y reentró mediante Sidebar: recuperó Mes pasado. Usó Atrás real a Inicio y volvió por Sidebar: conservó esa selección.
3. Cerró sesión mediante su menú. La aplicación generó un login con `next` explícito al reporte anterior. Para distinguir preferencias de enlaces de retorno, esta prueba abrió deliberadamente `/login` sin `next` antes de cada cambio de cuenta; no acredita que ese retorno se neutralice automáticamente al cambiar de usuario.
4. `qa_designer`, ID91004, entró desde ese login neutral. Sidebar → Reportes mostró Este mes, sin heredar Mes pasado. Eligió Últimos30días, salió a Inicio y volvió: conservó `periodo=ultimos_30`.
5. Cerró sesión y volvió a entrar como Luciano desde login neutral. Sidebar → Reportes recuperó Mes pasado, no Últimos30días. Tras recargar, la identidad91003, URL y control seleccionado siguieron coincidiendo.
6. La navegación directa a `?periodo=mes_actual` respetó el enlace explícito por encima de la preferencia anterior. Esto es prioridad de URL, no recuperación desde Sidebar.
7. A390×844 volvió a elegir Mes pasado, salió a Inicio y reentró mediante el menú móvil. La selección se recuperó y el menú se cerró. Lectura DOM: innerWidth390, documentElement.scrollWidth375 y body.scrollWidth375; la captura no mostró contenido cortado horizontalmente en este estado vacío. No se midió clientWidth, por lo que no se certifica formalmente ausencia de todo overflow. No prueba tablas pobladas ni otros dispositivos físicos.

Capturas reales: `/private/tmp/render2-goal202-account-b.png`, `/private/tmp/render2-goal202-account-a-restored.png` y `/private/tmp/render2-goal202-report-mobile.png`. Se inspeccionó visualmente la última. No se inyectaron preferencias, cookies ni respuestas en el navegador.

Los hashes antes/después de seis tablas (`cliente_objetivo_piezas`, `clientes`, `listas_personales`, `produccion_videos`, `proyectos`, `tareas`) coincidieron. No es un snapshot de toda la base y excluye cambios esperados de autenticación. El fixture confirmó `DOMAIN_SNAPSHOT_UNCHANGED` y `FIXTURE_CLEANUP_ENOENT /private/tmp/render2-local-8El5VD`, terminando con código0. La pestaña temporal se cerró y el viewport se restauró. No se utilizó el login de Google; el build sí mostró su control configurado, por lo que esta prueba no acredita aislamiento de peticiones externas del frontend.

Queda acreditado el recorrido descrito de Reportes, no las nueve secciones. Falta ejecutar A/B/A nativo en las demás vistas, el contexto diferido de Clientes con detalle abierto y más intercalados de sesión/historial. Volta revisó el delta documental en solo lectura y pidió precisar las métricas de ancho; no validó independientemente el recorrido. No hubo cambios de producto, nuevas suites globales ni despliegue en202.

La recuperación está integrada en Sidebar para las nueve secciones indicadas y, desde205, en accesos genéricos de Inicio a destinos admitidos. Clics modificados que abren otra pestaña y las demás áreas conservan su comportamiento explícito. Los aliases /calendario-estructura y /bloc-notas no comparten automáticamente estas preferencias; solo se integran las rutas canónicas. Las subvariables administrativas, el responsable histórico de seguimiento y los módulos restantes todavía necesitan su integración correspondiente. No se declara completo el requisito global de vistas guardadas. Sin push, despliegue ni cambios en datos reales.
