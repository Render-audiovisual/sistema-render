# Diálogos editoriales compartidos — corte279

## Validación nativa y retorno del día — corte280

App279/build_84jHvWk y backend278, Chrome, PG55909/HTTP52854 propios. Una publicación SQL sintética del28octubre (lista, sin evento editorial) antes del baseline. Ruta real calendario mensual; abrir número28→fila de día→Ver publicación genera tres dialog[open] que cumplen :modal. Foco inicial del registro en h2; Tab pasa a X; Tab desde checkbox avanza a Cerrar del footer sin interferencia del padre; extremos X ShiftTab→Actualizar y Actualizar Tab→X correctos. El datetime-local mantiene foco DOM al recorrer sus segmentos: no afirmar salto directo input→checkbox. No se cambió ningún campo.

Escape registro deja dos capas y enfoca Ver publicación; Escape pieza deja día y enfoca su fila. En390×844 registro343px, cierre46.59×44, document.scrollWidth375/innerWidth390; captura `/private/tmp/render2-goal280-editorial-mobile.png` inspeccionada, además de desktop homónima. Esto valida el registro de279, no todos los tamaños/roles, busy, refresh, intentos inciertos o scroll largo. No se observaron por traza todas las solicitudes; invariantes persistidos no equivalen a cero sentencias ejecutadas.

Defecto reproducido: Escape del último día devolvió foco a BODY. El número era span y la celda div no enfocable. Corregido en Publicaciones: número como botón nativo nombrado por ISO, deshabilitado sin piezas; abrirDia retiene invocador y Modal devuelve foco explícitamente. Fondo de celda suministra botón del header y “más” se conserva como invocador. Ambos botones tienen keyISO para no reutilizar un nodo para otra fecha al cambiar mes. Si el control desaparece/queda deshabilitado se omite retorno; no hay fallback nuevo. No cambia fechas/requests/selección vacía/guardados.

Tres tests iniciales rojos→verdes y cuarto posterior para keyISO;60focales PASS,2973frontendPASS/1SKIP opt-in/0FAIL; build final BYJ2pogN y diffcheck correctos. Logs `/private/tmp/render2-goal280-{red,focal-final,frontend-final,build-final}.log`. Apple UI/Frontend Design orientaron botón44 y foco visible, Superpowers/Verification el aislamiento. Harvey revisó sin bloqueo funcional; señaló medir layout calendario móvil. El CSS global previo ya impone min-width760 al calendario bajo760px; no se acepta su comodidad/overflow ni interacción con el nuevo header44 solo por inspección.

Antes de modificar build, fixture280 terminó: PID95151/hijo95177 verificados, salida0/105hashes dominio y contadores invariantes/index279 intacto/cleanup ENOENT KcfOHt; pestaña1976878926 cerrada y viewport restaurado. Fixture280B nuevo PG55910/HTTP52855/build intermedio BV2pm2QY quedó listo, pero crear pestaña y getState agotaron espera: no se obtuvo observación post-fix ni se reinició la base por timeout. PID95650/hijo95674 verificados y terminados; salida0/105hashes/counters/index intactos/cleanup ENOENT ktTFlp. Logs `/private/tmp/render2-goal280-native.log` y `render2-goal280b-native.log`. Pestaña posterior/reset no confirmados; tab anterior276 estaba presente antes, no se modificó.

El arreglo final BYJ2pogN **no está validado físicamente**. Pendiente Escape día→botón ISO, activación Enter/Espacio, cambio de contexto con ref, móvil del calendario y gates restantes. Sin nueva regresiónbackend280 (279 vigente), migraciones de producto, proveedores, bases configuradas o despliegue; objetivo global incompleto.

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
