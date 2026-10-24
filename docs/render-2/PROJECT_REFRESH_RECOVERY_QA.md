# Borradores de Proyectos ante errores de consulta

## Actualización232–233: conflicto estructural conectado y límites del descarte

Erdos preparó el runner temporal `/private/tmp/render2-goal232-project-native.mjs`; coordinador lo inspeccionó y ejecutó. Volta revisó los controles y el significado del estado de conflicto, sin editar producto. PostgreSQL nuevo55879, servidor52833 y sesión cookie de Franco QA; identidad exacta de base, usuario, loopback, puerto y data_directory comprobada. Sin bases existentes ni proveedores. Frontend canónico build222 `index-9wJXgZmG.js`, sin cambios de producto o build en estos cortes.

La API creó un cliente, un proyecto web y una etapa, dejando revisión2. Franco abrió Editar etapa y escribió `QA232 borrador local`. La señal única de QA hizo que Agustín91002 cambiara por API el título de la misma etapa a `QA232 cambio remoto`, revisión3. Actualizar mostró el título remoto y conservó el borrador y Base observada2/Proyecto visible3. Guardar cambios mostró la advertencia de conflicto y el control Actualizar proyecto y revisar, con guardado deshabilitado. Para stage-edit ese control corresponde al flag activado por error.status409 en el handler; es inferencia apoyada en fuente, no captura directa del HTTP409. El botón deshabilitado por sí solo no prueba ese status.

Captura móvil390×844 inspeccionada: `/private/tmp/render2-goal232-project-conflict-mobile.png`. Muestra borrador, revisiones y aviso legibles; no se midió overflow ni se certifican todos los dispositivos. Cancelar abrió el confirm nativo de cambios sin guardar. La herramienta no logró resolverlo de forma fiable: no se acredita ni aceptar ni rechazar el descarte en navegador, ni recarga posterior. No se modificó la aplicación para eludir esa limitación.

SQL antes de la señal comprobó cero cambios comerciales. La única edición remota incrementó revisión2→3, cambió actualizado_por_id y updated_at del proyecto, solo el título de la etapa y exactamente una actividad editar_etapa de Agustín, preservando las actividades anteriores. Las otras102 tablas no cambiaron. Desde ese commit hasta el cierre, los hashes completos de105 tablas públicas salvo auth_/browser_session y las filas exactas de proyecto/etapa/actividad permanecieron idénticos. Esto acredita cero escrituras adicionales confirmadas, no ausencia de solicitudes fallidas, rollbacks o avances de secuencias.

Log `/private/tmp/render2-goal232-project-native.log`: salida0 y cleanup ENOENT `/private/tmp/render2-local-s5PKZB`. En233 el inventario nativo mostró solo pestañas1–5 del usuario, ninguna pestaña temporal38, y viewport.reset terminó correctamente. No se cerraron pestañas del usuario. La inspección autorizada de memoria compartida mostró dos segmentos con6 conexiones cada uno; ninguno fue eliminado.

En233 se añadió una regresión ejecutando los controladores reales extraídos de Projects.jsx: detalle remoto9, borrador base8, envío rechazado409 y Cancelar con confirm simulado false/true. Rechazar conserva el mismo formulario/borrador/base; aceptar solo lo cierra y prepara retorno de foco. Ambas decisiones conservan la observación remota y no hacen lecturas, reintentos o nuevas mutaciones. Es prueba de controladores con transporte/confirm simulados, no navegador ni PostgreSQL. Comando reproducible desde frontend: `node --test src/pages/projectNavigationGuard.test.js src/pages/projectRefreshRecovery.test.js`;23 aprobadas,0 fallos/omisiones. Las22 previas también se renovaron antes del agregado.

La skill verification orientó separar UI, API, SQL y los límites de observación. Pendiente: aceptar/rechazar el confirm nativo, comprobar retorno de foco y recarga desde el descarte sobre un fixture nuevo. No se acepta globalmente Proyectos ni el sistema y no hay despliegue.

Un fallo recuperable al actualizar un proyecto ya no oculta el editor ni el borrador. Se conserva la última observación del mismo proyecto y se distingue de una consulta vigente. Guardar, verificar una solicitud, abrir otro formulario, consultar una tarea o adoptar otra revisión permanece bloqueado hasta obtener una lectura válida. No se cambiaron contratos HTTP, permisos del servidor ni esquema.

## Contrato y controles

Projects.jsx publica el estado de detalle también en un ref síncrono. Los handlers comprueban ese estado antes de operar; no dependen únicamente de botones disabled o de una clausura vieja. El snapshot se conserva ante red,5xx o DTO inválido solo si pertenece al proyecto seleccionado. Un403 continúa purgando datos, formulario y catálogos;401 y errores de sesión no conservan el snapshot como recuperación local.

El usuario puede seguir editando texto local y cerrar con la confirmación existente. Un GET posterior válido actualiza detalle y permisos sin reemplazar borrador, revisión base, UUID o cuerpo congelado. Perder permisos o archivar el proyecto mantiene el borrador, pero no habilita escrituras. Crear hijos y aprobar entregables siguen sin rebase automático.

Poincare modificó únicamente Projects.jsx. Carver añadió projectRefreshRecovery.test.js y adaptó fixtures de navegación, contexto, altas y aprobaciones. Beauvoir revisó el delta de forma independiente, sin P1/P2 nuevos confirmados. La revisión React comprobó el ref de observación, las guardas anteriores a await, el aislamiento por identidad y la ausencia de listeners nuevos o almacenamiento comercial local; no motivó una reescritura de módulos.

## Prueba visual aislada

La fixture temporal render2-projects168-browser.mjs compila ProjectsPage y sus dependencias reales con API y sesión sintéticas. No prueba autorización ni persistencia PostgreSQL. Se abrió Editar proyecto, se escribió un título y se provocó un503 en el GET de detalle mediante un control de fixture.

El editor siguió visible con el borrador y revisión base1. Se mostró la advertencia de última versión observada; Guardar, Nuevo proyecto y Archivo quedaron bloqueados. En390×844 se pudo seguir escribiendo el título mientras Guardar permanecía deshabilitado. Documento y viewport midieron390px; no hubo escrituras de dominio. Reintentar proyecto recuperó el detalle, mantuvo el título y revisión base1 y volvió a habilitar Guardar. No se envió un PATCH en este recorrido.

La prueba demuestra continuidad del borrador visible, no la identidad interna del nodo ni conservación de foco al pulsar Actualizar. Ese clic cambia el foco por interacción normal. Los tests cubren además respuestas tardías, identidad/ABA, permisos revocados,403,401, borradores inciertos y bloqueo de handlers retenidos durante pending/error.

Captura válida: `/private/tmp/render2-project169-mobile-stale-final.png`, tomada mediante getScreenshot. Un intento anterior con screenshot de pestaña produjo un encuadre reducido; no se usa para acreditar legibilidad móvil.

## Texto del vínculo mensual

El recorrido audiovisual conectado detectó que GoalTaskLink invitaba a vincular una tarea que ya contaba en un casillero. La asociación no se había perdido: el diálogo consulta el vínculo por ID en backend y reconoce el casillero actual. La tarjeta exterior no tenía esa lectura y usaba una afirmación no comprobada.

Hypatia cambió solo el exterior por Consultar vínculo mensual y un texto neutral. No se infiere asociación desde metadata ni se revincula automáticamente. El diálogo, permisos y mutaciones permanecen iguales. Su suite pasó10 pruebas; la etiqueta nueva se verificó en JSX/SSR, no en el build168 que continúa sirviendo el recorrido audiovisual abierto.

## Pruebas y build

Las suites focales de Proyectos pasaron61 pruebas. La regresión final de frontend pasó2360, sin fallos ni omitidas. Backend pasó1969, con119 omitidas y cero fallos, sin integración física en esa regresión. El cambio es de frontend; el recorrido audiovisual conectado se documenta aparte y no sustituye esas integraciones omitidas.

El build actual pasó en `/private/tmp/render2-build169.EVvy8O`, entrada `index-Ciy4rCJK.js`. Se usó un directorio nuevo para no borrar los chunks del build168 que el servidor del recorrido conectado había capturado al iniciar. No se reemplazó frontend/dist durante esa sesión de QA. Antes de un próximo arranque canónico debe generarse allí el build correspondiente al código actual.

Logs: `/private/tmp/render2-project169-refresh-focused.log`, `render2-project169-frontend-release.log`, `render2-project169-backend.log` y `render2-project169-build.log`.

No hubo migraciones, despliegues, acceso a producción ni modificaciones de datos comerciales. Los archivos heredados de preview/sandbox permanecen intactos. El objetivo global sigue abierto.
