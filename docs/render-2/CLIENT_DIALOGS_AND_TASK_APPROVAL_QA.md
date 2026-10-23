# Ventanas de clientes y aprobación observada de tareas

El sistema canónico incorpora ocho ventanas de clientes al componente Modal nativo compartido y corrige dos errores del tablero: una aprobación que no enviaba la revisión observada y una carga inválida que podía parecer una lista vacía. Los cambios son locales. No alteran permisos de servidor, contratos financieros ni estados editoriales.

## Cambios por componente

| Componente | Cambio | Regla conservada |
| --- | --- | --- |
| Clientes.jsx | Alta con ventana nativa, nombre accesible y cierre bloqueado al guardar | Confirmación antes de abandonar borrador o alta incierta |
| ClienteModals.jsx | Identidad, cuota, detalle y ramas denegadas nativas; foco inicial y retorno al botón invocador | Captura de sesión, revisiones, separación de clientes básicos y acuerdos |
| StartMonthlyAgreementModal.jsx | Ventanas nativas de acuerdo y denegación; retorno de foco al detalle | Elegibilidad, importes explícitos, envío único y confirmación de cierre |
| Modal.jsx | Referencia opcional de retorno de foco | Clientes existentes sin esa prop conservan su comportamiento anterior |
| WorkspaceReadOnly.jsx | Selector y botón de aprobación comparten observación y bloqueo de envío | El servidor sigue exigiendo revisión y entrega; aprobar no publica |
| render-os-api.js | Las páginas normales de tareas rechazan respuestas inconsistentes | Errores HTTP y de sesión no se convierten en éxito vacío |

## Aprobación de edición

Antes, elegir Aprobada desde Estado llamaba a `onApprove(task)` sin la revisión y entrega leídas. El padre rechazaba correctamente ese intento para edición canónica, aunque el usuario hubiera marcado la confirmación de revisión. El selector ahora utiliza el mismo handler que Aprobar revisión, con la observación vigente y una referencia síncrona que impide dos envíos en el mismo render.

Sin reconocimiento de una entrega existente, historial actual, permisos o disponibilidad del formulario no se envía HTTP. Una respuesta 409 obliga a revisar otra vez; no se reintenta ni se adopta una versión nueva para aprobarla automáticamente. El guard del padre permanece intacto. La aprobación no se incorpora como transición nueva en el editor completo: un borrador mixto que la contenga conserva sus cambios y no escribe otros campos parcialmente.

`taskInlineApproval.test.js` ejecuta el JSX del selector y callbacks reales de detalle, aprobación y actualización, con una sesión cookie sintética. Comprueba el PATCH único con `expected_revision`, `expected_updated_at` y `expected_entrega_id`, los rechazos y la ausencia de efectos tardíos. Es una prueba de callbacks, no de interacción nativa ni PostgreSQL.

## Carga de tareas

Un HTTP 200 con JSON roto u objeto inesperado podía producir `[]` y reemplazar visualmente trabajo existente. El adaptador ahora rechaza JSON inválido, cuerpos no-array, IDs inválidos o repetidos, totales no canónicos y cantidades incompatibles con el límite, offset y total.

El servidor emite `X-Total-Count` para la misma cohorte filtrada; el cliente envía explícitamente su límite. Las páginas finales y vacías más allá del final siguen admitidas. Manual y revisión conservan sus snapshots y reglas anteriores. Las páginas normales siguen sin snapshot entre solicitudes: esta validación no garantiza membresía estable durante una secuencia de paginación concurrente.

## Ventanas y foco

Las ventanas migradas usan la capa modal nativa: el fondo queda inactivo y Tab permanece dentro del diálogo. Escape pasa por los cierres existentes; no equivale a consentimiento para descartar cambios. Los cierres y campos se bloquean durante las operaciones pendientes.

La prueba nativa detectó que deshabilitar el botón del detalle al abrir un hijo podía borrar el invocador antes del efecto de Modal. `returnFocusRef` conserva explícitamente ese destino y lo consulta al cerrar, solo si continúa conectado, habilitado y fuera de un contenedor inert. Una referencia explícita vacía no vuelve a un destino antiguo. Las referencias de edición y acuerdo son distintas y apuntan a sus botones reales.

La confirmación de cierre del acuerdo debe enfocar Conservar borrador después de bloquear los campos y devolver el foco al origen al continuar. Este movimiento pertenece únicamente a esa confirmación y a la misma sesión, no al montaje inicial ni a una pantalla denegada.

La regla genérica de inputs del formulario excluye checkbox y radio. La fila Cliente activo conserva flex y área táctil, con un checkbox de 18 × 18 px. Se corrigen las reglas existentes de `styles.css`, sin agregar una capa paralela ni cambiar el payload booleano.

## Estado de aceptación

La comprobación de componente utiliza `/private/tmp/render2-client165-browser.mjs`, con React StrictMode, componentes y estilos reales, y únicamente sesión/transporte sintéticos. La política de contenido bloquea conexiones externas. Sus guardados viven en memoria y no prueban persistencia ni autenticación real.

Se verificó nativamente en escritorio:

- Abrir detalle y editor básico deja expuesto al teclado y árbol accesible solo el diálogo superior.
- Shift Tab desde el cierre vuelve al último control; Tab vuelve al primero.
- Escape con un borrador pide confirmación; cancelar conserva el texto.
- Escape durante un guardado sintético no cierra el editor ni el detalle.
- Después de guardar, el nombre actualizado aparece en el detalle y el foco vuelve al botón Editar nombre y estado.
- Cerrar el acuerdo sin cambios devuelve el foco a Configurar acuerdo mensual; cerrar el detalle devuelve el foco al botón exterior.

En móvil 390 × 844, editar Rubro y pulsar Escape enfoca Conservar borrador y desplaza esa acción a la vista. Su rectángulo mide 44 px de alto y termina dentro del panel, no recortado. Conservar devuelve el foco al mismo Rubro, mantiene el texto y no registra ninguna escritura. El formulario de acuerdo tiene una columna y el documento mide 390 px. En el editor básico final, el checkbox mide 18 × 18 px y su fila 49 px. No hubo errores ni advertencias de consola.

Capturas finales: `/private/tmp/render2-client165-mobile-confirm.png` y `/private/tmp/render2-client165-mobile-editor-final.png`. Se restauró el viewport, se cerraron las pestañas propias y se detuvieron los procesos propios verificados. El primer intento del fixture importaba un CSS con nombre incorrecto: se corrigió solo ese import antes de iniciar la prueba. Los problemas de foco y checkbox encontrados durante los pases posteriores sí correspondían al producto y se corrigieron antes de repetirlo.

La aceptación nativa cubre detalle básico, editor básico y formulario de primer acuerdo. El alta completa y el editor de cuotas conservan pruebas de fuente/callbacks, no una aceptación nativa completa en este corte.

## Pruebas reproducibles

Desde frontend:

```sh
node --test src/components/modal-native.test.js src/components/clientNativeDialogs.test.js src/components/basicClientModals.test.js src/components/cliente-modals-session.test.js src/components/StartMonthlyAgreementModal.test.js src/pages/clientCreateNavigation.test.js src/pages/taskInlineApproval.test.js src/features/render-os/services/render-os-api-task-page.test.js src/features/render-os/services/render-os-api-session.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Pasaron 134 pruebas focales y 2321 de frontend, sin fallos ni omitidas. El build final pasó con entrada `index-2hYFsKLI.js`. Desde backend, `RENDER2_RUN_LOCAL_INTEGRATION=false npm test` pasó con 1955 aprobadas, cero fallos y 119 omitidas. No se cambió código de backend ni esquema.

Logs finales: `/private/tmp/render2-integration165-focused-final.log`, `/private/tmp/render2-integration165-frontend-final2.log`, `/private/tmp/render2-integration165-build-final2.log` y `/private/tmp/render2-integration165-backend-release.log`.

## Equipo y límites de entrega

Poincare corrigió la aprobación y escribió sus pruebas; Hypatia corrigió el adaptador de páginas y sus pruebas. Ambos revisaron independientemente el delta del otro sin nuevos P1/P2 concretos en esos alcances. Beauvoir migró los diálogos de detalle, edición y acuerdo y corrigió la confirmación de foco; Carver añadió pruebas de sus contratos y adaptó los fixtures afectados. Hypatia revisó también el foco final. El integrador migró el alta, implementó el retorno explícito compartido y el ajuste CSS, coordinó contratos, realizó las pruebas nativas y ejecutó las regresiones.

La documentación usa el formato del repositorio y las guías locales. No se consultaron guías remotas ni se creó contenido en servicios externos. Las skills de diseño orientaron el uso del componente compartido y el área táctil; no hay una certificación global de accesibilidad o diseño.

PostgreSQL aislado continúa pendiente por el límite SysV del equipo. No se ejecutan migraciones, no se limpian recursos IPC y no se intervienen servicios ajenos. El objetivo completo de Render 2.0 permanece abierto, incluidos el recorrido audiovisual nativo conectado, drop nativo persistente, aceptación visual global, cuentas y proveedores autorizados.
