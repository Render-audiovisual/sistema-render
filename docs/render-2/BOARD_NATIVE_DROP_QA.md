# Arrastre nativo y navegación del tablero

## Arrastre entre estados con entrega vigente y PostgreSQL — integración362

Gate distinto de173: ahora se comprobó el cambio de estado por gesto y la apertura de revisión, no se volvió a probar orden dentro de columna. Build canónico Bwwc96nE verificado en DOM, cookie qa_franco, PostgreSQL propio55960/API52889 y escritorio1440×1000. Los datos operativos se prepararon por HTTP (solo cliente sintético por SQL): tarea Desarrollo1 pendiente/revisión1; visita→video grabado→handoff a Luciano→entrega v1, tarea Edición2 en_revision/revisión2. Enlace example.invalid, sin Drive real.

El fixture nuevo `/private/tmp/render2-local-pFRlLl` fijó una única referencia de108 tablas después del login y antes de los gestos. Handle de1 medido `(453,502)`→superficie vacía de En proceso `(530,610)` con CUA Tab.drag nativo produjo guardado y tarea1 en_progreso/revisión2. Handle de2 `(913,502)`→fondo de Aprobadas `(990,610)` abrió task2 por URL, mostrando entrega de revisión2; casilla de aprobación sin marcar y botón deshabilitado. No se pulsó aprobación ni se construyeron eventos JS/DataTransfer. No se registró isTrusted ni red: no se afirma cantidad exacta de solicitudes.

Observador separado `/private/tmp/render2-goal362-observe.mjs` verificó identidad exacta, transacción RR READ ONLY breve, tarea1 en_progreso2 y tarea2 en_revision2, entrega única de actor91003/URL exacta, cero decisiones y cero eventos editoriales. Al volver al tablero mediante Volver al tablero y recargar, En proceso contenía1 y Para revisar2; Aprobadas/Finalizadas vacías. Un intento de usar Cerrar tarea se rechazó por ambigüedad de la acción; no se insistió ni eludió, se usó la alternativa explícitamente segura de volver al tablero.

Runner `/private/tmp/render2-goal362-native.mjs` terminó0: frente al baseline solo cambiaron tareas y tarea_comentarios. Exigió exactamente una actividad nueva de1, actor91001 y texto `[Actividad] movió la tarea de Pendientes a En proceso`; los comentarios previos permanecieron idénticos. Todas las otras tablas —incluidas entrega, revisiones, material, asignaciones y piezas— conservaron hashes JSON/xmin/ctid. Antes del cleanup una sesión HTTP independiente de qa_designer91004 leyó estado/revisión nuevos. No es un segundo dispositivo. Cleanup ENOENT confirmado; viewport restaurado y pestaña final cerrada.

El primer fixture `/private/tmp/render2-local-UlX4q3` usó una edición sin entrega. Los gestos/SQL funcionaron, pero terminó1 porque su expectativa omitía el comentario legítimo de actividad. Se conserva como intento fallido, no fallo de producto ni aceptación del circuito de entrega; cleanup ENOENT confirmado. La repetición nueva no excluyó comentarios del control: verificó actor, tarea y texto exactos y utilizó una entrega genuina de la API.

Harvey revisó el contrato activo y el alcance sin editar/ejecutar servicios. Focal actual taskBoardApproval+taskManualOrder:31PASS/0FAIL/0SKIP (`/private/tmp/render2-goal362-board-contracts.log`). Sin cambios de producto, build ni suites globales nuevas. Capturas inspeccionadas: `/private/tmp/render2-goal362-delivery-review.png` (revisión explícita) y `/private/tmp/render2-goal362-final-board-reloaded.png` (encuadre parcial tras recarga; no certifica ancho global). Guías de trabajo estructurado/PostgreSQL orientaron contraste y observador de solo lectura.

Esto cierra dos casos concretos de DND conectado: pendiente→progreso persistente y revisión→aprobadas como apertura sin aprobación automática. No acredita todos los roles/transiciones, DND móvil, aprobación posterior, publicaciones externas ni aceptación global. Pendiente visual observado en el recorrido: Actualizar tarea para revisar todavía usa botón sin clase compartida en WorkspaceReadOnly.jsx; no se cambió en este corte. Sin bases existentes ni producción.

Actualización conectada: la sección final incorpora dos movimientos nativos con la aplicación canónica, sesión real y PostgreSQL temporal. Los apartados anteriores conservan la evidencia sintética de167; sus límites no describen el nuevo fixture físico.

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

## Orden compartido con PostgreSQL y navegador reales

El scaffold `/private/tmp/render2-board173-native.mjs` inició un fixture nuevo en55831, HTTP52799, raíz `/private/tmp/render2-local-izRlmD`. Verificó identidad exacta antes de preparar dos tareas por SQL de fixture, IDs1 y2, responsables91001, estado pendiente y revisión1. La preparación no se presenta como alta nativa. La aplicación servida fue el build canónico index-gpBnBq_Z.js, sin reemplazar sesión, adaptadores ni API. Login qa_franco obtuvo cookie real.

En1280×900 se seleccionó Manual. El orden inicial visible era `[2,1]`, fallback por fecha e ID. Arrastrar1 desde el handle observado `(453,640)` al margen interior de2 `(468,435)` mostró Orden guardado y `[1,2]`. El observador READ ONLY independiente `/private/tmp/render2-board173-observe.mjs before-card` verificó identidad, vector `[1,2]`, revisión2 y un recibo de actor91001, task_id1, before_id2 y changed:true. Las tareas conservaron pendiente/revisión1, responsables originales y cero filas en publicaciones/historias/casilleros/eventos editoriales.

El aviso posterior cambió la geometría. Un intento desde la posición anterior no movió nada; no cuenta como gesto exitoso. Tras inspeccionar rectángulos y hit testing actuales, el arrastre desde `(453,500)` hasta `(483,866)` movió1 al final. El observador `end` comprobó vector `[2,1]`, revisión3 y exactamente dos recibos distintos, el segundo con before_id:null. Continuaron intactos estados, revisiones y responsables, con las entidades editoriales vacías.

La recarga volvió a mostrar `[2,1]` y Manual en la URL. Captura inspeccionada: `/private/tmp/render2-board173-reloaded.png`. Una nueva sesión HTTP de qa_designer leyó el mismo orden del endpoint real, HTTP200, X-Task-Order-Revision3, X-Total-Count2 y snapshot con formato válido. No se exige que snapshots de identidades distintas sean iguales.

Resultados locales: `/private/tmp/render2-board173-before-card.json`, `/private/tmp/render2-board173-end.json` y `/private/tmp/render2-board173-reader.json`. Un recibo no demuestra un único POST porque el replay puede compartirlo; no se capturó la red para afirmar cantidad exacta de solicitudes. Los movimientos provinieron de drag nativo mediante CUA, no de eventos JS inyectados; este corte no instrumentó isTrusted. Las pruebas de protocolo previas cubren recibos y concurrencia, pero no se repitieron sus suites completas aquí.

Carver revisó el contrato y los límites del observador; el coordinador hizo las interacciones y lecturas aisladas. El proceso propio7689 se verificó antes de SIGTERM. El handle17319 terminó exit0, confirmó las tareas intactas y orden3/[2,1], y cleanup absent:true/ENOENT del directorio generado. El viewport se restauró y la pestaña158 se cerró. Migraciones solo en el fixture nuevo; ningún PostgreSQL previo ni producción se modificó.

Esta evidencia cierra el pendiente concreto de combinar orden nativo antes de tarjeta/al final con persistencia física y recarga. No certifica todos los movimientos de estado, móvil, todos los permisos, grandes colecciones ni aceptación visual global. El recorrido audiovisual conectado tiene evidencia posterior en NATIVE_THREE_VIDEO_PROGRESS.md; no continúa bloqueado por el límite SysV histórico de167. Render2 completo permanece abierto.
