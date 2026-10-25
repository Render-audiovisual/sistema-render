# Diálogos editoriales compartidos — corte279

## Integración

`EditorialPublicationControl.jsx` conserva el portal a body, pero monta Modal native en lugar de overlay/section propios. Mantiene ep-overlay/ep-dialog, encabezado y foco inicial mediante ref al título; retorno explícito al botón invocador. Modal centraliza Escape/cancel, límites de Tab y bloqueo busy. Se elimina el listener global capture y el efecto de foco `[open,busy]`, que podía restaurar/refocalizar al cambiar busy. Cierre no borra el intento incierto ni cambia la regla de reapertura sin load. No añade cierre por backdrop.

Los diálogos de día y pieza de `PublicacionesCalendarioTab` usan también Modal native y nombres accesibles. Migrarlos sin el registro compartido habría dejado el portal custom potencialmente inerte detrás del padre nativo. Se trasladó primero esa dependencia, no se eliminó una función editorial. CSS específico conserva grid, ancho480, padding24 y scroll del registro; la verificación visual está pendiente, no demostrada por esas declaraciones.

## Defecto común corregido

Los portales mantienen ascendencia React aunque su DOM viva en body. Tab intermedio del hijo podía llegar al handler del padre; al observar foco externo a su DOM, el padre intentaba enfocar sus controles inertes. `Modal.jsx` detiene propagación de Tab antes de comprobar defaultPrevented, preservando el movimiento intermedio del navegador. Escape ya conserva stopPropagation y cancel protegido. Nuevo test ejecuta handlers reales con objetos DOM/effects simulados y reproduce el conflicto antes del parche; no es gesto físico ni DOM React montado.

## Evidencia y límites

Coordinador implementó; Harvey revisión independiente previa/final sin bloqueantes. Superpowers ordenó dependencias; Apple UI/Frontend Design orientaron conservación de escala, estilos y foco. Tres tests nuevos (dos de montaje JSX y uno de propagación), todos rojos antes de implementar.45focales PASS, frontend2969PASS/1SKIP explícito de servidor opt-in/0FAIL y build index-_84jHvWk.js. Regresiónbackend2333PASS/150opt-inSKIP/0FAIL. Todas las ejecuciones finales salida0; diffcheck correcto.

Se actualizaron dos expectativas del chrome anterior. La cobertura de negocio se mantiene con hashes de todas las sentencias no relacionadas con foco/ref de invocador frente a HEAD previo, más hashes independientes de load/save y footer exacto. No se regeneró ciegamente el hash del nuevo markup como prueba de comportamiento. Los modelos de sesión/intento/evidencia siguen cubiertos; no se tocaron estados, fecha programada/real, cuotas, autorización o endpoints.

Logs `/private/tmp/render2-goal279-{red,integration-red,modal,focal-first,focal,frontend,build,backend}.log`. Sin PostgreSQL/HTTP de QA, nuevas migraciones, proveedores, datos reales o despliegue en este corte.

Pendiente: stack físico día→pieza→registro en App conectada, tres niveles :modal, inert, Tab desde título/interior/límites, Escape solo superior (también busy), retorno al invocador y scroll/layout móvil. Pruebas simuladas/hash/build no acreditan esos recorridos ni aceptación global.
