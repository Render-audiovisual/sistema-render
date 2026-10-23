# Revisión 155: filtros de Seguimiento en URL

## Implementación local

PublicacionesPage controla cliente, mes, estado, responsable y tipo del tab Seguimiento mediante `publicationTrackingContext.js`. Se inicializan/restauran desde URL; las modificaciones parciales verifican sesión y consentimiento antes de push/estado. Defaults se omiten; se preservan filtros del calendario, cliente/mes de planilla, query ajena y hash. Cambiar de tab no reinicia la selección.

Parámetros propios: seg_cliente, seg_mes, seg_estado, seg_responsable, seg_tipo. Cliente usa ID int32 canónico; mes valida formato; estado/tipo provienen de enums existentes. Responsable conserva la etiqueta exacta heredada con límite y sin controles: es filtro de visualización, no identidad ni autorización. No se migran nombres ni registros históricos. Valores desconocidos normalizan a Todos salvo etiquetas/IDs válidos ausentes del inventario, que se muestran como opción explícita para no ocultar un filtro activo.

Los cinco selects tienen nombres accesibles. La lectura rechaza payload no-array, oculta el contador durante carga/error y no presenta tabla vacía ante un fallo de consulta. No se alteran reglas de publicación, estados, permisos, backend, esquema ni persistencia comercial. No hubo despliegue.

## Pruebas

- Carver escribió publication-tracking-context.test.js: 8 pruebas puras y de componentes/callbacks/efectos reales extraídos, incluyendo opciones ausentes y respuesta malformada. Integrador adaptó las pruebas existentes de contexto del calendario preservando sus assertions y verificando la coexistencia de ambos contextos.
- Suite frontend final: 2.138 aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build local satisfactorio `index-Bk6VWet3.js`; git diff --check satisfactorio.
- Navegador real + PostgreSQL nuevo propio55801/HTTP52784, cookie de dueño sintético, script revisado `/private/tmp/render2-publications151-native.mjs`. Enlace con cinco filtros abrió una pieza real coincidente. Cambiar estado a Lista mostró cero válido; reload conservó los cinco filtros; Back recuperó Pendiente/una pieza y Forward Lista/cero. Calendario mantuvo Semana y volver a Seguimiento conservó sus filtros.
- Enlace con cliente999, mes2030-11 y responsable ausente mostró sus tres opciones explícitas, sin volver a Todos. Query ajena y hash se preservaron.
- Visual/DOM a1280×720 y390×844 sin overflow horizontal del documento. La tabla sigue teniendo scroll interno y deuda de diseño/visibilidad de columnas; esto no certifica el diseño global. Capturas inspeccionadas: `/private/tmp/render2-tracking155-desktop.jpg`, `/private/tmp/render2-tracking155-mobile.jpg`.
- SQL final: pieza pendiente, idea/copy originales, publicación real nula, cero eventos/tareas, conteos sin cambios. PID45848 verificado por comando exacto y terminado con SIGTERM. Cleanup ENOENT de `/private/tmp/render2-local-DTcusF`; pestaña propia135 cerrada y viewport restaurado. Sin CDP/emulación de red.
- Logs: `/private/tmp/render2-tracking155-final-frontend.log`, `/private/tmp/render2-tracking155-build.log`, `/private/tmp/render2-tracking155-native.log`. Backend sin cambios ni nueva corrida completa en155.

## Límites

Fallo de lectura y payload malformado cubiertos por pruebas automatizadas, no por una nueva prueba nativa de red. La prueba nativa acredita filtros y datos de un dueño sintético, no todos los roles/datasets. El estado Publicada conserva la semántica raw histórica del filtro; no es prueba de una publicación efectiva. El diagnóstico transversal y las prioridades siguientes están en CURRENT_MASTER_REVIEW_155.md. Objetivo global abierto.
