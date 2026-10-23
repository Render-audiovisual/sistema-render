# Acceso completo a tareas cargadas y controles independientes

El tablero permite mostrar por bloques todas las tareas ya cargadas de cada columna. La lista ordinaria permite continuar después de sus primeras 500 filas. Abrir una tarea utiliza ahora un botón nativo en el título, separado de las acciones de orden y del selector de estado. Son cambios locales de presentación; no alteran contratos de API, permisos, orden persistido ni reglas de estado.

## Correcciones implementadas

Antes, `TasksView` renderizaba únicamente `items.slice(0,250)` en cada columna y hasta 500 filas en la lista ordinaria. Cargar más páginas del servidor no hacía accesibles los registros posteriores desde esas vistas: el aviso solo sugería filtrar. Ahora «Mostrar más» amplía la ventana de una columna en bloques de 250 y «Mostrar más tareas en lista» amplía la lista en bloques de 500. La cola de revisión conserva su comportamiento anterior de mostrar todas las filas cargadas.

`taskVisibleWindow` opera exclusivamente sobre el array observado, conserva el orden y las identidades de sus filas y no realiza solicitudes ni escrituras. `hasMore` describe registros cargados todavía fuera del DOM; no representa el total del servidor. La cabecera dice «Cargadas» para no confundir esa colección con las tarjetas actualmente renderizadas. El control existente «Cargar más tareas» continúa siendo el único de estos controles que pide otra página de API.

Los controles manuales reciben el límite actualmente mostrado, no el antiguo valor fijo de 250. Por eso las tarjetas reveladas también tienen vecinos observados correctos. No se infiere un final global desde el límite cargado: «Al final» sigue siendo una acción explícita y separada. La expansión es estado de presentación en memoria, no almacenamiento comercial ni otra fuente de tareas.

`TaskCard` deja de ser un artículo con `role=button` que contiene otros controles. Su h3 contiene un botón nativo para abrir el detalle. Se conservan el clic en el fondo de la tarjeta, la prevención de apertura accidental después de arrastrar, las flechas y «Al final», y los bloqueos de permisos/operación pendiente. El gesto de arrastre comienza fuera de controles interactivos; su indicación se ajustó a esa regla.

## Archivos y responsabilidades

- Integrador: `WorkspaceReadOnly.jsx`, `TaskHeader.css`, adaptación de `taskManualOrder.test.js`, `taskReviewQueue.test.js` y `workspaceVisualTokens.test.js`; pruebas nativas y regresión completa.
- Poincare: hallazgo del límite de columna, `features/render-os/utils/task-visible-window.js` y `pages/taskVisibleWindow.test.js`.
- Hypatia: hallazgo de controles anidados y `pages/taskCardActions.test.js`.
- Carver: regresiones adicionales en `pages/taskCardDragContract.test.js`.
- Beauvoir: revisión independiente sin edición de producto ni ejecución de servicios.

No se modificó código de producto de backend, variables, dependencias, migraciones ni datos existentes. Dos pruebas de interfaz alojadas en `backend/test` se adaptaron a los componentes actuales: `frontend-functional-guards.test.js` comprueba el botón nativo en lugar del antiguo handler de teclado del contenedor; `productions-ui-contract.test.js` comparte sus refs/layout hooks reales con el formulario actualizado. Se conservan las comprobaciones de drag y de guion/estado enviado. El sistema de diseño se conserva: los nuevos controles usan tokens vigentes y la capa existente `TaskHeader.css`. El botón de título mide al menos 24 px en escritorio y 44 px hasta 980 px. Los controles de orden mantienen sus 44 px.

El guard visual sigue fijando el hash original de las reglas previas. Solo ocho reglas nuevas de los controles de apertura/continuación se verifican por separado, incluyendo cada declaración y su contexto móvil; no se sustituyó el fingerprint completo para ocultar cambios de layout.

## Pruebas automatizadas

Desde `frontend`:

```sh
node --test src/pages/workspaceVisualTokens.test.js src/pages/taskManualOrder.test.js src/pages/taskCardDragContract.test.js src/pages/taskReviewQueue.test.js src/pages/taskCardActions.test.js src/pages/taskVisibleWindow.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Pasaron 99 pruebas focales, las 2260 pruebas de frontend y el build; sin fallos ni omitidas en la repetición final. Entrada del build `index-DmpFpSNy.js`. El primer pase detectó el fingerprint esperado de los nuevos controles; se agregó su verificación independiente y se repitió la suite completa.

Las pruebas nuevas ejecutan componentes y callbacks reales extraídos de JSX, no tarjetas recreadas. Cubren apertura nativa semántica, propagación sin doble apertura, controles bloqueados, permisos de solo lectura, drag desde controles rechazado, clic posterior al drag suprimido, expansión 250→500→633 y ausencia de solicitudes al expandir. Las regresiones de lista comprueban que la tarea 501 sigue disponible tanto en revisión como después de ampliar la lista ordinaria.

La regresión de backend pasó con 1940 aprobadas, cero fallos y 118 omitidas. Las dos pruebas adaptadas pasaron también en un conjunto focal de 42 pruebas. Se forzó `RENDER2_RUN_LOCAL_INTEGRATION=false`; las omitidas de PostgreSQL no se cuentan como ejecutadas.

Logs temporales: `/private/tmp/render2-board162-focused-final.log`, `/private/tmp/render2-board162-release-frontend.log`, `/private/tmp/render2-board162-release-build.log`, `/private/tmp/render2-board162-backend-focused.log` y `/private/tmp/render2-board162-backend-renewed.log`.

## Comprobación de componente en navegador

El script temporal `/private/tmp/render2-board162-browser.mjs` compila el `TaskCard`, los helpers visuales, los handlers de orden y los subárboles JSX de tablero/lista reales. React usa StrictMode y las hojas de estilo reales. La colección y el callback de movimiento son sintéticos, únicamente en memoria: no hay API, sesión autenticada ni PostgreSQL. No está importado por la aplicación canónica ni constituye una implementación operativa alternativa.

Se comprobó:

- Enter y Espacio en el título ejecutan la apertura. Tab pasa del título al siguiente control habilitado de orden, sin un botón contenedor adicional.
- Espacio en «Bajar» cambia la secuencia sintética de IDs de `[1,2,3]` a `[2,1,3]` sin abrir el detalle.
- Una columna con 251 tareas muestra inicialmente 250; «Mostrar más» revela la 251 y su título permite abrirla.
- La lista con 501 tareas muestra inicialmente 500; el control de continuación revela la 501 y permite abrirla.
- A 390 × 844, el botón de título mide 44 px de alto, el documento mide 390 px de ancho y no se capturaron errores ni advertencias de consola.

Captura: `/private/tmp/render2-board162-mobile.jpg`. Se restauró el viewport, se cerró la pestaña propia y se apagaron los servidores temporales verificados.

## Arrastre y persistencia todavía no acreditados

Se realizaron dos intentos de arrastre nativo en el componente aislado. El primero registró inicio, movimiento y fin, pero ningún drop ni cambio de orden. Para evitar que el registro de eventos alterara la geometría, el diagnóstico final se colocó fuera del flujo visual. El segundo comprobó `text/task-id`, `defaultPrevented=true` y `dropEffect=move` durante dragover, pero terminó con `dropEffect=none`, sin drop ni modificación de la colección.

Esto no prueba un defecto del handler ni acredita un gesto completo: el instrumento no entregó el evento final esperado. No se modificó la lógica de drag para hacer pasar una simulación ni se reemplazó el gesto pendiente por las flechas. La aceptación nativa conectada continúa exigiendo un drop antes de otra tarjeta y al final, un POST por gesto, y una lectura nueva/recarga que conserve orden sin cambiar estados o revisiones comerciales.

El límite SysV local descrito en `PRODUCTION_MEDIA_FOCUS_QA.md` sigue impidiendo preparar un nuevo PostgreSQL aislado. Se solicitó autorización para revisar y liberar únicamente recursos huérfanos; no se realizó esa limpieza sin respuesta. Las bases y servicios ajenos permanecieron intactos. La aceptación audiovisual conectada y la aceptación visual global también siguen abiertas.

El avance está implementado y verificado en desarrollo en el alcance indicado. No certifica Render 2.0 completo ni preparado para producción y no hubo despliegue.
