# Render 2.0 — corte de aceptación local372, actualizado394

Fecha: 2026-10-25. Base revisada372: `5ec8f11`; diagnóstico372: `fc36679`; la actualización373 corrige la proyección de Reportes descrita abajo. Rama `codex/render-2-rescue-local`. **El objetivo maestro no está completo ni aprobado para despliegue.** Este documento es un índice compacto; [CURRENT_ACCEPTANCE.md](CURRENT_ACCEPTANCE.md) conserva resultados, límites e intentos fallidos por integración.

## Resultado de las fases

| Fase solicitada | Estado comprobado | Lo que impide cerrarla globalmente |
|---|---|---|
| 0. Preparación segura | Worktree aislado; cambios ajenos preservados; harness con entorno limpio e identidad PostgreSQL propia; arranque separado de migraciones | No se ha aceptado un destino real ni ensayo sobre copia comercial autorizada. No usar esa ausencia como permiso para probar otra base. |
| 1. Seguridad y negocio | Identidad/rol/actividad/época del servidor, cookies/contexto/CSRF; DTO operativo sin dinero para todos en Reportes; Finanzas independientes; trabajo distinto de publicación | Roster real no sustituido por cuentas QA. La política de destinatarios de revisión sigue pendiente de decisión humana. |
| 2. Unificación | Un grafo comercial React/Vite → Express → PostgreSQL; tareas, clientes/cuotas, proyectos, registro audiovisual por video y editorial conectados; proyección de aprobación de Reportes corregida373 | Proveedor Drive real no certificado; aceptación transversal todavía parcial. |
| 3. Diseño | Tokens y componentes compartidos, rutas reales, sidebar agrupada, modo claro; recorridos nativos concretos de escritorio/móvil | No hay aceptación poblada transversal de todas las secciones/roles, lectores de pantalla, zoom, teclado y dispositivos físicos independientes. |
| 4. Funciones y experiencia | Persistencia, versiones, recibos, filtros, comentarios, protección de borradores y recuperación implementados por módulos | Reconciliar consumidores históricos restantes; avisos de revisión aún dependen de etiquetas. No afirmar que todo error de conexión/concurrencia esté cubierto. |
| 5. Punta a punta | Cohorte fija35 archivos; recorridos A–F parcialmente acreditados con alcances explícitos abajo | Pruebas sintéticas/API y un navegador no equivalen a múltiples dispositivos, cuentas reales, proveedores ni aceptación completa. |

## Aplicación y fuente de datos

La entrada activa es [App.jsx](../../frontend/src/App.jsx), no DesignPreview. El grafo de imports estáticos se comprueba en [canonical-entry.test.js](../../frontend/src/shared/navigation/canonical-entry.test.js). Vite conserva únicamente proxy `/api`. Preview y sandbox siguen preservados como referencias no montadas; `MoodboardPreview` sí es un componente conectado pese a su nombre.

Los datos operativos usan APIs PostgreSQL. Preferencias visuales y marcas de lectura pueden ser locales; no acreditan almacenamiento comercial offline. [db.js](../../backend/src/db.js), [database-transport.js](../../backend/src/database-transport.js), [auth.js](../../backend/src/auth.js) y [browser-session-transport.js](../../backend/src/browser-session-transport.js) contienen los límites de destino e identidad. [server.js](../../backend/src/server.js) inspecciona el esquema antes de escuchar; el migrador separado aplica su contrato de seguridad. Las pruebas nunca sustituyen un fallo del harness por una base configurada.

## Secciones exigidas y archivos activos

| Sección | Componente principal | Relación operativa |
|---|---|---|
| Inicio personal | `frontend/src/pages/QuickHome.jsx` | API personal, prioridades, próximos trabajos, actividad y proyectos propios; control editorial compartido separado |
| Tareas | `frontend/src/pages/WorkspaceReadOnly.jsx` | Tablero/lista/calendario, responsables por ID, brief, subtareas, comentarios, entregas y revisión |
| Calendario | `frontend/src/pages/Calendar.jsx` | Fechas de tarea, visita, piezas e hitos; no confunde visita con entrega |
| Producciones | `frontend/src/pages/Productions.jsx` | Visita, videos/guiones/fotos, pendientes y repetición; tarea individual por video y handoff explícito |
| Clientes y objetivos | `ClientesObjetivos.jsx`, `Clientes.jsx`, `ClientOperationPage.jsx` | Cuotas/piezas válidas, acuerdos y operación; administración según permiso |
| Proyectos | `frontend/src/pages/Projects.jsx` | Desarrollo y otros proyectos con etapas, hitos, tareas y entregables; no equivalen a cuotas editoriales |
| Historias y publicaciones | `Historias.jsx`, `Publicaciones.jsx` | Programación, contenido, responsables y confirmación real manual independiente del trabajo |
| Mi lista | `frontend/src/pages/PersonalLists.jsx` | Contenido personal por identidad, versiones y orden persistentes |
| Feedback | `frontend/src/pages/Feedback.jsx` | Notas y seguimiento versionados; no sustituye decisiones de revisión de una entrega |
| Reportes | `frontend/src/pages/Reportes.jsx` | Todo el equipo/clientes sin dinero para ningún rol; atribución por ID, no por nombre |
| Archivos y Drive | `frontend/src/pages/Drive.jsx` | Integración existente y autorización de tarea/archivo; proveedor comercial pendiente de certificación |
| Moodboards | `frontend/src/pages/MoodboardPreview.jsx` | Tableros/categorías/referencias compartidos mediante API |
| Finanzas | `frontend/src/pages/Sueldos.jsx` | Proyecciones y registro manual de pagos; no prueba transferencia bancaria |
| Usuarios y equipo | `frontend/src/pages/Empleados.jsx` | Administración de identidades/acceso; empleados no administran otros usuarios |
| Perfil y configuración | `frontend/src/pages/Perfil.jsx` | Cuenta actual y configuración permitida |

Todas estas filas describen implementación, no certificación exhaustiva. [App.jsx](../../frontend/src/App.jsx) y [navigation.js](../../frontend/src/components/navigation.js) agrupan rutas según rol. Ocultar un enlace no sustituye permisos del servidor.

## Recorridos del prompt maestro: evidencia y límites

| Recorrido | Evidencia relevante | Límite de aceptación |
|---|---|---|
| A. Crear/asignar/trabajar/revisar/aprobar/finalizar | `render2-cross-sector-workflow`, `render2-production-full-workflow`, entregas/revisiones/aprobación y cookies en la cohorte principal | No cubre toda combinación de rol, sector, red y dispositivo |
| B. Visita con tres videos y editores independientes | `render2-production-full-workflow`, `render2-unified-three-video-journey`, `render2-audiovisual-cookie-concurrency` | Incluye APIs/cookies y recorridos nativos documentados; no proveedor de archivos real |
| C. Pieza/objetivo/producción/revisión/programación/publicación efectiva | `render2-master-editorial-journey` renovado372 y `render2-editorial-confirmation/adoption` | Confirmación manual autorizada no es verificación de una red social |
| D. Empleado sin dinero / dueño autorizado | Matrices cookie/bearer369, snapshot físico y Finance API | Reportes de todos los roles son ahora sin dinero; importes de dueños permanecen en Finanzas. Canarios estructurados no censuran texto libre arbitrario |
| E. Persistencia y otras identidades | Nuevas sesiones HTTP/cookie conservan IDs, revisiones, artefactos y relaciones; recargas nativas documentadas | No confundir sesiones independientes con dos dispositivos físicos |
| F. URL, recarga, enlaces y Atrás | Grafo/rutas, guardas de navegación y recorridos nativos en secciones concretas; Reportes370 | No hay certificación universal de cada combinación de ruta, filtro y formulario |

## Evidencia vigente, sin sumar ejecuciones como recorridos únicos

- Integración394: corregido submit de imagenA mientras FileReader deB está pendiente; guard síncrono más botón/estado de lectura. RED real de callbacks,70 focales, frontend3297PASS/1SKIP/0FAIL, build CW_g4KQn y core340PASS/0FAIL/0SKIP. Intento de upload nativo rechazado por permiso de archivos locales de Chrome, sin ampliar permisos; abort/cleanup ENOENT y pestaña cerrada. No hay aceptación nativa FileReader/upload/persistencia de archivos en394. Detalles en CURRENT_ACCEPTANCE.md.
- Integración393: prueba nativa Moodboards de éxito demorado conserva formulario/título/nota en1280/390; POST200→GET200 observados en servidor, advisory real liberada,109 tablas invariantes y cleanup ENOENT/terminal0. Observador opt-in limitado al harness,13 pruebas focales aprobadas; backend2606PASS/174SKIP/0FAIL y core35archivos340PASS/0FAIL/0SKIP, terminal0. Cierra ese caso381/382, no FileReader ni aceptación global. Intento392 abortado y limpiado, no contabilizado como éxito. Detalles y capturas en CURRENT_ACCEPTANCE.md.
- Principal369: `npm run qa:core:local`,29 archivos,288PASS/0FAIL/0SKIP; `/private/tmp/render2-goal369-final-core.log`. Es anterior a los cambios de copy370–371, no una ejecución372.
- Adicional372: MasterC + calendario/proyectos + contenido/objetivos,19PASS/0FAIL/0SKIP, limpieza propia; `/private/tmp/render2-goal372-master-physical.log`.
- Grafo App/Vite372:4PASS, `/private/tmp/render2-goal372-runtime-graph.log`; prueba de imports estáticos, no ausencia demostrada de cualquier comportamiento dinámico posible.
- Frontend370:3224 pruebas `.test.js` aprobadas y build `index-qQy7YpX0`; navegador1280/390 de Reportes con108 tablas invariantes. Sin renovación universal del navegador372.
- CLI372: diagnóstico redactado y17 pruebas aprobadas; conserva timeout5000 y entorno PATH. Diferencia `error.code` y señal sin publicar argumentos, stdout, stderr o mensaje privado del hijo. No explica retroactivamente la causa de la terminación indeterminada371.
- Backend372:2442PASS/168SKIP opt-in/0FAIL de2610, terminal0; `/private/tmp/render2-goal372-final-backend.log`. Las omitidas no se cuentan como pruebas físicas ejecutadas.
- Actualización373: core30archivos291PASS/0FAIL/0SKIP; físicas suplementarias8PASS; frontend3225PASS y backend2445PASS/169SKIP opt-in/0FAIL. Regresión de aprobación histórica y navegador1280/390 acotados,108 tablas nativas invariantes. Logs `render2-goal373-*` en `/private/tmp`; detalle de alcances en CURRENT_ACCEPTANCE.md.
- Verificación374: calendario de siete tareas, «+4 más», Tab/Escape/retorno, apertura task7, día vacío y Nueva tarea limpia comprobados nativamente1280/390,108 tablas invariantes y cleanup.34 focales aprobadas; sin nuevo producto ni renovación global. Cierra el caso «más» pendiente336, no toda la accesibilidad del sistema.
- Integración375: cuatro lectores de Inicio descartan la conexión si falla el rollback, sin ocultar el error original.56 focales,23 físicas adicionales de Inicio y core30archivos293PASS/0FAIL/0SKIP; backend2461PASS/169SKIP/0FAIL. La física de estados amplía Reportes a Calendario/Cliente/Proyecto, ambos actores cookie y108 tablas invariantes. Sin nueva UI/build ni prueba física de caída de red. Logs render2-goal375-*; detalle en CURRENT_ACCEPTANCE.md.
- Integración376: registro y reporte de Producciones proyectan aprobación efectiva.63 focales; física ampliada11PASS y core30archivos299PASS/0FAIL/0SKIP; backend2461PASS/169SKIP/0FAIL. Seis tareas audiovisuales separadas de las seis de proyecto y video sin vínculo NULL,108 tablas invariantes. No nueva observación visual ni publicación real.
- Integración377: resumen de trabajo de Wilson reutiliza aprobación canónica sin mutar tareas;57 focales, física11PASS y core30archivos299PASS/0FAIL/0SKIP; backend2467PASS/169SKIP/0FAIL.108 tablas invariantes, ninguna llamada de mensajería/proveedor. La física evalúa modelos reales sobre DTO HTTP, no POST conversacional ni su autorización.
- Integración378: prioridad, digest y contexto rápido de Mía alinean aprobación histórica sin escrituras ni envío de avisos.49 focales, física11PASS, core30archivos299PASS/0FAIL/0SKIP y backend2470PASS/169SKIP/0FAIL.108 tablas invariantes. La revisión transversal detecta confirmación legacy sin revalidar membresía y pérdida potencial de borrador Moodboards, pendientes abajo.
- Integración379: confirmación web legacy revalida autoridad y membresía vigente, con orden actor→tarea→token y ACL posterior bajo READ COMMITTED.16 unitarias,6 físicas (incluida retirada de asignación durante espera comprobada por pg_blocking_pids), core31archivos305PASS/0FAIL/0SKIP; backend2486PASS/170SKIP/0FAIL. Rechazos sin consumo ni DML; positivo conserva registro/audit/mensaje/replay. No aceptación de proveedor/navegador ni TTL durante espera.
- Integración380: reloj actual y consumo condicional por actor/token/vigencia antes de ejecutar,22 unitarias dentro de36 focales; física8PASS, dos vencimientos durante espera real (tarea/token) con108 tablas invariantes; core31archivos307PASS/0FAIL/0SKIP; backend2492PASS/170SKIP/0FAIL. Se autoriza vigencia al claim, no se exige COMMIT previo a expires_at. Sin proveedores/navegador/migraciones ni despliegue.
- Integración381: Moodboards protege formulario/recuperación e imagen en lectura frente a preparación tardía.26 callbacks AST, frontend3251PASS y backend2492PASS/170SKIP/0FAIL; build index-CWnRw1Ja. Sin nuevo core/fixture físico/navegador; no confundir callbacks con aceptación nativa de la carrera.
- Verificación382 parcial: navegador1280/PG propio, advisory lock y waiter reales; statement_timeout15000 ocurrió antes de liberar. Borrador/textos se conservaron y108 tablas quedaron invariantes, cleanup terminal0/ENOENT. No prueba éxito demorado ni móvil/FileReader. Control de Chrome se interrumpió en confirm de descarte; pestaña/viewport pendientes de restaurar, usuario avisado. Detalle en CURRENT_ACCEPTANCE.md.
- Integración383: confirmación de mensaje retiene el mismo destinatario activo por ID antes del claim;26 unitarias dentro de40 focales, física12PASS con desactivación durante espera real, core31archivos311PASS/0FAIL/0SKIP y backend2496PASS/170SKIP/0FAIL. Solo mensajes internos de fixture; sin proveedor, navegador ni política nueva de destinatarios. Mi lista tiene duplicación pendiente tras ACK perdido en Agregar bloque.

Los logs en `/private/tmp` son evidencia efímera, no respaldo del negocio. Las pruebas solo acreditan las afirmaciones que realmente contienen.

Integración391: recupera el control Chrome cerrando confirm sintético382/rechazando contraseña QA; viewport restaurado y pestaña vieja retirada. Recorrido nativo Mi lista en1280/390 crea/edita/recarga con cookie edición y PostgreSQL109 tablas; ambos fixtures terminal0/ENOENT y privados ajenos intactos. Corrige panel móvil que no cerraba al elegir la página actual; RED nativo+callback,8 nuevas/28 focalesPASS, frontend3291PASS/1SKIP/0FAIL, build BVpPcc3y y core35archivos340PASS/0FAIL/0SKIP. Capturas en QA391_MI_LISTA_*.jpg y QA391_RAIL_BEFORE.jpg. No prueba todos los roles/dispositivos, pérdida de ACK nativa ni carreras Moodboards pendientes; sí queda resuelto el bloqueo del control visual. Sin backend/migraciones/proveedores activados ni despliegue.

Integración390: reproduce40P01/HTTP500 y corrige la inversión preview/confirm del lote mediante scope advisory por informante/grupo, hint no autoritativo+reread exacto y task locks ascendentes. Conserva orden visible y política admin.19 unidades/120 focalesPASS, backend2598PASS/175SKIP/0FAIL; física nueva1PASS con carrera y stale hint/109 tablas y16 anterioresPASS. Core35archivos340PASS/0FAIL/0SKIP, terminal0. Inventario Chrome recuperable pero getTab QA382 vuelve a timeout/reset; ningún nuevo éxito visual/restauración. No acredita ausencia global de deadlocks ni permisos/proveedores/dispositivos reales; sin UI, migración o despliegue.

Integración389: preview del lote Wilson captura sujeto/IDs y retiene identidad actual antes de tareas o reemplazo de tokens.13 unidades/98 focalesPASS, física16PASS con revocaciones durante espera y token previo/109 tablas preservados; backend2579PASS/174SKIP/0FAIL. Core34archivos339PASS/0FAIL/0SKIP, terminal0. Sin nueva política comercial/proveedor/UI/migración/despliegue. Pendiente independiente: reproducir inversión de orden preview tareas→tokens frente a confirm token→tareas; no afirmar concurrencia completa desde la protección de identidad.

Integración388: confirmación del lote Wilson valida scope actual bajo lock incluso si updated_at no cambió; workspace ajeno/ausente y archivo/papelera true o stringtrue rechazan404 todo el lote antes del claim.32 unidades/85 focalesPASS, física13PASS/109 tablas invariantes, backend2566PASS/174SKIP/0FAIL. Core34archivos336PASS/0FAIL/0SKIP, terminal0. Identidad y TTL386/387 conservados; preview no recibe una nueva garantía transaccional por este guard. Sin UI, migraciones, proveedores ni despliegue.

Integración387: TTL del lote firmado Wilson usa reloj real y consumo condicional inmediatamente antes de la primera escritura en las tres ramas.23 unidades/76 focalesPASS, física9PASS con vencimientos futuros durante esperas actor/token/tarea y109 tablas invariantes; casos386 conservados. Revisiones independientes sin bloqueantes. Vigencia al claim, no necesariamente al COMMIT. Backend2557PASS/174SKIP/0FAIL; core34archivos332PASS/0FAIL/0SKIP, terminal0. Scope/ocultamiento de tareas y preview siguen pendientes; no proveedores, UI, migración ni despliegue.

Integración386: confirmación de lote Wilson captura la identidad antes del lease y retiene actor activo/vínculo WhatsApp/rol vigente antes del token.17 unidades nuevas,70 focalesPASS y física firmada6PASS con revocaciones durante espera real/109 tablas; backend2551PASS/174SKIP/0FAIL. Core ampliado34archivos329PASS/0FAIL/0SKIP, terminal0. No cambia quién revisa ni destinatarios; TTL durante espera y validación explícita de workspace/ocultamiento al confirmar siguen pendientes separados. Sin proveedor, navegador, migración ni despliegue.

Integración385: Drive no elige automáticamente la primera carpeta si hay duplicados normalizados o listado parcial. Exige ID/MIME válidos y coincidencia única; proveedor conserva metadatos de completitud.53 focalesPASS,24 físicas DrivePASS (nueva5 renovada/109 tablas invariantes) y backend2534PASS/173SKIP/0FAIL. Sin red a Google, sin nuevas UI/migración/build/core; límites en CURRENT_ACCEPTANCE. La integración real del proveedor sigue pendiente de autorización y no se declara certificada.

## Prioridad372 corregida373: proyección de aprobación en Reportes

Hallazgo de Harvey y reproducción del coordinador sobre funciones reales sin DB: tarea con `estado='en_revision'` y `propiedades_extra.revision_aprobada === true` se proyecta como aprobada por `effectiveTaskFilterState`, pero `buildEmployeeReport` la cuenta en revisión1/aprobadas0 y `employeeTaskDetails` conserva solo el estado crudo. Fuentes: `frontend/src/shared/reports/production-registry-report.js:37`, `:133`, `:143`; contrato compartido `features/render-os/utils/task-view-state.js:17` y `backend/src/task-review-query.js:19`.

Corrección373: métricas y detalle reutilizan `effectiveTaskFilterState`; el detalle conserva `estado_almacenado` separado. Booleantrue cambia solo lectura a aprobada; stringtrue/false/ausencia no lo hacen. No reescribe históricos ni suma aprobadas a finalizadas o confirmaciones editoriales. Modelos/SSR, PostgreSQL con cookies admin/editor y navegador1280/390 verifican los casos acotados;108 tablas del fixture nativo quedan invariantes. El defecto está corregido localmente, **sin declarar fase2/5 cerrada**. Resultados completos de373 en CURRENT_ACCEPTANCE.md.

## Decisiones y gates externos

Corrección local384: Agregar bloque en Mi lista incorpora UUID/recibo093, verificación GET, retry explícito del mismo intento y tombstone. Cookies/PostgreSQL/modelos reales y upgrade pre093 preservan privados e históricos. Core renovado33archivos323PASS/0FAIL/0SKIP; frontend3272PASS, backend2514PASS/172SKIP opt-in y build válido. Se conservan en CURRENT_ACCEPTANCE los intentos fallidos y la limpieza autorizada de31 segmentos IPC huérfanos; servicio activo intacto. Detalle en PERSONAL_BLOCK_CREATION_CONTRACT.md y CURRENT_ACCEPTANCE.md. Falta aceptación nativa de esta recuperación y de la carrera Moodboards382; no atribuir estas pruebas a dispositivos/proveedores o consumidores externos no actualizados.

Corrección379: confirmación web legacy retiene actor y revalida workspace/membresía después del lock, en READ COMMITTED. Corrección380: vencimiento mediante reloj actual y claim condicional justo antes de ejecutar acción; cookie/PostgreSQL prueban token que vence mientras espera tarea y mientras espera token, ambas409 sin consumo ni cambios en108 tablas. No implica certificar TTL de todos los transportes o COMMIT previo al vencimiento. Corrección381 de Moodboards: fence de observaciones/owners y protección de FileReader pendiente evita que preparar clientes descarte editores modificados/abiertos durante la espera;26 callbacks AST aprobados, pendiente navegador nativo de la carrera. Detalle y límites en CURRENT_ACCEPTANCE.md. No confundir estos pendientes con decisiones externas.

Corrección local376: Producciones reutiliza la proyección canónica de tarea_estado en registro y reporte, con booleantrue estricto, publicada y NULL preservados.63 focales y física11PASS, ambos cookies/108 tablas invariantes. Corrección377: buildEmployeeSnapshot de Wilson reutiliza isTaskApproved para no clasificar la aprobación histórica también en revisión;57 focales y física11PASS sobre DTO real congelado,108 tablas invariantes. No se enviaron mensajes ni se acredita el endpoint conversacional, otros contextos de Wilson, aceptación visual renovada o coherencia universal. Detalle en CURRENT_ACCEPTANCE.md.

1. Definir destinatarios extra de revisión de carruseles: pregunta humana pendiente371. El binding de transporte por ID no decide quién revisa. No inferir cuentas por nombre ni conceder autoridad para resolverlo.
2. Verificar/provisionar roster real y cuentas independientes autorizadas; cuentas QA demuestran capacidad del servidor, no existencia de las cuentas reales del equipo.
3. Aceptar integración Drive/proveedores con sus cuentas autorizadas. Mocks no prueban accesibilidad de carpetas comerciales.
4. Aceptación visual/accesible poblada restante y pruebas entre dispositivos independientes.
5. Antes de cualquier despliegue: destino explícito, origen/TLS/proxy, secretos, backups/restauración, ensayo de migraciones sobre copia autorizada y aprobación humana. No hay autorización de despliegue ni acceso de escritura a producción.

Coordinación372: Main verifica recorridos/evidencia e integra; Hilbert revisa backend/seguridad/persistencia y diagnóstico CLI; Harvey revisa frontend/secciones/grafo y detecta el desfase de Reportes. No se modifica el alcance final para convertir estos cierres parciales en éxito global.
