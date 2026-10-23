# Revisión transversal del prompt maestro — 155

## Resumen ejecutivo

La unificación NO está certificada completa ni preparada globalmente para producción. Se revisó fuente actual después de154 y se implementaron/probaron los filtros de Seguimiento en155. No se sustituyó el objetivo por el conjunto de cambios ya realizados. Los hallazgos147 resueltos en148–154 no se repiten como abiertos.

Actualización156: S155-01 quedó implementado y probado localmente mediante snapshot actor/piezas/evidencia; ver EDITORIAL_CATALOG_AUTHORITY_QA.md. La matriz y las descripciones siguientes conservan el diagnóstico histórico de155; S155-02/03 y los gates globales siguen abiertos.

Actualización157: S155-02/03 quedan corregidos y probados localmente en PLANNING_WRITES_CONTRACT_QA.md. Se conserva el diagnóstico histórico debajo; los gates globales/UX no se consideran aprobados por estas correcciones. El siguiente recorrido integrado está definido, aún sin ejecutar, en INTEGRATED_JOURNEY_ACCEPTANCE_PLAN.md.

Integrador: cambios y pruebas de Seguimiento, contraste directo de hallazgos y este informe. Poincare: arquitectura/identidades/autoridad; Beauvoir: invariantes de negocio y límites de recorridos; Hypatia: navegación/Inicio/Calendario; Carver: pruebas de Seguimiento. Los tres auditores no editaron producto ni iniciaron servicios. Skills de trabajo estructurado y seguridad orientaron separación de evidencia, severidad y límites. Se preservó el informe de seguridad raíz no versionado; este corte se documenta aquí para no sobrescribirlo.

## Matriz de requisitos: qué prueba la evidencia actual

| Requisito maestro | Evidencia actual | Estado y evidencia todavía necesaria |
|---|---|---|
| Una app React/Vite + Express/PostgreSQL | main.jsx/App.jsx, entrada server.js, contratos y test transitivo canónico previo | Implementado en rutas/grafo revisados; no equivale a aceptación completa de módulos |
| Preview/sandbox como referencias, no sistemas comerciales paralelos | Grafo/routing canónico revisado; fuentes antiguas preservadas | Sin duplicado operativo confirmado en ese grafo. MoodboardPreviewPage es nombre de ruta operativa, no prueba de app paralela |
| No almacenamiento comercial exclusivamente local | Sinks revisados usan API; storage activo observado de preferencias/posición/notificaciones | Sin infracción nueva confirmada; falta certificación exhaustiva de todos los sinks/imports |
| Arranque seguro y migración explícita | server.js:3160–3179 comprueba identidad, ledger/schema y jobs autorizados | Implementado; en155 solo se ejecutaron clusters generados por harness, no entrada ordinaria contra base configurada |
| Identidades reales y permisos uniformes | Sesión cookie/servidor, helpers de autoridad y catálogos actuales | Incompleto uniformemente: hallazgos S155-01/02 abajo. No se acreditan cuentas reales configuradas de Franco/Agustín por usar cuentas QA |
| Privacidad financiera | Snapshots financieros/reportes, proyección operativa, catálogos147/149 | Contratos/pruebas existentes; no certificación de toda respuesta/ruta de producción. S155-01 no es acceso financiero ordinario de empleados |
| Tarea finalizada no implica publicación | editorial-publication.js:113–124 exige evento/revisión y acción explícita | Implementación revisada; no revalidación nativa completa A-F en este corte |
| Una visita con varios videos y tarea por video | production-registry.js:301–328, replay devuelve vínculo estable y verifica editor/fecha | Implementación revisada; aún falta recorrido nativo íntegro de tres videos desde creación hasta correcciones/aprobación |
| Entregas/correcciones/aprobaciones versionadas | editing-deliveries.js:100; editing-reviews.js:152; project-deliverable-approvals.js:49 | Implementado en módulos revisados; suites físicas anteriores separadas, no prueba de un único recorrido integrado |
| Cuotas/piezas sin duplicar ni reinterpretar historia | client-goals.js:123; production-editorial.js:18; contratos de reconciliación existentes | Reglas conservadas en fuente revisada; falta aceptación integral producción→edición→cuota→confirmación→calendario |
| Proyectos web/chatbots no equivalen a cuota mensual | projects.js y aprobaciones/hitos ya existentes | No hay motivo para reescribirlos; falta aceptación renovada de sus recorridos/UI completos |
| Navegación URL/recarga/Back | Mejoras152/153 y155 verificadas nativamente en filtros/listas | Parcial: falta transición accesible de foco en shell; no certificación de cada pantalla/estado |
| Inicio personal con datos reales | QuickHome.jsx usa DTO `/api/inicio`, contadores reales y límites explícitos | No métricas ilustrativas confirmadas; refresh desmonta tarjetas (UX155-02) |
| Calendario compartido completo | calendar.js incorpora tareas/visitas/piezas/hitos | Falta continuación para rangos que exceden el cap de eventos (UX155-01) |
| Mi lista/Feedback/Drive/Moodboards/Usuarios/Perfil | Rutas canónicas y contratos anteriores presentes; lista/plantillas153/154 verificadas | Presencia/contratos no prueban todos sus recorridos, proveedores externos o móvil |
| Diseño uniforme Apple/ClickUp/Notion | Tokens/componentes compartidos y cortes visuales anteriores | Parcial. Modales legacy aún sin migrar; tablas/selecciones heterogéneas; falta QA global visual, zoom/teclado/contraste |
| QA A-F y orden manual persistente | Suites por dominio y pruebas nativas acotadas anteriores | No aprobado globalmente: orden drag nativo dentro de columna sigue sin evidencia; falta recorrido intersectorial único y aceptación por roles/dispositivo |
| Preparado/desplegado | Commits locales, builds/tests acotados | NO preparado globalmente, NO desplegado; autorización de despliegue sigue ausente |

## Seguridad: hallazgos nuevos confirmados por fuente, no explotados en155

Todos requieren contexto autenticado previamente autorizado. No se consultaron secretos, cuentas reales, proveedores ni infraestructura de producción. Severidad Medium/P2 para este corte; no se afirma explotación anónima. Revalidar mediante barreras físicas antes de declarar corregidos.

### S155-01 — Medium: proyección editorial con autoridad previa a la lectura

- Regla: REACT-AUTHZ-001, autorización efectiva del dominio en servidor.
- Ubicación: backend/src/server.js:1486 y1551, GET Historias/Publicaciones; backend/src/operational-dto.js:166.
- Evidencia: `annotateEditorialEvidence(pool, ..., result.rows)` seguido de `editorialOperationalDto(row, req.auth)` después de consultas independientes; admin conserva la proyección administrativa del DTO.
- Impacto: una cuenta previamente válida cuyo rol/epoch/actividad cambie mientras espera puede conservar la proyección administrativa anterior; también filas/evidencia no comparten necesariamente una observación consistente.
- Corrección prevista: capturar identidad antes de lease; actor, filas, evidencia y DTO en un snapshot read-only común; preservar columnas/filtros/orden y no-store. Probar revocación antes de primer snapshot sin consultar/devolver dominio, y consistencia de revocación posterior.
- Mitigación: mantener middleware actual y no ampliar consumo administrativo hasta verificar el reemplazo; ocultar columnas en React no resuelve el límite.
- Notas/falsos positivos: no es ausencia de autenticación ni acceso ordinario de empleados a importes. Las pruebas DTO existentes no prueban esta carrera; no se ejecutó explotación física en155.

### S155-02 — Medium: escritores legacy sin autoridad retenida en DML

- Regla: REACT-AUTHZ-001, autorización server-side durante la operación.
- Ubicación: backend/src/server.js:1039 POST /check-publicacion y1097 PATCH /fechas-especiales/:id.
- Evidencia: requireRole seguido de pool.query directo, sin revalidación/bloqueo actual del actor en transacción.
- Impacto: una revocación confirmada tras middleware y antes del write puede no impedir la escritura.
- Corrección prevista: captura prelease, transacción con orden de locks revisado, actor actual retenido hasta commit; barrera previa a DML y comparación de tablas sin cambios para intentos denegados.
- Mitigación: mantener ACL existente; no considerar que el helper de Estructura150 protege estas otras rutas.
- Notas/falsos positivos: revocar después de un write ya autorizado/serializado no debe deshacerlo retroactivamente. No se probó esta carrera físicamente en155.

### S155-03 — Medium: coerción y atribución del checklist desde cliente

- Regla: EXPRESS-INPUT-001 y atribución basada en actor autorizado.
- Ubicación: backend/src/server.js:1041 y1060–1062.
- Evidencia: `Boolean(publicado)` y `confirmado_por || null` provenientes del body; `"false"` se convierte en true.
- Impacto: un caller admin puede registrar un valor inesperado o atribuir la marca a otra persona.
- Corrección prevista: boolean estricto y atribución del actor leído de DB, no nombre proporcionado por el cliente; preservar historial existente, semántica del checklist y ausencia de confirmación editorial real.
- Mitigación: cliente actual envía boolean correcto; no considerar eso validación del servidor.
- Notas/falsos positivos: check_publicacion es planificación/checklist, NO la confirmación editorial respaldada por eventos. Este hallazgo no demuestra publicaciones reales inventadas por ese endpoint.

## UX/operación: pendientes confirmados

- **UX155-01 / P2:** backend/src/calendar.js:185–189 devuelve events.slice(0,LIMIT) y truncated sin continuación. frontend/src/pages/Calendar.jsx:57 deriva agenda del mismo resultado mensual; calendarModel.js:49 consulta el rango mensual. El aviso es honesto, pero superar2000 puede dejar eventos inaccesibles aun después de acotar a cliente/tipo. Hace falta paginación estable por día/rango, no simplemente subir el límite sin garantías.
- **UX155-02 / P2:** personalHome.js:126 publica loading/data:null en refresh; eventos focus/online/visibilitychange lo disparan en144+. QuickHome.jsx:108 condiciona tarjetas a data, desmontando/reiniciando módulos como HomeProductionMonthly.jsx:13. Mantener datos/componentes durante refresh de la MISMA identidad; limpiar inmediatamente ante cambio de identidad/revocación. Probar ambos extremos.
- **UX155-03 / P2:** location.js:24 mueve scroll y emite popstate, pero App.jsx:200/Sidebar no ofrecen transición de foco al contenido ni enlace de salto observado. Resolver en shell con identificación de cambio de sección, sin robar foco en cambios internos de filtros.
- **Visual pendiente:** Seguimiento conserva tabla con scroll interno y columnas fuera del primer encuadre incluso en escritorio; no implica pérdida de campos, pero la captura155 no acredita comodidad/consistencia visual completa.

## Orden de integración siguiente

1. Cerrar S155-01 con contrato de snapshot y pruebas aisladas; luego escritores S155-02 y entrada/atribución S155-03, sin tocar producción.
2. Probar un recorrido físico integrado que una producción de tres videos, edición/corrección/aprobación, cuota y confirmación efectiva/calendario. No sustituirlo por sumar tests unitarios de dominios distintos.
3. Resolver cobertura completa del calendario, refresh de Inicio y foco del shell con pruebas de sesión y de datos obsoletos.
4. Renovar QA nativo por roles y móvil y resolver orden manual dentro de columna; después auditoría requisito-por-requisito para decidir si hay evidencia de cierre. No reinterpretar los intentos fallidos de drag anteriores como producto correcto o incorrecto sin prueba nueva.

Se continúa implementando por cortes seguros; este mapa no reinicia el proyecto ni elimina módulos estables. No se cambian dependencias, proveedores ni base principal por inferencia. El objetivo completo permanece activo.
