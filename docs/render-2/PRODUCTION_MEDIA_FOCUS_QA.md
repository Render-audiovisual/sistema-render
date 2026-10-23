# Continuidad de teclado al registrar videos y fotos

Producciones devuelve el foco al botón «+ Video» o «+ Fotos» de la misma visita después de confirmar y cerrar el formulario de alta. Esto permite continuar registrando material sin perder la posición de teclado. El cambio está implementado y probado localmente; no modifica escrituras, persistencia, permisos ni tareas de edición.

## Comportamiento y archivos

`frontend/src/pages/Productions.jsx` captura una intención de foco al enviar un formulario nuevo. Solo después de validar el detalle completo devuelto por la escritura puede transferir esa intención a `VisitDetail`. El padre cierra el formulario y, en layout, restaura una sola vez el botón persistente correspondiente. La edición de registros existentes no participa de esta devolución.

`frontend/src/pages/productionMediaFocus.js` exige documento visible, propietario vigente y un formulario inicialmente enfocado. No mueve el scroll ni agrega tabindex. Movimiento de foco externo, nueva interacción de teclado/puntero, documento oculto o pérdida real del foco de ventana cancelan permanentemente la intención. Un modal visible o un botón de destino oculto, inerte, retirado o todavía deshabilitado impiden restaurar.

La confirmación tolera que el botón de destino siga deshabilitado mientras React aún no confirmó `busy=false`; la restauración posterior exige que ya esté habilitado. El blur de un botón deshabilitado no se confunde con salir de la ventana: un listener en captura sobre window también recibe blur de controles descendientes y debe comprobar el destino real del evento.

El hijo dispone inmediatamente los listeners de una intención pendiente cuando se desmonta, aunque la respuesta todavía no haya llegado. Una intención confirmada pasa explícitamente al padre antes del desmontaje esperado; la limpieza del hijo no la cancela. El padre dispone cualquier intención pendiente al desmontarse. Errores, conflictos y respuestas inválidas conservan los campos y no conceden una devolución de foco.

## Pruebas automatizadas

Desde `frontend`:

```sh
node --test src/pages/productionMediaFocus.test.js src/pages/productionMediaFocusIntegration.test.js src/pages/productionDraft.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Resultado: 44 pruebas focales aprobadas, 2241 de frontend aprobadas, cero fallos y cero omitidas. Build correcto con entrada `index-jvhTYBCD.js`. La suite completa detectó un contexto de prueba antiguo que necesitaba el nuevo ref de limpieza; se actualizó ese contexto en `productionDraft.test.js` y se repitió toda la suite satisfactoriamente. No se cambió su expectativa de rechazar escrituras obsoletas.

Los dos archivos nuevos de pruebas verifican el helper real y callbacks/JSX extraídos del componente: altas separadas de video/foto, validación del ACK, rechazo de respuestas inválidas, desmontaje con promesa pendiente, transferencia al padre, cancelación permanente, propietario retirado, destino deshabilitado y limpieza de listeners. Las simulaciones de DOM no acreditan por sí mismas foco real en React.

## Comprobación de componente en navegador

Un servidor temporal de loopback compiló las funciones reales `MediaForm`, `VisitDetail`, `useProductionDraft` y `DraftRecovery`, junto con el helper, el modelo de borrador y las hojas de estilo reales. React se ejecutó en StrictMode. Los paneles ajenos a la prueba se sustituyeron por componentes vacíos y `onWrite` devolvió respuestas sintéticas demoradas. Esta prueba es de componente: no usa API, autenticación ni PostgreSQL, no persiste y no forma parte del enrutamiento operativo.

La primera comprobación reveló que el foco terminaba en BODY. Tras corregir el tratamiento del botón temporalmente deshabilitado, el diagnóstico identificó también la cancelación errónea por blur descendiente. Se agregó una regresión específica y la repetición final verificó:

- Guardar con Enter cierra el formulario y enfoca «+ Video».
- Elegir «Control externo» durante el envío mantiene ese foco después de la respuesta.
- Un error conserva el título y formulario sin restaurar el botón de alta.
- Una respuesta incompleta conserva la ficha de fotos y muestra el error de verificación.
- A 390 × 844, tres altas consecutivas de videos y una de fotos devuelven el foco al botón correcto. Con la hoja base real, el ancho documental fue 390 px. No hubo errores ni advertencias de consola en la repetición final.

La captura `/private/tmp/render2-media161-mobile-final.jpg` muestra el componente aislado con tres videos, una ficha de fotos y «+ Fotos» enfocado. El script temporal es `/private/tmp/render2-media161-browser.mjs`; no es una segunda implementación operativa ni una prueba de persistencia. Se cerraron las pestañas propias, se restauró el viewport y se apagaron los procesos de prueba verificados.

Logs temporales: `/private/tmp/render2-media161-focused-final.log`, `/private/tmp/render2-media161-final-frontend-renewed.log`, `/private/tmp/render2-media161-build.log` y `/private/tmp/render2-media161-browser-final-css.log`.

## Recorrido conectado pendiente por recursos locales

La aceptación nativa completa de una visita con tres videos enviados individualmente a edición sigue abierta. El intento de iniciar un nuevo fixture PostgreSQL no llegó a ready: primero initdb falló por permisos del sandbox; la ejecución autorizada fuera del sandbox falló con `could not create shared memory segment: No space left on device`. La consulta de solo lectura `ipcs` mostró 32 segmentos SysV. Es un límite de recursos del host, no evidencia de fallo del circuito de negocio ni de disco lleno.

Los directorios fallidos `/private/tmp/render2-local-KpLLAu` y `/private/tmp/render2-local-9gWEJk` fueron limpiados por el harness y se verificó su ausencia. No hubo cliente, visita ni tarea creados por ese intento. No se cerraron procesos PostgreSQL ajenos ni se eliminaron segmentos IPC; su procedencia no quedó atribuida de forma suficiente para una limpieza automática segura. Para retomar la aceptación física hace falta resolver ese límite local con revisión del propietario del equipo.

Logs del bloqueo: `/private/tmp/render2-journey161-native.log` y `/private/tmp/render2-journey161-native-escalated.log`. El script preparado `/private/tmp/render2-journey161-native.mjs` no completó un recorrido y no se presenta como evidencia positiva. La prueba física integrada anterior conserva su alcance en `UNIFIED_THREE_VIDEO_JOURNEY_QA.md`.

## Equipo y estado de entrega

Hypatia identificó el defecto y escribió la regresión de integración. Carver implementó el helper y sus pruebas. El integrador conectó los componentes, corrigió el blur descendiente, comprobó React en navegador y ejecutó la regresión completa. Poincare revisó los contratos de handoff, reintento y conservación de revisión sin editar producto; Beauvoir revisó independientemente los ciclos de foco y desmontaje.

No hubo migraciones ni cambios de backend, contratos de API, cuentas reales o proveedores. Backend no se volvió a ejecutar en este corte. Continúan pendientes el recorrido UI conectado completo, drag manual nativo y aceptación visual global. El avance no certifica Render 2.0 completo ni preparado para producción; no se realizó despliegue.
