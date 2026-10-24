# Fotos pendientes en Producciones

## Función integrada

El Banco de pendientes incluye fotografías pendientes y para repetir, además de los guiones existentes. Cada registro muestra tipo de foto, estado, cliente, fecha de visita, observaciones y enlace al material. Ver visita de origen abre el registro original, incluso si corresponde a otro mes. No copia fotografías, cambia su origen ni genera tareas.

El banco abarca todas las fechas y conserva el filtro explícito de cliente; el mes controla el calendario y las visitas de destino de los guiones. Una foto marcada Realizada deja de aparecer como pendiente, pero permanece en su visita y conserva su UUID.

GET /api/producciones/pendientes agrega fotos al contrato existente {videos,fotos}. El DTO de foto contiene solo id, visita_id, tipo, estado, drive_url, observaciones, fecha, cliente_id y cliente_nombre. Ordena por fecha de visita, creación e ID. No modifica permisos ni las reglas de linaje de videos. El cambio no necesita migraciones.

La interfaz exige ambos arrays en la pestaña de pendientes y comprueba el cliente antes de publicar resultados. Respuestas nulas o mal formadas no se convierten en un banco vacío. Las lecturas obsoletas siguen bloqueadas por epoch y AbortSignal. Los enlaces solo admiten HTTP(S) sin credenciales incrustadas; el texto se escapa mediante React.

## Archivos y coordinación

Erdos implementó la consulta backend, production-pending-photos.test.js y la ampliación de render2-production-registry.integration.test.js. El coordinador integró PendingProductionPhotos, estado y validación de lectura en Productions.jsx, estilos táctiles y pruebas frontend. Volta revisó los contratos y detectó el caso bank:null, corregido antes de la regresión final. server.js, App.jsx y el esquema no cambiaron.

Las guías frontend-design y apple-ui-design orientaron la separación visual entre guiones y fotos, el uso de tokens existentes y controles de44px. La verificación recorre la aplicación canónica conectada; no monta la previsualización ni guarda datos operativos en localStorage.

## Pruebas automatizadas

Regresión final: frontend2514 aprobadas, cero fallos u omisiones; backend2038 aprobadas,125 integraciones optativas omitidas, cero fallos. Build final index-yfCmchh5.js y diff-check correctos. Logs /private/tmp/render2-goal195-frontend-final.log, /private/tmp/render2-goal195-backend-final.log y /private/tmp/render2-goal195-build-final.log.

Las pruebas nuevas cubren DTO exacto, filtro parametrizado, estados reales, orden SQL, permisos de lectura y fallos de consulta; presentación de tipos/observaciones/enlaces, acción de apertura sin copia, estado vacío, protocolos inseguros, respuesta nula y cliente equivocado. Las comprobaciones JSX extraídas y SSR no se presentan como React montado.

La suite física render2-production-registry.integration.test.js pasó19 comprobaciones, sin omisiones. Su nuevo caso inserta fotos en distinto orden y comprueba fecha/creación/UUID, exclusión de Realizada, filtros y banco vacío, sin escrituras de lectura. El clúster /private/tmp/render2-local-PE4jaJ se eliminó. Log /private/tmp/render2-goal195-registry.log.

La primera regresión backend falló porque su fixture de extracción incluía accidentalmente el JSX del componente nuevo en un bloque de helpers JavaScript. Se separó el componente del bloque puro, sin reducir aserciones. La corrida final completa pasó.

## Recorrido nativo y persistencia

El runner temporal /private/tmp/render2-goal195-native.mjs preparó por API dos clientes, dos visitas y tres registros de fotografías. Luciano inició sesión y abrió el banco filtrado de octubre: vio Retratos del equipo de septiembre, marcado Repetir, con observación y material; no vio la foto Realizada del mismo cliente ni la pendiente del otro.

Ver visita de origen abrió la visita de septiembre y ajustó la URL a su UUID, mes y día. Desde Editar fotos cambió estado a Realizada, enlace a https://example.invalid/qa195/corregido y observación a Retratos corregidos con luz natural. Guardar retiró la foto del banco sin eliminarla de la visita. Recargar conservó estado, enlace y observación.

A390px se reabrió el formulario persistido y se cambió el filtro al otro cliente: apareció únicamente su foto pendiente. Ancho útil y scrollWidth375px, viewport390px; botón de origen44px. Capturas /private/tmp/render2-goal195-photo-bank-desktop.png, /private/tmp/render2-goal195-photo-edited-mobile.png y /private/tmp/render2-goal195-photo-bank-mobile.png.

El recorrido utilizó el build index-Dutr1iPZ.js. Después se reforzaron rechazo de bank:null y URLs con credenciales y se reubicó la declaración del componente para el fixture; el build final y las suites completas corresponden al árbol endurecido. No se repitió el recorrido nativo después de esos cambios de validación y organización.

## Integridad y limpieza

El runner terminó0 y confirmó mismo UUID de foto, misma cantidad de registros y revisión de visita incrementada exactamente1. Conservó creador, fecha, cliente, participantes y demás fotos; el actor de actualización fue Luciano91003. Once tablas restantes permanecieron idénticas: clientes, cliente_configuraciones, tareas, tarea_asignaciones, publicaciones, historias, cliente_objetivos_mensuales, cliente_objetivo_piezas, cliente_objetivo_eventos, produccion_videos y produccion_visita_participantes. Un PATCH posterior con revisión antigua recibió409 y no incrementó de nuevo la revisión.

El banco filtrado quedó sin fotos y el global mantuvo únicamente la pendiente del otro cliente. Se verificó ausencia de /private/tmp/render2-local-prBcOV, se cerró la pestaña14 y se restauró el viewport. El primer fixture visual falló por un INSERT incompleto de datos sintéticos y también limpió /private/tmp/render2-local-FDOYOu; no se cuenta como aprobado. No se tocaron bases configuradas ni producción.

## Límites y despliegue

Implementado y verificado localmente por el alcance anterior; no desplegado. No hay traslado de fotografías entre visitas, copia de material ni verificación de permisos o disponibilidad de Drive: los enlaces de QA son sintéticos. Quedan aceptación transversal, dispositivos independientes, escalabilidad de bancos extensos y los gates generales de seguridad, respaldo y migración antes de autorizar un despliegue.
