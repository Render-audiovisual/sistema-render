# Navegación entre operación y objetivos del cliente

Los objetivos conservan el cliente por ID y el período en la URL. Volver desde la operación, recargar, elegir otro cliente y usar Atrás ya no selecciona silenciosamente el primero. Implementado y verificado por alcance en desarrollo local, sin despliegue.

## Contrato y corrección

Antes, los enlaces de ClientOperationPage solo conservaban el mes y GoalPage ignoraba cliente. Los selectores guardaban selectedKey únicamente en memoria; una recarga elegía el primer grupo. Ahora ambos enlaces de regreso usan `/clientes?cliente=ID&periodo=YYYY-MM` y GoalPage resuelve el grupo por sus cuentas con IDs reales, incluidas cuentas hermanas de un feed.

`clientGoalLocation.js` rechaza IDs vacíos, duplicados, arrays, no canónicos y fuera de int32 positivo. Meses con brackets también se rechazan en el lector de período. Un ID explícito sin objetivo disponible no cae al primer cliente: muestra aviso y permite elegir otro. Sin ID se conserva la entrada general compatible. La URL de navegación preserva parámetros ajenos, fragmento e historial; no es una fuente de autoridad.

Cambiar de mes conserva el ID. Con un detalle abierto se difiere el contexto completo, se mantiene el enlace visible y al cerrar se restaura el destino pendiente. Se conservaron el ámbito de sesión, generaciones de lectura, polling diferido, guardas de borrador y callbacks de preparación. Las lecturas siguen solicitando el resumen del período; seleccionar un cliente no ejecuta preparación ni escribe tareas o cuotas. No hubo cambios de backend ni de ACL.

## Coordinación y regresión

Poincare implementó GoalPage y el helper con9 pruebas; Hypatia confirmó el defecto y añadió7 pruebas del JSX/callbacks reales. El coordinador integró los enlaces del centro operativo y las dependencias de los fixtures existentes, conservando las aserciones de sidebar/mes. Las guías de trabajo estructurado y verificación orientaron los límites; la evidencia queda en el repositorio local.

Los16 casos nuevos cubren IDs y feeds, cliente ausente, URL/fragmento, selección humana, veto de navegación, sesión obsoleta y pop/cierre diferido. Los tests de enlace verifican los dos href de regreso exactos. SSR y callbacks extraídos no se presentan como navegador montado.

Pasaron2440 pruebas frontend y1982 backend;123 integraciones optativas quedaron omitidas en la regresión backend, sin fallos. Build index-CPqX5sr_.js y diff-check correctos. Logs `/private/tmp/render2-goal185-frontend.log`, `/private/tmp/render2-goal185-backend.log`, `/private/tmp/render2-goal185-build.log` y focales `/private/tmp/render2-goal185-navigation.log`.

## Recorrido conectado

El fixture creó dos clientes sintéticos A/B y preparó los objetivos de B para octubre y noviembre mediante la API real con revisión observada. Una sesión de dueño abrió la operación de B y pulsó Abrir objetivos: apareció B en octubre. Elegir A actualizó la URL; recargar mantuvo A y Atrás restauró B. El selector de mes pasó a noviembre sin perder B.

Se abrió Reel1 de noviembre, tarea3. Atrás mantuvo esa pieza y la URL de noviembre, avisando que el contexto quedaba pendiente. Cerrar aplicó octubre y mantuvo B. El ID inexistente999 mostró cero tableros y no seleccionó A. Desde el selector móvil se eligió B explícitamente y se restauró su enlace. A390px, el documento midió375px. Captura `/private/tmp/render2-goal185-mobile.png`.

PostgreSQL55845/HTTP52810 verificó identidad exacta y raíz `/private/tmp/render2-local-fH6K36`. Nueve tablas conservaron sus snapshots tras navegar; no se volvieron a preparar objetivos ni se crearon tareas. El proceso terminó0 y cleanup comprobó ENOENT. Pestaña cerrada y viewport restaurado.

El recorrido nativo usó dueño y cuentas individuales; cuentas hermanas y sesión obsoleta se verificaron mediante pruebas de helpers/JSX. No certifica todas las combinaciones de formularios, roles ni dispositivos físicos. Render2 sigue sin aceptación global ni autorización de despliegue.
