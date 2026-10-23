# Revisión 151: lectura fiable de tareas vinculadas en Publicaciones

## Corrección local

En `frontend/src/pages/Publicaciones.jsx`, el detalle del calendario editorial diferencia carga, lectura válida y error. Un fallo HTTP/de red o una respuesta no-array ya no se convierten en un vacío afirmativo. Solo un array válido vacío muestra que no hay tareas disponibles para ese usuario.

La lectura pertenece a la observación exacta de pieza, captura de sesión/contexto e intento. Antes de ejecutar los efectos, el render oculta datos de otra observación. Abort/cleanup y los controles de identidad impiden que una respuesta vieja, incluso tras seleccionar A→B→A, altere la lectura visible. El reintento es explícito, exclusivo del error actual y de solo lectura; un handler retenido de un intento/captura/lectura anterior no conserva capacidad de iniciar otro intento. No hay reintentos automáticos ni cambios de permisos.

Se conserva GET `/api/publicaciones/:id/tareas`, cache no-store y enlaces `/workspace/tareas?task=ID`. No se alteran backend, estados editoriales, confirmaciones de publicación, calendario ni base de datos. Los registros compartidos continúan en PostgreSQL; no se introduce persistencia comercial en el navegador.

## Coordinación

- Integrador: componente Publicaciones y prueba nativa/compilación.
- Carver: actualización de publicaciones-session.test.js, 34 pruebas del archivo aprobadas; 6 casos nuevos cubren error/vacío/datos, respuestas obsoletas y reintentos.
- Beauvoir: revisión independiente favorable de propiedad de lectura, ABA/sesión y reintento, sin ediciones.
- Poincare: script temporal de fixture nativo; no modificó producto ni inició servicios. Integrador revisó y ejecutó el harness.

## Pruebas y evidencia

- Suite frontend completa: 2.087 pruebas aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build local satisfactorio, bundle `index-B-vtaoII.js`; `git diff --check` satisfactorio.
- Navegador real con sesión cookie de administrador sintético, backend real y PostgreSQL nuevo propio, puerto55801/HTTP52784. Se bloqueó exclusivamente la URL de lectura de tareas de la pieza sintética mediante CDP, sin fabricar respuestas del servidor. El modal mostró error con Reintentar, no un vacío afirmativo.
- La llamada de automatización que incluyó el bloqueo/apertura demoró anormalmente 4.233 segundos antes de devolver el DOM. No se atribuye esa demora al tiempo de respuesta normal del producto ni se repitió la prueba. Se retiró el bloqueo inmediatamente después; el clic explícito en Reintentar consultó al servidor y mostró el array vacío válido.
- Comprobación visual y DOM a 435×764 (móvil) y 1280×900 (escritorio), sin overflow horizontal del documento. Esto acredita este detalle, no todo el sistema ni todos los estados responsive.
- Capturas locales: `/private/tmp/render2-publications151-error.jpg`, `/private/tmp/render2-publications151-retry.jpg`, `/private/tmp/render2-publications151-desktop.jpg`.
- SQL final del fixture: pieza pendiente, copy/idea originales, fecha real de publicación nula, cero eventos de publicación y cero tareas; conteos sin cambios. No se editó la pieza durante el recorrido.
- Se retiró Network.setBlockedURLs, se deshabilitó Network, se restableció el viewport y se cerró la pestaña propia129. Fixture30677 terminado mediante SIGTERM tras verificar PID/comando exactos; cleanup ENOENT y ausencia posterior confirmados para `/private/tmp/render2-local-wPwDo7`.
- Logs temporales: `/private/tmp/render2-publications151-frontend.log`, `/private/tmp/render2-publications151-build.log`, `/private/tmp/render2-publications151-native.log`. Backend sin modificaciones ni nueva corrida completa en esta revisión; la anterior queda documentada en 150.

## Límites y próximos pendientes

La prueba nativa cubre fallo de transporte y recuperación a vacío para un administrador sintético. Datos no vacíos, payload no-array, ABA, sesión/unmount y handlers obsoletos tienen pruebas automatizadas del efecto/callback real, no un recorrido nativo nuevo para cada combinación. La validación de payload mantiene el contrato array existente; no se declara un validador completo de cada campo de tarea.

Siguen abiertos restauración de ciertos filtros/contextos en URL, diálogo de plantillas de Mi lista, revisión visual global y gates completos de integración del prompt maestro. Esta corrección no prueba el rescate completo ni autoriza despliegue. Todo implementado/verificado localmente; nada desplegado en producción.
