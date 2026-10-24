# Borradores de piezas y recorrido del editor

El editor de contenido de Clientes y objetivos ahora registra su estado en la protección global de navegación. La implementación pasa las pruebas automatizadas, pero no está aceptada para Atrás del navegador: la prueba nativa salió del editor sin mostrar advertencia. No se debe presentar este cambio como solución completa de pérdida de borradores.

## Implementación y revisión

Hypatia añadió un lector de estado en PieceDetail y cinco pruebas del getter real extraído del JSX junto al kernel de navegación. Poincare revisó el cambio sin encontrar defectos P1/P2 nuevos en ese delta. El coordinador integró y probó el recorrido conectado. Se reutilizó useNavigationGuard sin cambiar guardado, permisos, cierre local, historial ni persistencia.

El lector distingue cambios de título y copy frente al contenido observado, consulta pending.current sin esperar un render y deja de bloquear cuando el ámbito de sesión ya no está vigente. Las cinco pruebas cubren cambios, espera síncrona, descarte cancelado, beforeunload y traversal sintético cancelable. No montan React ni certifican los diálogos del navegador real.

## Navegación pendiente de aceptación

Estado posterior: la recuperación temporal para navegación canónica está implementada y verificada en GOAL_DRAFT_RECOVERY_QA.md. Los intentos originales y sus límites se conservan a continuación; no sustituyen ese resultado vigente ni acreditan cobertura de todas las rutas.

Actualización vigente: NATIVE_GOAL_DRAFT_TRAVERSAL_QA.md registra posteriormente una primera salida cancelable rechazada que conserva el borrador y una segunda salida no cancelable que lo pierde. La conservación global sigue pendiente, pero ya hay traza nativa del mecanismo. Los párrafos siguientes corresponden al intento inicial sin instrumentación.

En el navegador integrado Chrome155 se escribió un copy distinto mediante entrada nativa. tab.back salió a Inicio sin advertencia y perdió ese borrador no guardado. La Navigation API existe, pero no se observaron las propiedades del evento de esa salida. El kernel solo cancela traversal same-document cancelable; no está probado si ese límite explica esta ejecución. No se incorporaron bucles de compensación de historial.

El atajo de Atrás no produjo navegación observable y no cuenta como prueba. Cancelar edición sí invocó el confirm local, capturado por la herramienta; después el editor salió de edición. No se acreditó rechazo del descarte ni conservación nativa mediante ese diálogo. Quedan por verificar la cancelación nativa, la recarga con beforeunload y el origen exacto de la salida silenciosa. El botón de edición ofrecido sobre tareas ajenas continúa como pendiente UX independiente, sin cambio de ACL en este corte.

## Recorrido conectado y tablas móviles

Una sesión QA de edición abrió Clientes y objetivos, su Reel1 y la tarea vinculada1. El detalle mostró el copy previamente guardado, responsable91003 y entrega del25 de octubre. No se enviaron escrituras operativas desde la interfaz.

Reportes mostró dos tareas pendientes del editor, un reel programado y cero confirmaciones manuales. El detalle por persona relacionó la publicación1 mediante la tarea1, sin atribución por nombre. Se desplegaron tanto los registros editoriales generales como Mis piezas asignadas. Esto valida lectura de datos preparados en el fixture, no creación editorial por interfaz ni publicación externa.

A840px el documento midió840px y las tablas conservaron desplazamiento interno. Con viewport390px el documento midió375px de ancho útil y scrollWidth375px. Las tres tablas, incluida la editorial anidada poblada, adoptaron display block y291px de ancho. La captura móvil está en `/private/tmp/render2-goal186-report-mobile.png`. El viewport se restauró y la pestaña de prueba se cerró.

## Regresión e integridad

Pasaron2445 pruebas frontend y1982 backend, con cero fallos;123 integraciones backend optativas quedaron omitidas. El build index-DNzsIwFN.js terminó correctamente. Logs locales: `/private/tmp/render2-goal186-frontend.log`, `/private/tmp/render2-goal186-backend.log` y `/private/tmp/render2-goal186-build.log`.

El harness aislado usó PostgreSQL55846 y HTTP52811, con identidad y directorio propios verificados. Preparó cuotas y tareas mediante API y completó vínculos editoriales con SQL exclusivamente sintético. Los snapshots de nueve tablas permanecieron idénticos después del recorrido. El proceso terminó0 y cleanup verificó ENOENT de `/private/tmp/render2-local-lHxcEQ`. No se tocaron servicios activos, bases configuradas ni producción.

Render2 sigue en desarrollo local, sin aceptación global ni preparación para despliegue. Las guías de trabajo estructurado y verificación mantuvieron separadas implementación, regresión y aceptación nativa; el informe se conserva únicamente en el repositorio.
