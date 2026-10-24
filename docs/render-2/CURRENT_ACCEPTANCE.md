# Estado de aceptación de Render 2

El sistema canónico continúa en desarrollo local y no está aceptado globalmente ni preparado para despliegue. Este resumen distingue los resultados vigentes de los diagnósticos históricos de MASTER_LOCAL_ACCEPTANCE.md y CURRENT_MASTER_REVIEW_155.md. No convierte pruebas parciales en terminación del prompt maestro.

## Arquitectura y evidencia operativa

| Requisito | Evidencia vigente | Qué falta para aceptarlo globalmente |
| --- | --- | --- |
| Una aplicación y datos compartidos | Entry React/Vite, App, Express y PostgreSQL; revisión del grafo no monta DesignPreview/sandbox como negocio paralelo. MoodboardPreview usa API pese a su nombre. | Certificar todos los consumidores y la adopción coordinada sobre el destino autorizado. |
| Sin negocio exclusivamente en navegador | Revisión estática actual de sinks activos: preferencias, posición de Wilson y lectura de notificaciones. Los snapshots locales pertenecen al grafo no montado de preview. | Esta revisión no demuestra ausencia de cualquier sink dinámico posible. No borrar referencias heredadas. |
| Identidades y permisos del servidor | Sesiones cookie/época, cuotas y dominios con contratos verificados; nueva cohorte cookie pasó10 pruebas físicas. | Hallazgo abierto S175-01 en escritores de Mi lista. Cuentas QA no acreditan cuentas reales independientes provisionadas. |
| Protección financiera | Pruebas previas con datos testigo y DTO; recorrido171 comprobó Reportes y dos rutas financieras con empleado. | Aceptación transversal por rutas/roles y condiciones reales de hosting; no extrapolar una lista de nombres de campos a todo el sistema. |
| Trabajo distinto de publicación | Recorrido nativo conectado de tres videos: tres tareas finalizadas con cero eventos antes de confirmación explícita; después, tres eventos manuales y mismas cuotas/vínculos. | No es publicación ni verificación externa en redes. Ver NATIVE_THREE_VIDEO_PROGRESS.md. |
| Producción individual y material | Tres tareas de edición por visita probadas; fotos por tipo/enlace/observación y guion retomado con origen comprobados en PostgreSQL. | Edición posterior del mismo UUID de foto, banco/traslado de fotos y proveedores no aceptados. Ver PRODUCTION_PHOTOS_PENDING_QA.md. |
| Orden persistente y navegación | Dos arrastres nativos con SQL/recarga/otro lector; calendario, URL/Back y filtros móviles verificados por alcance. | No todos los movimientos de estado, tamaños, roles ni acciones. Ver BOARD_NATIVE_DROP_QA.md y CALENDAR_MOBILE_FILTERS_QA.md. |
| Proyectos de Desarrollo | Fuente implementa proyecto, responsable, etapas, hitos, tareas existentes y entregables versionados; pruebas físicas y UI sintética anteriores. | Recorrido nativo conectado completo con responsable no-admin, aprobación invalidada por cambio y separación de cuotas. |
| Mi lista | Recibos087, persistencia/CAS y runtime cookie renovados físicamente,26 comprobaciones aprobadas. | S175-01 y aceptación nativa de pérdida de ACK/cancelación/recuperación. No almacenamiento offline de negocio. |
| Diseño y experiencia uniforme | Componentes/tokens comunes y recorridos específicos de escritorio/móvil. | Aceptación poblada de todas las áreas, teclado/zoom/contraste, modales restantes y dispositivos independientes. |
| Despliegue | Ninguno autorizado ni ejecutado. | Roster real, proveedores, origen/TLS/proxy, backup/restauración y ensayo de migraciones sobre copia autorizada, validación definitiva y autorización expresa. |

## Cohorte física renovada de Mi lista

Se ejecutaron secuencialmente, con RENDER2_RUN_LOCAL_INTEGRATION=true y un clúster nuevo por archivo:

1. render2-personal-list-create-receipts.integration.test.js:10 aprobadas. UUID obligatorio, carreras mismo/distinto intento, recuperación actual, aislamiento por actor, tombstone sin resurrección, revocación previa a creación/recuperación y cap/posiciones serializados.
2. render2-personal-list-persistence.integration.test.js:6 aprobadas. Propiedad privada, CAS de página/bloques, escritores competidores y orden/versiones.
3. render2-browser-cutover.integration.test.js:10 aprobadas. Runtime y rutas reales con PostgreSQL; adaptador loopback, cookie jar y mutex simulados. No es navegador nativo ni comprobación HTTPS/Google/Web Locks del motor.

Las tres ejecuciones tuvieron cero fallos/omitidas. Los hooks confirmaron eliminación por ENOENT de `/private/tmp/render2-local-G73IMP`, `/private/tmp/render2-local-56HiZN` y `/private/tmp/render2-local-fUqpCB`. La primera suite ahora comprueba identidad exacta y ENOENT explícitamente, además de la limpieza del harness. Logs: `/private/tmp/render2-audit175-list-receipts.log`, `/private/tmp/render2-audit175-list-persistence.log` y `/private/tmp/render2-audit175-browser-cutover.log`.

La regresión backend sin opt-in pasó1969 pruebas y omitió119 integraciones, cero fallos. Log `/private/tmp/render2-audit175-backend.log`. Esa cifra no equivale a ejecutar toda la regresión física. No se cambió producto ni se repitió el frontend/build en este corte.

## S175 01 Autorización durante escrituras personales

- Regla: autorización vigente del servidor durante la operación, vinculada a ID/rol/época; relacionada con REACT-AUTHZ-001, sin afirmar que el problema sea un control React.
- Severidad: Medium/P2, pendiente de reproducción física.
- Ubicación: backend/src/personal-lists.js, PATCH/DELETE de páginas y bloques, y familias de escritores de plantillas/secciones/items/reordenamiento. El alta raíz usa personal-list-create-receipts.js y sí retiene al actor en transacción.
- Evidencia: PATCH de página usa pool.query con dueño y CAS; DELETE y otras escrituras tampoco vuelven a validar/bloquear usuarios dentro de la operación. El middleware concluye su observación de identidad antes del handler. El reordenamiento tiene transacción de dominio, no actor retenido.
- Impacto condicionado: una petición de un usuario previamente válido, sobre contenido propio, puede permanecer esperando DML mientras se confirma su revocación y luego escribir con la autorización anterior. No demuestra acceso anónimo, a listas ajenas ni a finanzas.
- Corrección prevista: wrapper de escritura con captura síncrona de actor/entrada, READ COMMITTED, actor FOR UPDATE verificado antes de dominio, consultas en la misma conexión y COMMIT antes de responder. Preservar DTO, códigos, BIGINT, CAS existentes, orden parcial y compatibilidad MIA; no envolver el alta087 en una segunda transacción.
- Mitigación actual: conservar middleware, propiedad por ID y CAS; no presentarlos como solución de la carrera. No desplegar como seguridad aceptada.
- Verificación necesaria: bloquear actor y confirmar revocación antes de su autorización debe producir401 sin DML. Si el escritor ya retuvo actor y espera dominio, la revocación debe esperar al commit autorizado; no exigir rechazo retroactivo. Cubrir familias, rollback intermedio de orden, límites y convivencia con087/MIA.
- Notas de falsos positivos: hipótesis sustentada por fuente, no explotación ejecutada. Las pruebas nuevas de creación/recuperación no cubren estos otros escritores. Falta revisar todas las familias antes de declarar el cierre.

## Siguiente integración y responsables

Prioridad: resolver y probar S175-01 antes del recorrido conectado de Proyectos. Un solo integrador modifica personal-lists.js; el helper y sus pruebas pueden asignarse por archivos separados, con contrato común anterior a la adopción. No se requieren nuevas migraciones para retener la autoridad existente, salvo que la implementación demuestre otra necesidad.

Poincare revisó arquitectura/autoridad y propuso el contrato; Beauvoir examinó grafo y sinks; Hypatia contrastó el flujo de Desarrollo; Carver señaló la cohorte087 pendiente. Todos hicieron revisión de solo lectura. El coordinador reforzó la prueba087 y ejecutó las tres suites en clústeres descartables. Las skills de seguridad y trabajo estructurado orientaron la prioridad y los límites; la documentación permanece local. Se preservó el informe de seguridad raíz no versionado.
