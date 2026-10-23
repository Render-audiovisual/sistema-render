# Arrastre nativo y navegación del tablero

El tablero real recibió drops nativos para abrir revisión, ubicar una tarjeta antes de otra y enviarla al final de su columna. Las operaciones de orden utilizaron el adaptador y el modelo reales, con un POST por gesto y lectura posterior. El transporte HTTP es sintético y conserva datos en memoria; no acredita persistencia en PostgreSQL ni autenticación real.

## Corrección de navegación compacta

Un movimiento rechazado por `orderState.busy` o `locked` devolvía `undefined`, pero el drop compacto avanzaba de columna al comprobar solamente que el resultado no fuera `review`. Ahora `move` devuelve `move` o `approval` al despachar esas acciones; el drop avanza solo ante esos resultados. Bloqueo, mismo estado, falta de permiso y apertura de revisión no avanzan. Admitir una acción no significa que el servidor haya confirmado su resultado.

Hypatia modificó `WorkspaceReadOnly.jsx` y `taskBoardApproval.test.js`. Poincare revisó la delegación de eventos en ReactDOM local; Beauvoir inspeccionó hit testing, estilos y listeners; Carver contrastó contratos de orden y criterios de prueba. El integrador hizo los gestos nativos, integró la corrección y ejecutó la regresión. Los archivos heredados de preview y sandbox no cambiaron.

## Diagnóstico de los intentos sin drop

La prueba mínima `/private/tmp/render2-drag167.mjs`, con React19 y MIME `text/task-id`, recibió `drop` con `isTrusted=true`. El registro distingue captura, callback React y bubbling: el receptor React cancela correctamente `dragover`. No se confirmó un defecto de delegación de React.

La página real se compiló con `/private/tmp/render2-board166-browser.mjs`. La instrumentación pasiva registra tipos, ruta, coordenadas, cancelación y dropEffect, sin inyectar eventos. Un gesto que terminó sobre un nuevo span hijo produjo `dragenter` al final, sin otro `dragover` ni `drop`. Cambiar el punto final a una superficie estable permitió recibir drop. Esto explica la secuencia observada de esos gestos, no demuestra una causa general para cualquier fallo de arrastre.

No se modificaron listeners del producto, geometría, MIME ni permisos para conseguir el resultado. No se usaron eventos construidos mediante JavaScript como evidencia nativa.

## Recorridos de la página real

La fixture monta `WorkspaceReadOnlyPage` bajo StrictMode y usa sus adaptadores HTTP, captura, modelos y callbacks. Solo sustituye la lectura de sesión por una identidad sintética y responde con datos de prueba sobre loopback. CSP impide conexiones a otros orígenes. No importa la entrada Express, accede a PostgreSQL ni llama a proveedores.

1. Revisión: arrastrar la edición sintética desde Para revisar al fondo del botón vacío de Aprobadas abrió `/tareas?task=1`, mostró revisión explícita y conservó estado `en_revision`, revisión7 y cero escrituras. No se marcó reconocimiento ni se aprobó o publicó.
2. Antes de tarjeta: con orden Manual e IDs iniciales `[2,3]`, arrastrar3 antes de2 produjo `[3,2]`. Hubo exactamente un POST `/api/tareas/orden`, `task_id:3`, `before_id:2`, revisiones de tareas1 y orden esperado `"1"`. El ACK incrementó el orden a `"2"`; el callback recargó la primera página y mostró el nuevo orden.
3. Final de columna: arrastrar3 al margen interior del fondo de Pendientes produjo `[2,3]`. El segundo POST llevó `before_id:null`, `expected_before_revision:null` y orden esperado `"2"`. El ACK devolvió orden `"3"`. Recargar volvió a leer `[2,3]` de la API en memoria, sin tercer POST. Los estados comerciales y revisiones de tareas no cambiaron.

Coordenadas observadas a1280×720: revisión desde `(914,563)` hasta `(1000,650)`; antes de tarjeta, después del scroll observado, desde `(475,460)` hasta `(475,280)`; final desde `(475,320)` hasta `(485,660)`. Deben medirse de nuevo si cambia el layout. Se contrastaron mediante `getBoundingClientRect` y `elementFromPoint`; un gesto previo que cruzaba hijos justo al soltar no produjo drop ni escritura.

La ausencia de bubbling en document para el drop antes de tarjeta es esperada: el handler detiene propagación para evitar otra operación sobre el fondo. El drop quedó registrado en captura y el circuito real produjo un solo POST.

Capturas locales: `/private/tmp/render2-board167-native-review.png` y `/private/tmp/render2-board167-native-order-reloaded.png`. El segundo encuadre muestra el tablero después de recargar, sin overlay de eventos. La fixture temporal no se importa desde la aplicación ni es otra implementación operativa.

## Validación y límites

Las cuatro suites focales de tablero, navegación y orden aprobaron41 pruebas, incluidas busy/locked, mismo estado, permiso rechazado y acciones admitidas. Frontend completo aprobó2335 pruebas sin fallos ni omitidas. El build pasó con entrada `index-DTK9jn3m.js`. Backend final aprobó1956 pruebas con119 omitidas y cero fallos, con integración física desactivada. La primera ejecución detectó una comprobación de wiring que esperaba la condición anterior; se adaptó el test sin modificar producto backend, añadiendo resultados bloqueados y admitidos. Su focal aprobó29 pruebas. Logs: `/private/tmp/render2-board167-frontend.log`, `/private/tmp/render2-board167-build.log` y `/private/tmp/render2-board167-backend-final.log`.

La revisión independiente no identificó nuevos P1/P2 en el delta. Las pruebas de callbacks extraídos no se presentan como gestos nativos ni como verificación de PostgreSQL.

El gate nativo de recepción y despacho de orden ya tiene evidencia. El gate combinado navegador y PostgreSQL sigue abierto: la recarga aquí conserva memoria del servidor sintético, no almacenamiento físico. También siguen pendientes el recorrido audiovisual nativo conectado, aceptación visual global y proveedores/cuentas autorizados. El botón Actualizar tarea para revisar conserva el pendiente visual anterior.

No se aplicaron migraciones, limpiaron segmentos IPC, alteraron bases existentes ni desplegó producción. El bloqueo de recursos PostgreSQL y la autorización pendiente no permiten detener procesos ajenos. Render2 completo permanece activo y sin certificación global.
