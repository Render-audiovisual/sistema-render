# Revisión explícita desde el tablero de tareas

Mover una tarea de edición Render OS hacia Aprobada abre ahora su detalle para revisar la entrega, sin aprobarla ni cambiar su estado. En celular se conserva la columna Para revisar hasta que el usuario confirme la aprobación real. Este corte unifica esa intención con el circuito del detalle; no cambia la autorización ni los contratos de backend.

## Error y contrato corregidos

`TasksView.move` llamaba a `onApprove(task)` sin observación de revisión o entrega. El guard del padre rechazaba correctamente esa llamada para edición canónica, pero el tablero no ofrecía una salida hacia la revisión. El drop compacto podía además seleccionar Aprobadas aunque no se hubiera aprobado nada.

Después de comprobar permisos, la nueva rama llama a `openTask(task.id,true)` y devuelve `review`. No llama a `onApprove` ni a `onUpdate`. El handler de drop reconoce ese resultado y no cambia anticipadamente la columna móvil. Las otras tareas conservan sus contratos anteriores. Reordenar dentro de una columna continúa siendo una operación separada.

La intención de revisión se fija únicamente cuando `openTask.show` acepta la navegación y vuelve a comprobar captura, aborto y propiedad de la consulta. La apertura normal, el cierre y popstate limpian el aviso. Este solo se presenta para el ID coincidente, un usuario admin y una tarea de edición Render OS todavía en revisión. No marca el checkbox, reconstruye historial, infiere una entrega ni aprueba una versión nueva.

Los controles del detalle conservan sus condiciones existentes: historial vigente, reconocimiento explícito cuando hay entrega, revisión de tarea y entrega exactas en el PATCH. Aprobar trabajo no registra una publicación editorial real.

## Archivos y equipo

Poincare implementó `frontend/src/pages/WorkspaceReadOnly.jsx`. Carver creó `taskBoardApproval.test.js`, con callbacks y JSX reales para movimiento, drop, selector, permisos, reordenamiento y presentación pasiva. Hypatia adaptó `taskBoardColumnNavigation.test.js`, `taskNavigationGuard.test.js` y los fixtures de apertura de `backend/test/task-opening-speed.test.js`, manteniendo los guards y añadiendo una carrera de cambio de sesión durante la navegación. El integrador adaptó la comprobación de estados canónicos, coordinó contratos, ejecutó las regresiones y comprobó la página real en el navegador.

Poincare adaptó también `backend/test/frontend-functional-guards.test.js` para comprobar el resultado review sin perder los bloqueos de MIME, ID, permisos o reordenamiento. Beauvoir revisó independientemente la rama de revisión, el ciclo del aviso y las hipótesis de drag. No identificó otro P1/P2 concreto en ese delta ni una causa confirmada del drop ausente. No se modificaron permisos, esquema, migraciones, variables o proveedores. Los archivos heredados de preview y sandbox permanecieron intactos.

## Prueba nativa de la página real

El script temporal `/private/tmp/render2-board166-browser.mjs` compila `WorkspaceReadOnlyPage` y sus dependencias reales bajo React StrictMode. Se sustituye únicamente la lectura de sesión por una identidad sintética y se sirve una API de prueba en memoria sobre loopback. Los modelos de entrega/revisión, adaptador HTTP, captura de sesión y callbacks de actualización son los de la aplicación. La API sintética no es Express principal ni PostgreSQL, y no acredita autenticación real.

La política de contenido limita las conexiones al mismo origen. No se eligieron archivos, abrieron proveedores ni ejecutaron publicaciones. El fixture no se importa desde la aplicación ni es otra implementación operativa de Render.

Recorrido comprobado a 390 × 844:

1. Elegir Para revisar muestra la tarea de edición sintética y conserva `board_column=en_revision`.
2. Elegir Aprobada desde la tarjeta abre `task=1`, muestra la instrucción de revisión y mantiene `estado=en_revision`, revisión 7 y cero escrituras de dominio.
3. Con el historial disponible, Aprobar revisión permanece deshabilitado hasta reconocer la entrega mostrada.
4. Marcar el checkbox todavía no escribe. Aprobar envía exactamente un PATCH a `/api/tareas/1?workspace=render_os` con `estado:aprobada`, `expected_revision:7`, `expected_updated_at:2026-10-23T12:00:00.000Z` y la entrega `11111111-1111-4111-8111-111111111111`.
5. La interfaz muestra Aprobada y la API sintética queda en revisión 8. Se registra además un comentario de actividad; no otra escritura de dominio ni publicación.
6. Recargar consulta nuevamente esa API en memoria, conserva Aprobada y elimina el aviso temporal de intención. Esto no prueba persistencia en PostgreSQL ni después de reiniciar el fixture.

El documento y el detalle final miden ambos 390 px. No hubo errores o advertencias de consola en el último pase. Capturas: `/private/tmp/render2-board166-mobile-review-final.png` y `/private/tmp/render2-board166-mobile-approved-final.png`.

Un pase anterior perdió su API porque venció el temporizador del fixture; el proceso se comprobó finalizado antes de reiniciarlo. Otro pase tenía desbordamiento causado por el JSON diagnóstico sin ajuste de línea: se corrigió solo esa cabecera. Las herramientas del brief conservan su scroll interno. Esos fallos de fixture no se atribuyen al producto.

## Arrastre nativo todavía pendiente

Se contrastaron dos baselines HTML, sin React: uno con `text/plain` y otro con `text/task-id`. Ambos recibieron la secuencia nativa completa y mostraron DROP RECIBIDO. En cambio, dos gestos sobre la tarjeta real y la columna Aprobadas no abrieron la revisión. El segundo verificó el origen no interactivo mediante `elementFromPoint` y registró en captura inicio, movimiento y fin, sin drop.

La traza mostró el formato personalizado y `dragend` con `dropEffect=none`. Un `defaultPrevented=false` observado en captura o su microtarea no demuestra que el handler posterior rechazara el evento. No se identificó aún la causa. No se cambió la lógica de drag para forzar una simulación y el selector móvil no sustituye la aceptación de arrastre.

El gate sigue exigiendo drop antes de otra tarjeta y al final, una operación por gesto y una nueva lectura persistente, además del recorrido de revisión desde el drop. Los baselines exitosos mejoran el diagnóstico, pero no cierran ese gate.

## Pruebas reproducibles

Desde frontend:

```sh
node --test src/pages/taskBoardApproval.test.js src/pages/taskBoardColumnNavigation.test.js src/pages/taskNavigationGuard.test.js src/pages/taskInlineApproval.test.js src/pages/taskManualOrder.test.js src/pages/taskCardDragContract.test.js src/pages/taskReviewQueue.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Pasaron 94 pruebas focales y 2333 de frontend, sin fallos ni omitidas. El build pasó con entrada `index-BAAXN07I.js`.

Desde backend:

```sh
node --test test/frontend-functional-guards.test.js test/task-opening-speed.test.js test/workspace-canonical-states.test.js
RENDER2_RUN_LOCAL_INTEGRATION=false npm test
```

Pasaron 48 pruebas focales y la regresión completa con 1956 aprobadas, cero fallos y 119 omitidas. Los fallos del primer pase correspondían a dependencias de extracción y una comprobación de wiring antigua; se adaptaron conservando los escenarios de permiso, cancelación, sesión y respuesta tardía. No se modificó producto de backend para hacer pasar esas pruebas.

Logs finales: `/private/tmp/render2-board166-focused-release.log`, `/private/tmp/render2-board166-frontend-release.log`, `/private/tmp/render2-board166-build-release.log`, `/private/tmp/render2-board166-backend-focused-final.log` y `/private/tmp/render2-board166-backend-final.log`. Se restauró el viewport, se cerraron todas las pestañas propias y se detuvieron los servidores sintéticos verificados. La documentación se guardó únicamente en el repositorio mediante la skill de documentación local.

## Límites de entrega

La consulta de solo lectura de memoria compartida volvió a mostrar 32 segmentos ocupados. No se inspeccionaron como huérfanos ni se liberaron. PostgreSQL aislado sigue pendiente de recursos y de la autorización previamente solicitada para cualquier limpieza. No se ejecutaron migraciones ni se tocaron bases existentes.

La captura también conserva un botón Actualizar tarea para revisar todavía sin tratamiento visual compartido. Queda en la aceptación visual global, junto con el recorrido audiovisual nativo conectado, los proveedores y cuentas reales autorizados. Render 2.0 completo permanece sin certificar ni desplegar.
