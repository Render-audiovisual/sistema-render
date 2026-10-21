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
| Alta | `PATCH /piezas/:id` en `backend/src/server.js`: busca primero publicaciones y después historias; un ID sin tipo puede ser ambiguo y no tiene el contrato de revisión de los escritores canónicos. | Backend/editorial: inventariar consumidores externos, rechazar ambigüedad o retirar con contrato compatible, probar IDs colisionados y concurrencia. No borrar ciegamente por no encontrar un caller React. |
| Alta | `CategoryEditor` de `MoodboardPreview.jsx`: escrituras encadenadas sin operación capturada y recuperación explícita del guardado parcial. | Un solo agente frontend: bloqueo síncrono, contexto capturado, conflicto/error recuperable y pruebas de doble envío, cambio de identidad y fallo intermedio. |
| Media | Reportes ensambla varias lecturas independientes y anotaciones; `Reportes.jsx` conserva una gestión anterior de respuestas rezagadas. | Backend/frontend coordinados: snapshot coherente y recepción ligada a identidad/contexto; comprobar cambios concurrentes y relevo de sesión. No confundir con el snapshot financiero ya implementado. |
| Media | Notas generales de Feedback limitadas a las 500 recientes, sin paginación. | Endpoint y UI paginados con pruebas de más de 500 notas; la cola de revisión paginada no resuelve este listado diferente. |
| Alta antes de despliegue | Transporte principal bearer; adopción global de cookies no acreditada. | Identidad: decidir y verificar migración integral, CSRF, cierre/revocación y consumidores; no activar parcialmente. |
| Aceptación pendiente | Cancelar navegación con cambios sin guardar no quedó probado de forma nativa; ver integración112. | QA independiente: diálogo real controlable y conservación de datos, sin inyectar bypasses. |
| Aceptación pendiente | Diseño global poblado, drag and drop nativo, todos los roles, todas las acciones y varios dispositivos. | QA por recorrido; el smoke de entradas no certifica estas interacciones. |

## Coordinación y salida a producción

La integración113 mantiene un único responsable de `server.js`. Poincare cubre el recorrido editorial, Hypatia las carreras financieras físicas, Beauvoir la revisión independiente y Carson el inventario transversal. Los agentes no deben compartir escrituras sobre archivos centrales. No mantener un agente por área modificando contratos incompatibles en paralelo.

Antes de desplegar: cerrar los hallazgos prioritarios, confirmar base/hosting y versiones reales, preparar backup y ensayo de restauración, revisar migraciones aditivas contra una copia autorizada, provisionar cuentas independientes y proveedores, ejecutar aceptación sobre build definitivo y obtener autorización expresa. Hoy el estado es **implementado y parcialmente verificado en desarrollo local**, no «preparado integralmente para despliegue» ni «desplegado».
