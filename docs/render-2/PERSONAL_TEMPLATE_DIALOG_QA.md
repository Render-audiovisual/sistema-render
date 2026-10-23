# Revisión 154: diálogos compartidos para plantillas personales

## Implementación local

`Modal.jsx` incorpora modo nativo opt-in (`native`), sin migrar automáticamente los callers existentes. Usa showModal/top layer, foco inicial configurable, cierre con el estado busy vigente y restauración del invocador solo si sigue conectado, habilitado y fuera de inert. Añade ciclo explícito de Tab/ShiftTab entre controles visibles/habilitados; sin controles, enfoca el diálogo. Escape/cancel y backdrop consultan el callback/closeDisabled actuales, no una captura obsoleta.

TemplateDialog y NameTemplateDialog de PersonalLists usan ese componente. Se conservan tarjetas, tamaños y contenido, evitando un rediseño ajeno a esta corrección. El nombre recibe foco al abrir; guardado bloquea input, submit y cierre. El picker bloquea elección, borrado y cierre durante operaciones estructurales. Los padres comprueban además pendingSaves síncrono para no depender únicamente del próximo render. Submit ignora blanco y saving y conserva trim.

`Modal.css` contiene solo presentación nativa opt-in y cierre táctil44×44 con foco visible. PersonalLists.css deja de mantener el overlay privado y sus headers se adaptan al compartido. Los modales div anteriores no adquieren top layer ni focus trap automáticamente; esta revisión no certifica todos los diálogos del sistema.

No hay cambios de API, esquema, permisos, dependencias, backend ni persistencia comercial local. El guardado sigue usando la API/cola existentes y PostgreSQL. No hubo despliegues ni bases reales.

## Coordinación y skills

- Integrador: Modal.jsx/css, PersonalLists.jsx/css, revisión de CSS y prueba nativa.
- Carver: modal-native.test.js, 15 casos simulados/SSR sobre el componente real, limpieza/foco, busy actual y ciclo explícito.
- Hypatia: personal-template-dialog.test.js, 7 casos SSR/AST de controles/callbacks, trim, submit y guards síncronos.
- Beauvoir: revisión independiente favorable de opt-in, cierre actual, cleanup y padres, sin ediciones.
- Skill de trabajo estructurado: separación de contratos, pruebas y límites. Frontend-design: reutilización deliberada del estilo existente y eliminación de chrome duplicado, sin introducir nueva paleta/tipografía.

## Evidencia

- Suite frontend final: 2.130 aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build local satisfactorio: `index-qJnASmb-.js`; git diff --check satisfactorio.
- La primera prueba nativa detectó ShiftTab desde el primer control dejando activeElement en body. Se añadió wrap explícito. Una recarga posterior seguía mostrando el bundle anterior porque server.js conserva indexHtml en memoria al arrancar; se verificó el script cargado y se reinició un fixture nuevo. No se atribuyó el resultado viejo a la corrección nueva.
- En el candidato `index-CDrh2yc_.js` se verificó el ciclo corregido, Escape, foco restaurado y guardado de plantilla seguido de reload. Luego se ajustó el área táctil y se repitió con fixture/bundle final.
- Bundle FINAL verificado en navegador: script `index-qJnASmb-.js`, dialog.matches(':modal') true, foco inicial en input Nombre, cierre44×44; guardar QA154 Plantilla final por API real, reload y presencia en Mis plantillas. Picker final: ShiftTab desde Cerrar enfoca el último control, Tab vuelve a Cerrar; Escape cierra y devuelve foco a Crear página.
- Visual/DOM escritorio1280×720 y móvil390×844: documento sin overflow horizontal. Panel móvil dentro de viewport: left16/right374/top146/bottom698. Capturas inspeccionadas: `/private/tmp/render2-templates154-release-desktop.jpg` y `/private/tmp/render2-templates154-release-mobile.jpg`.
- Backend real, cookie de dueño sintético y PostgreSQL nuevo propio puerto55802/HTTP52785 mediante script revisado `/private/tmp/render2-personal153-native.mjs`. Cada ejecución creó otra base; nunca se reusó una base existente. Títulos y propietarios de listas1/2 quedaron originales. Solo se añadieron plantillas desechables en fixtures; no hubo eliminación de listas ni modificación de registros reales.
- Tres procesos propios terminados con SIGTERM tras identificar su PID en ready:44425,44768,44898. Cleanup ENOENT y ausencia posterior confirmados para `/private/tmp/render2-local-Pf6TiJ`, `/private/tmp/render2-local-q2JmF9`, `/private/tmp/render2-local-2emOBD`. Pestañas propias132/133/134 cerradas; viewport restaurado. Sin CDP, emulación de red ni modificaciones de páginas del usuario.
- Logs finales temporales: `/private/tmp/render2-templates154-verified-frontend.log`, `/private/tmp/render2-templates154-release-build.log`, `/private/tmp/render2-templates154-release-native.log`. Backend sin cambios ni nueva corrida completa de backend.

## Límites y siguientes gates

Busy y fallos de apertura/cleanup se comprobaron mediante funciones reales con DOM simulado, no mediante una petición nativa retenida. El recorrido nativo cubre éxito con plantilla vacía y teclado en el navegador disponible, no todos los motores, lectores de pantalla o plantillas con bloques complejos. No certifica que cada modal heredado sea accesible; siguen con modo legacy mientras no se migren y prueben.

Siguen pendientes filtros de Seguimiento y la revisión transversal de recorridos/arquitectura/diseño contra el prompt maestro. Esta corrección no completa el rescate global ni acredita preparación de producción. Estado: implementado y verificado localmente, no desplegado.
