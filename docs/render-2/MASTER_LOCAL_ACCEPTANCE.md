# Render 2.0: arquitectura y aceptación local

Este documento es el punto de entrada para continuar el rescate. Describe el sistema conectado actual y distingue implementación de evidencia. No certifica la terminación del prompt maestro ni un despliegue. El historial detallado está en [STATUS.md](STATUS.md); sus primeras entradas describen etapas anteriores, no el estado actual completo.

## Entorno y arquitectura

- Rama de trabajo: `codex/render-2-rescue-local`. Se preservan los archivos heredados no versionados de preview y sandbox; no deben incorporarse masivamente a un commit ni borrarse.
- Aplicación principal: React/Vite en `frontend`, Express en `backend/src/server.js`, PostgreSQL y migraciones versionadas en `backend`. Las rutas operativas de `frontend/src/App.jsx` no montan DesignPreview ni el sandbox como aplicaciones de negocio paralelas.
- `frontend/src/api.js` concentra transporte; cada módulo conserva sus controladores y contratos. Verificar el transporte real antes de modificar autenticación: la entrada principal todavía usa bearer; disponer de código de cookies no significa que toda la aplicación lo utilice.
- Identidad: IDs y época de sesión comprobados por el servidor, usuario activo y rol actual. Los nombres son etiquetas, no permisos. No se utiliza el selector local Franco/Agustín como autenticación del sistema conectado.
- Datos operativos compartidos: API y PostgreSQL. Preferencias visuales pueden permanecer locales. Drive requiere conexión externa autorizada; las pruebas usan un proveedor simulado, no acreditan acceso al Drive comercial.
- No se identificó ni utilizó una base comercial. Las pruebas físicas arrancan clústeres nuevos mediante `backend/scripts/render2-local-test.js`; no debe sustituirse por el arranque ordinario de un servidor contra una URL desconocida.

## Mapa de secciones

Los archivos son relativos a la raíz del repositorio. Los nombres históricos de componentes no describen necesariamente su función actual: `WorkspaceReadOnly` permite operaciones y `MoodboardPreview` está conectado.

| Área y entrada | Componente principal en `frontend/src/pages` | Función y relaciones |
| --- | --- | --- |
| Inicio `/inicio` | `QuickHome.jsx` | Responsabilidades personales, próximas entregas, revisión y carga operativa; datos de `/api/inicio`, no contadores ilustrativos. |
| Tareas `/workspace/tareas` | `WorkspaceReadOnly.jsx` | Tareas por ID, responsables/colaboradores, vistas y filtros, entregas, correcciones, revisión, finalización y orden persistente. |
| Calendario `/calendario` | `Calendar.jsx` | Fechas operativas y proyectos; no convierte entregas en publicaciones. |
| Producciones `/producciones` | `Productions.jsx` | Visitas, participantes, videos individuales, guiones, fotos, material pendiente/repetir y enlaces. Cada video puede vincular su propia tarea de edición. |
| Clientes y objetivos `/clientes` | `ClientesObjetivos.jsx` | Acuerdos mensuales, cuotas y piezas válidas; preparación explícita, responsables y control de duplicación. |
| Administración `/clientes?gestion=1` | `Clientes.jsx` | Gestión de clientes y acuerdos conforme a permisos. El centro operativo `/clientes/operacion` requiere contexto de cliente. |
| Proyectos `/proyectos` | `Projects.jsx` | Trabajo web y otros proyectos con etapas, hitos, entregables y aprobaciones; no son cuotas mensuales de contenido. |
| Historias `/planificacion-historias` | `Historias.jsx` | Planificación editorial, contenido y responsables, con contratos de edición y sesión independientes. |
| Publicaciones `/planificacion-publicaciones` | `Publicaciones.jsx` | Piezas, fechas programadas y publicación real explícita; objetivos y tareas relacionados. |
| Mi lista `/lista` | `PersonalLists.jsx` | Espacio personal persistente por identidad; orden y edición con control de versión. |
| Feedback `/feedback` | `Feedback.jsx` | Notas y seguimiento; revisiones de entregas mantienen sus propios registros y recibos. |
| Reportes `/reportes-historias` | `Reportes.jsx` | Actividad operativa y producción, proyecciones autorizadas; DTO financiero restringido desde backend. |
| Archivos `/drive` | `Drive.jsx` | Autorización sobre tareas/archivos e integración externa existente; no replica almacenamiento de Drive en localStorage. |
| Moodboards `/moodboards` | `MoodboardPreview.jsx` | Tableros compartidos, categorías y referencias persistentes. |
| Finanzas `/sueldos` | `Sueldos.jsx` | Proyecciones, contratos y registro manual separado de pagos. Una proyección no acredita una transferencia bancaria. |
| Equipo `/empleados` | `Empleados.jsx` | Administración de cuentas y accesos; un integrante común usa su perfil, no administra otros usuarios. |
| Perfil `/perfil` | `Perfil.jsx` | Datos de la identidad actual y configuración permitida. |

La barra lateral agrupa accesos y las rutas admiten navegación directa. La visibilidad de un enlace no sustituye autorización del servidor. Ver [LEGACY_ROUTES_CONTRACT.md](LEGACY_ROUTES_CONTRACT.md) y [NAVIGATION_QA.md](NAVIGATION_QA.md).

## Contratos operativos que deben conservarse

1. Diseño y Comunicación comparten clientes, objetivos y piezas: el diseñador produce; community planifica y registra programación/publicación. La aprobación corresponde a una entrega concreta, no al título o nombre del usuario.
2. Audiovisual registra una visita con varios videos. Edición recibe tareas individuales con editor y entrega propios. Cambiar fecha de visita no significa cambiar automáticamente fecha de entrega.
3. Desarrollo utiliza proyectos, etapas y entregables; puede compartir clientes y tareas sin adoptar obligatoriamente el flujo de reels o cuotas.
4. Finalizar una tarea no publica una pieza ni inventa una fecha real. La publicación exige registro autorizado explícito. Preservar historia heredada, sin reinterpretar automáticamente sus estados.
5. Una pieza válida cuenta una vez para su cuota, aunque tenga varias tareas. No contar tareas sueltas como contenido publicado.
6. Confirmaciones requieren respuesta comprometida del servidor. Conservar controles de versión, recibos de creación, reintentos explícitos y protección de cambios sin guardar.

Contratos detallados: [WORKFLOW_TRANSITIONS.md](WORKFLOW_TRANSITIONS.md), [PRODUCTION_REGISTRY_CONTRACT.md](PRODUCTION_REGISTRY_CONTRACT.md), [PRODUCTION_EDITORIAL_CONTRACT.md](PRODUCTION_EDITORIAL_CONTRACT.md), [PROJECTS_CONTRACT.md](PROJECTS_CONTRACT.md), [EDITORIAL_CONFIRMATION_CONTRACT.md](EDITORIAL_CONFIRMATION_CONTRACT.md), [TEAM_PAYMENT_LEDGER_CONTRACT.md](TEAM_PAYMENT_LEDGER_CONTRACT.md).

## Evidencia ejecutada en la integración 113

Todos los resultados físicos siguientes corresponden a PostgreSQL nuevo y HTTP real local, no al hosting. No suman aceptación de proveedores externos ni múltiples dispositivos físicos.

| Grupo | Archivos `backend/test` | Resultado observado |
| --- | --- | --- |
| Núcleo | `render2-cross-sector-workflow.integration.test.js`, `render2-production-full-workflow.integration.test.js`, `render2-editorial-confirmation.integration.test.js`, `render2-task-board-order.integration.test.js`, `render2-goals-content.integration.test.js` | 48 aprobadas, 0 omitidas, 0 fallos. |
| Identidad y privacidad | `render2-operational-privacy.integration.test.js`, `render2-user-authority.integration.test.js`, `render2-login-identity.integration.test.js`, `render2-user-administration.integration.test.js` | 62 aprobadas, 0 omitidas, 0 fallos. |
| Módulos auxiliares | `render2-projects.integration.test.js`, `render2-calendar-projects.integration.test.js`, `render2-personal-list-persistence.integration.test.js`, `render2-feedback-receipts.integration.test.js`, `render2-readonly-resources.integration.test.js`, `render2-moodboard-board.integration.test.js`, `render2-drive-task-authorization.integration.test.js` | 72 aprobadas, 0 omitidas, 0 fallos. Drive utiliza proveedor de prueba. |
| Autoridad financiera pura | `finance-write-authority.test.js`, `financial-contract.test.js`, `finance-snapshot.test.js` | 16 aprobadas, 0 fallos; las pruebas físicas de carreras se registran por separado en STATUS. |
| Autoridad financiera física | `render2-financial-contract-authority.integration.test.js` | 15 aprobadas, 0 omitidas, 0 fallos. Esperas reales de mutex/filas, revocación, CAS, rollback y ausencia de exposición a empleados. |
| Recorrido editorial completo | `render2-master-editorial-journey.integration.test.js` | 1 aprobada, 0 omitidas, 0 fallos; entidades y relaciones creadas mediante HTTP, mismos IDs y nuevas sesiones. |

La integración114 vuelve a ejecutar historias, vinculación audiovisual, workflow de tareas, privacidad, masterC y la nueva suite editorial: **61 aprobadas, 0 omitidas, 0 fallos**. Esta ejecución acredita el contrato de edición actualizado; los resultados113 anteriores mantienen su fecha/alcance y no deben sumarse como si fueran nuevos recorridos distintos.

Reproducción de cada grupo: desde `backend`, `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=2 test/<archivo>.integration.test.js ...`. El harness debe poder crear su clúster aislado; un bloqueo de permisos de initdb no autoriza usar otra base.

Logs temporales de esta ejecución: `/private/tmp/render2-master113-core.log`, `render2-master113-identity.log`, `render2-master113-support.log`, `render2-master113-finance-unit.log` en el mismo directorio. Son evidencia efímera, no copias de seguridad.

### Recorridos del prompt maestro

- A, tareas: creación, asignación por ID, edición, entrega, devolución, nueva entrega, aprobación/finalización y nuevas sesiones tienen prueba HTTP conectada.
- B, audiovisual: una visita con tres videos genera tres tareas distintas, con editores, correcciones y aprobaciones; no se agrupan forzosamente en una tarea.
- C, publicaciones: una prueba nueva compone acuerdo, cuota, pieza, visita/video, vinculación, entrega, revisión exacta, aprobación, finalización y registro manual de publicación con los mismos IDs. La programación se establece explícitamente al asociar el objetivo; no certifica reprogramación posterior a aprobación ni publicación ejecutada por un proveedor externo. Finalizar la tarea no publica; una pieza y un evento cuentan una sola vez.
- D, finanzas: pruebas con roles de empleados y datos financieros testigo comprueban respuestas de API, no solo columnas ocultas.
- E, persistencia: nuevas sesiones y lecturas desde clientes HTTP distintos prueban datos compartidos en PostgreSQL. No equivale todavía a aceptación completa en dos dispositivos físicos con proveedores reales.
- F, navegación: existen pruebas de rutas y navegación; el recorrido nativo siguiente es una comprobación de entradas, no de todos los botones ni del flujo Cancelar sin guardar.

### Comprobación visual nativa

Entradas de las 15 áreas observadas como administrador sintético a 1280×900 y 390×844. Se comprobaron títulos visibles, alertas y ancho de documento: sin alerta ni desbordamiento horizontal en esas entradas. La variante de gestión de clientes también se observó en escritorio. El fixture no tenía tareas/clientes/proyectos comerciales: esto prueba estados vacíos y acceso a pantallas, no todos los formularios ni tableros poblados.

Evidencia estructurada temporal: `/private/tmp/render2-master113-native-observations.json`. El fixture se cerró con `unchanged:true`, sus tablas observadas seguían vacías, se retiró únicamente su raíz desechable y se restauró el viewport. No se hicieron escrituras operativas desde esta sesión nativa.

## Pendientes confirmados: no marcar como resueltos

| Prioridad | Hallazgo y ubicación | Criterio de corrección / dueño recomendado |
| --- | --- | --- |
| Corregido localmente en114 | GET/PATCH legacy y PATCH de Historias/Publicaciones usan identidad explícita y el servicio `editorial-piece-write.js`, con revisión064 observada, permisos actuales y commit antes de respuesta. | 61 pruebas físicas, incluidas18 nuevas de colisiones/CAS/autoridad/rollback; formularios adaptados y guardados nativos comprobados. Consumidores externos antiguos deben adoptar el contrato siguiente antes del despliegue. |
| Alta | `CategoryEditor` de `MoodboardPreview.jsx`: escrituras encadenadas sin operación capturada y recuperación explícita del guardado parcial. | Un solo agente frontend: bloqueo síncrono, contexto capturado, conflicto/error recuperable y pruebas de doble envío, cambio de identidad y fallo intermedio. |
| Media | Reportes ensambla varias lecturas independientes y anotaciones; `Reportes.jsx` conserva una gestión anterior de respuestas rezagadas. | Backend/frontend coordinados: snapshot coherente y recepción ligada a identidad/contexto; comprobar cambios concurrentes y relevo de sesión. No confundir con el snapshot financiero ya implementado. |
| Media | Notas generales de Feedback limitadas a las 500 recientes, sin paginación. | Endpoint y UI paginados con pruebas de más de 500 notas; la cola de revisión paginada no resuelve este listado diferente. |
| Alta antes de despliegue | Transporte principal bearer; adopción global de cookies no acreditada. | Identidad: decidir y verificar migración integral, CSRF, cierre/revocación y consumidores; no activar parcialmente. |
| Creación corregida localmente en115; borrado pendiente | `POST /piezas` tiene autoridad mantenida y recibos de intento. Los DELETE editoriales conservan límites previos: esta integración no certifica su autoridad transaccional ni una política global de archivo. | Migración082 y consumidores deben desplegarse coordinadamente, solo con autorización. Revisar borrado sin perder registros comerciales. |
| Aceptación pendiente | Cancelar navegación con cambios sin guardar no quedó probado de forma nativa; ver integración112. | QA independiente: diálogo real controlable y conservación de datos, sin inyectar bypasses. |
| Aceptación pendiente | Diseño global poblado, drag and drop nativo, todos los roles, todas las acciones y varios dispositivos. | QA por recorrido; el smoke de entradas no certifica estas interacciones. |

## Coordinación y salida a producción

La integración113 mantiene un único responsable de `server.js`. Poincare cubre el recorrido editorial, Hypatia las carreras financieras físicas, Beauvoir la revisión independiente y Carson el inventario transversal. Los agentes no deben compartir escrituras sobre archivos centrales. No mantener un agente por área modificando contratos incompatibles en paralelo.

Antes de desplegar: cerrar los hallazgos prioritarios, confirmar base/hosting y versiones reales, preparar backup y ensayo de restauración, revisar migraciones aditivas contra una copia autorizada, provisionar cuentas independientes y proveedores, ejecutar aceptación sobre build definitivo y obtener autorización expresa. Hoy el estado es **implementado y parcialmente verificado en desarrollo local**, no «preparado integralmente para despliegue» ni «desplegado».

## Contrato de edición editorial compartida (integración114)

- `GET /api/piezas/:id?dominio=historia|publicacion`: respuesta operativa cerrada, `revision` y `publicacion_evidencia`, sin caché. Sin dominio conserva lectura únicamente cuando el ID es inequívoco; colisión409, inexistente404. Nunca elegir publicación por orden de consulta.
- `PATCH /api/piezas/:id?dominio=historia|publicacion`: dominio obligatorio428 si falta; campos históricos limitados a estado, prioridad, idea, copy, material_referencia y aclaraciones. `expected_revision` entero observado>=0 obligatorio: ausencia428, formato400, versión obsoleta409.
- `PATCH /api/historias/:id` y `/api/publicaciones/:id`: mismo servicio, misma precondición. La identidad está en la ruta tipada. Usar la revisión de la misma fila `publicacion_evidencia.revision`, no una revisión de tarea, un timestamp redondeado ni un cero supuesto. La ausencia de fila de versión064 significa0; el trigger existente avanza después de cada UPDATE.
- Valores de texto vacíos se guardan; null conserva la omisión histórica. Fechas estrictas, cantidades enteras y metadata de objeto; campos no permitidos400. Edición máxima1MiB. El backend bloquea actor actual y clientes antes de pieza, verifica versión y lee evidencia dentro de la misma transacción.
- `estado:publicada` no es una edición ordinaria:409. Tampoco se retira una publicación confirmada cambiando su estado por PATCH. Usar las operaciones explícitas `/editorial-publicacion/:dominio/:id/confirmar` y `/retirar`. Editar copy de una pieza publicada no cambia su fecha real ni inventa evidencia ni finaliza tareas.
- Los formularios capturan revisión antes de encolar y no rebasan ni reenvían automáticamente un409. El usuario debe revisar una observación nueva. Un copy editado desde una tarea vinculada también puede avanzar la revisión de la pieza: ese conflicto es real, no un motivo para eliminar CAS.
- No se retiró `POST /api/piezas`: ambos planificadores lo usan. Su respuesta ahora incluye la anotación necesaria para edición posterior. La creación de una pieza ya publicada se rechaza; no se alteraron filas históricas.

## Contrato de creación compartida (integración115)

- El formulario nuevo usa `POST /api/editorial-creaciones`; `POST /api/piezas` es un alias histórico del mismo handler/servicio/recibo, no otra implementación. Ambas rutas exigen `request_id` UUID por intención (ausente428, inválido400), `responsable_id` entero del catálogo y `cliente_id` entero. No asigna por defecto a Augusto ni deduce identidad por nombre. Una etiqueta opcional `responsable` no define asignación ni hash.
- Tipos: historia, carrusel o video. Campos de contenido conocidos, fechas estrictas, estados sin publicación real y defaults normalizados. `metadata` continúa fuera de este POST; las sugerencias de historia se editan después con revisión observada.
- Creación confirmada201, repetición exacta200. El DTO operativo conserva evidencia/revisión y agrega `creation:{request_id,dominio,pieza_id,tarea_id,replayed}`. Una misma clave con otro negocio409; otra identidad tiene su namespace propio. Una nueva clave es otra intención, no una deduplicación por título.
- Autoridad actual compartida con la edición: captura ID/epoch antes de conexión, mutex de cuentas, actor vigente SHARE. Para un intento nuevo, responsable activo antes del cliente y de cualquier pieza/tarea; una sola resolución por ID. Pieza, tarea vinculada, asignación y recibo se confirman juntos. Ningún éxito antes de COMMIT.
- Migración082 crea `editorial_create_receipts` inmutable, sin backfill ni cambios comerciales. Actor con FK restrictiva; dominio/ID de pieza y tarea como identidades históricas sin FK de negocio, igual que los recibos de tareas: una eliminación legítima no borra el recibo ni permite recrear con la misma clave. Si falta la pieza/tarea o se desvinculó, recuperación409, nunca reconstrucción.
- La recuperación revalida al actor, pero no exige que el destinatario original siga activo: no crea ni reasigna. Devuelve la pieza actual con `replayed:true`; no acredita que conserve el texto original. El formulario no debe aplicar sugerencias/metadata copiada automáticamente sobre esa revisión nueva.
- Los formularios retienen UUID, cuerpo y sesión/contexto en memoria ante resultado incierto; ofrecen verificación explícita, nunca un POST automático. ACK confirmado seguido de fallo de lectura no repite creación. Se protege navegación/cambio de contexto mientras sigue pendiente. Si el usuario decide descartar ese contexto o sale de sesión, la clave no se conserva como dato de negocio local: debe revisar el registro compartido antes de una intención nueva. La prueba nativa global de Cancelar sigue siendo un gate separado.
- Nuevas altas eligen IDs reales; algunos editores históricos de responsables en filas todavía escriben etiquetas textuales, no son el contrato de asignación de tareas por ID. No certificar una migración completa de esos campos solo por corregir creación y presentación del catálogo.
- Compatibilidad de despliegue: frontend nuevo no usa ni intenta fallback al POST legacy de un backend antiguo que ignore `request_id`. Backend antiguo sin la ruta dedicada falla cerrado antes de crear; frontend antiguo sin UUID recibe428 del backend nuevo. Aun así, migración y build deben coordinarse mediante un despliegue expresamente autorizado.
- Aceptación115 final:69 pruebas HTTP/PostgreSQL (19 de la nueva suite dentro de ese total),1751 backend/101 opt-in omitidas y1608 frontend aprobadas, build correcto. Alta de publicación1280px e historia390px mediante ruta dedicada, recarga y SQL de dos piezas/dos tareas/dos recibos comprobados. La carrera de loading tiene regresión de callbacks extraídos; el recorrido normal también se repitió después del arreglo, sin afirmar una prueba nativa de latencia controlada o Cancelar.

## Archivo editorial recuperable (integración116; sustituye el límite de DELETE de115)

- `DELETE /api/historias/:id` y `/api/publicaciones/:id` devuelven410, sin DML. Los planificadores usan archivo/restauración, no borrado comercial ni fallback destructivo.
- `POST /api/editorial-archivo/:dominio/:id/archivar|restaurar`: solo administrador actual, UUID `request_id` por intención, `expected_revision` entero observado obligatorio, motivo opcional hasta1000 caracteres. CAS obsoleto409; UUID reutilizado con otro cuerpo409. Primera confirmación201; recuperación exacta200 con estado ACTUAL, sin repetir una transición que fue revertida después.
- `GET /api/editorial-archivo?dominio=historia|publicacion&offset=0&limit=20`: catálogo administrativo cerrado, paginado (máximo50), filtro opcional cliente_id, snapshot de lectura coherente. No expone metadata arbitraria ni importes privados. Archivo accesible desde ambos planificadores.
- Migración083 aditiva: auditoría inmutable, referencias restrictivas a pieza/actor, sin reinterpretar históricos. Escritura con autoridad vigente después del mutex, cliente antes de pieza y revisión releída después de esperar el bloqueo de pieza. Cambio de visibilidad y auditoría en una transacción; comentarios, copy, tareas, responsables, objetivos y evidencias se conservan.
- No archivar piezas publicadas o con evidencia/fecha real;409. Restaurar un registro histórico archivado no reconstruye una publicación. PATCH genérico rechaza campos archivado_*/restaurado_* y edición ordinaria de piezas archivadas. No usar retirada de publicación como atajo para ocultarla.
- Nuevas asociaciones a objetivos/producciones excluyen archivo y revalidan tras bloqueo. Vínculos y recibos ya existentes no desaparecen ni se regeneran. Conversión de historias con historia de archivo se bloquea para no borrar su auditoría.
- Reconciliación de calendario conserva piezas archivadas, trabajadas o vinculadas y sus versiones, incluso con clave automática fuera del mes. Mantiene el algoritmo de distribución; solo puede limpiar stubs automáticos vacíos, sin vínculos ni historial. Relee cuotas/actividad del cliente después de esperar su bloqueo. No libera automáticamente una cuota histórica por archivar.
- Verificación local116:79 pruebas HTTP/PostgreSQL en siete suites,1767 backend aprobadas/102 opt-in omitidas,1636 frontend aprobadas, build correcto. Revisiones independientes sin P1/P2 pendiente en este alcance. Corregido modelo descartado por montaje StrictMode mediante instancias por setup y regresiones de callbacks; NO equivale a prueba montada.
- Gate visual116 abierto: click de archivo en Vite real quedó bloqueado por control del navegador; SQL posterior comprobó ninguna transición, ninguna auditoría y tareas/copy intactos. Confirmación y archivo/restauración nativos con recarga, escritorio/móvil, siguen pendientes. No contar intento como éxito. Tampoco cierra Cancelar global112 ni los demás gates de este documento. No desplegado.
