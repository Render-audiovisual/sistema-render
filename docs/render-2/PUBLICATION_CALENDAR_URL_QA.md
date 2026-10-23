# Revisión 152: contexto compartible del calendario editorial

## Implementación local

`PublicacionesPage` es ahora el único propietario de la vista Mes/Semana y filtro de tipo del calendario. Inicializa desde URL, pasa controles al hijo y restaura ambos con popstate. Los cambios voluntarios verifican sesión vigente y consentimiento de navegación antes de alterar historial o estado. Cambios sin efecto no generan entradas.

`publicationCalendarContext.js` define valores cerrados: `cal_vista=semana` y `cal_tipo=video|carrusel`; Mes/Todos son defaults y se omiten de la URL canónica. Valores desconocidos normalizan a defaults; duplicados usan el primer valor y se colapsan al canonicalizar. No son parámetros de autorización. Tab, cliente, mes, query ajena y hash se preservan mediante el helper existente.

No se añaden tareas, piezas ni persistencia comercial en navegador. Los datos siguen leyéndose del backend; solo preferencias de presentación viajan en la URL. No se modifican estados, permisos, backend, esquema o estilos. No se despliega nada.

## Coordinación

- Integrador: Publicaciones.jsx, helper de contexto y adaptación del contrato del toolbar al callback controlado del padre.
- Carver: publication-calendar-context.test.js, 9 pruebas puras y de callbacks/efectos reales extraídos con AST.
- Beauvoir: revisión independiente favorable de fuente única, consentimiento previo, normalización y restauración, sin edits.
- Poincare: diagnóstico de selección en Mi lista, sin cambios; próximos requisitos documentados abajo.

## Evidencia

- Suite frontend final: 2.096 aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build local satisfactorio, `index-C3SYrAVY.js`; git diff --check satisfactorio. Dos pruebas del toolbar actualizadas conservando opciones y SSR/accesibilidad al sustituir el setter local por el callback del padre.
- Navegador real sobre bundle compilado, sesión cookie sintética y backend/PostgreSQL nuevo propio. Se reutilizó el script revisado `/private/tmp/render2-publications151-native.mjs`, que en cada ejecución crea un cluster distinto, no su base previa.
- Enlace directo Semana/Reels con `qa=preservar#agenda` abrió los controles y contenido correctos. Cambiar Carruseles y Mes alteró la URL. Reload conservó Mes/Carruseles. Back restauró Semana/Carruseles y luego Semana/Reels; Forward restauró Semana/Carruseles. Cambiar a Seguimiento y volver a Calendario conservó ambos parámetros. Query ajena/hash se conservaron durante todo el recorrido.
- Verificación de controles, DOM y geometría a 390×844 y 1280×900 sin overflow horizontal. Capturas inspeccionadas: `/private/tmp/render2-navigation152-mobile.jpg` y `/private/tmp/render2-navigation152-desktop.jpg`. La primera captura inmediata al resize fue transitoria; se sustituyó por captura posterior con DOM y dimensiones verificados, no se usa como evidencia.
- SQL final: pieza sintética pendiente, copy/idea originales, publicación real nula, cero eventos de publicación y tareas; conteos sin cambios. Sin escrituras operativas desde el recorrido.
- Viewport restaurado y pestaña propia130 cerrada. PID41569 identificado por comando exacto y terminado con SIGTERM; cleanup ENOENT y ausencia posterior de `/private/tmp/render2-local-uIpJgw` confirmados. No se usó emulación de red ni CDP en esta prueba.
- Logs temporales: `/private/tmp/render2-navigation152-final-frontend.log`, `/private/tmp/render2-navigation152-build.log`, `/private/tmp/render2-navigation152-native.log`. Backend sin cambios ni nueva corrida completa en esta revisión.

## Pendientes reales

Esta revisión cubre los controles del calendario, no todos los filtros de Seguimiento ni otros sectores. La selección de Mi lista sigue en memoria: requiere URL `/lista?lista=ID`, IDs BIGSERIAL decimales conservados como string (sin Number/int32), estado explícito para ID inválido/no disponible y no fallback silencioso a otra lista. Debe integrar consentimiento con la cola global sin interpretar autorización para salir como descarte/guardado oculto. Popstate no debe pedir un segundo diálogo; delete fallido conserva selección/URL y delete confirmado retira únicamente el ID eliminado sin segundo veto. Requiere pruebas de ID bigint, cola/drafts, sesión, creación/eliminación y navegación nativa antes de considerarlo corregido.

El diálogo de plantillas y gates visuales/funcionales globales del rescate siguen abiertos. Las pruebas de esta revisión no certifican toda la navegación ni preparación para producción. Estado: implementado y verificado localmente, no desplegado.
