# Render 2.0 — corte de aceptación local372, actualizado383

Fecha: 2026-10-25. Base revisada372: `5ec8f11`; diagnóstico372: `fc36679`; la actualización373 corrige la proyección de Reportes descrita abajo. Rama `codex/render-2-rescue-local`. **El objetivo maestro no está completo ni aprobado para despliegue.** Este documento es un índice compacto; [CURRENT_ACCEPTANCE.md](CURRENT_ACCEPTANCE.md) conserva resultados, límites e intentos fallidos por integración.

## Resultado de las fases

| Fase solicitada | Estado comprobado | Lo que impide cerrarla globalmente |
|---|---|---|
| 0. Preparación segura | Worktree aislado; cambios ajenos preservados; harness con entorno limpio e identidad PostgreSQL propia; arranque separado de migraciones | No se ha aceptado un destino real ni ensayo sobre copia comercial autorizada. No usar esa ausencia como permiso para probar otra base. |
| 1. Seguridad y negocio | Identidad/rol/actividad/época del servidor, cookies/contexto/CSRF; DTO operativo sin dinero para todos en Reportes; Finanzas independientes; trabajo distinto de publicación | Roster real no sustituido por cuentas QA. La política de destinatarios de revisión sigue pendiente de decisión humana. |
| 2. Unificación | Un grafo comercial React/Vite → Express → PostgreSQL; tareas, clientes/cuotas, proyectos, registro audiovisual por video y editorial conectados; proyección de aprobación de Reportes corregida373 | Proveedor Drive real no certificado; aceptación transversal todavía parcial. |
| 3. Diseño | Tokens y componentes compartidos, rutas reales, sidebar agrupada, modo claro; recorridos nativos concretos de escritorio/móvil | No hay aceptación poblada transversal de todas las secciones/roles, lectores de pantalla, zoom, teclado y dispositivos físicos independientes. |
| 4. Funciones y experiencia | Persistencia, versiones, recibos, filtros, comentarios, protección de borradores y recuperación implementados por módulos | Reconciliar consumidores históricos restantes; avisos de revisión aún dependen de etiquetas. No afirmar que todo error de conexión/concurrencia esté cubierto. |
| 5. Punta a punta | Cohorte fija31 archivos; recorridos A–F parcialmente acreditados con alcances explícitos abajo | Pruebas sintéticas/API y un navegador no equivalen a múltiples dispositivos, cuentas reales, proveedores ni aceptación completa. |

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

## Prioridad372 corregida373: proyección de aprobación en Reportes

Hallazgo de Harvey y reproducción del coordinador sobre funciones reales sin DB: tarea con `estado='en_revision'` y `propiedades_extra.revision_aprobada === true` se proyecta como aprobada por `effectiveTaskFilterState`, pero `buildEmployeeReport` la cuenta en revisión1/aprobadas0 y `employeeTaskDetails` conserva solo el estado crudo. Fuentes: `frontend/src/shared/reports/production-registry-report.js:37`, `:133`, `:143`; contrato compartido `features/render-os/utils/task-view-state.js:17` y `backend/src/task-review-query.js:19`.

Corrección373: métricas y detalle reutilizan `effectiveTaskFilterState`; el detalle conserva `estado_almacenado` separado. Booleantrue cambia solo lectura a aprobada; stringtrue/false/ausencia no lo hacen. No reescribe históricos ni suma aprobadas a finalizadas o confirmaciones editoriales. Modelos/SSR, PostgreSQL con cookies admin/editor y navegador1280/390 verifican los casos acotados;108 tablas del fixture nativo quedan invariantes. El defecto está corregido localmente, **sin declarar fase2/5 cerrada**. Resultados completos de373 en CURRENT_ACCEPTANCE.md.

## Decisiones y gates externos

Pendiente local383: Agregar bloque en Mi lista puede duplicar tras ACK perdido; callbacks reales con servidor simulado y fuente de POST sin recibo, todavía sin parche/prueba PostgreSQL. No confundir con Crear página, que ya conserva su intento. La nueva corrección de destinatario activo en confirmaciones no cierra este pendiente de persistencia.

Corrección379: confirmación web legacy retiene actor y revalida workspace/membresía después del lock, en READ COMMITTED. Corrección380: vencimiento mediante reloj actual y claim condicional justo antes de ejecutar acción; cookie/PostgreSQL prueban token que vence mientras espera tarea y mientras espera token, ambas409 sin consumo ni cambios en108 tablas. No implica certificar TTL de todos los transportes o COMMIT previo al vencimiento. Corrección381 de Moodboards: fence de observaciones/owners y protección de FileReader pendiente evita que preparar clientes descarte editores modificados/abiertos durante la espera;26 callbacks AST aprobados, pendiente navegador nativo de la carrera. Detalle y límites en CURRENT_ACCEPTANCE.md. No confundir estos pendientes con decisiones externas.

Corrección local376: Producciones reutiliza la proyección canónica de tarea_estado en registro y reporte, con booleantrue estricto, publicada y NULL preservados.63 focales y física11PASS, ambos cookies/108 tablas invariantes. Corrección377: buildEmployeeSnapshot de Wilson reutiliza isTaskApproved para no clasificar la aprobación histórica también en revisión;57 focales y física11PASS sobre DTO real congelado,108 tablas invariantes. No se enviaron mensajes ni se acredita el endpoint conversacional, otros contextos de Wilson, aceptación visual renovada o coherencia universal. Detalle en CURRENT_ACCEPTANCE.md.

1. Definir destinatarios extra de revisión de carruseles: pregunta humana pendiente371. El binding de transporte por ID no decide quién revisa. No inferir cuentas por nombre ni conceder autoridad para resolverlo.
2. Verificar/provisionar roster real y cuentas independientes autorizadas; cuentas QA demuestran capacidad del servidor, no existencia de las cuentas reales del equipo.
3. Aceptar integración Drive/proveedores con sus cuentas autorizadas. Mocks no prueban accesibilidad de carpetas comerciales.
4. Aceptación visual/accesible poblada restante y pruebas entre dispositivos independientes.
5. Antes de cualquier despliegue: destino explícito, origen/TLS/proxy, secretos, backups/restauración, ensayo de migraciones sobre copia autorizada y aprobación humana. No hay autorización de despliegue ni acceso de escritura a producción.

Coordinación372: Main verifica recorridos/evidencia e integra; Hilbert revisa backend/seguridad/persistencia y diagnóstico CLI; Harvey revisa frontend/secciones/grafo y detecta el desfase de Reportes. No se modifica el alcance final para convertir estos cierres parciales en éxito global.
