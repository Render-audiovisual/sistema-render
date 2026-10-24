# Formularios móviles y retorno de foco en Proyectos

## Funciones comprobadas

Desde un navegador a360×800 se creó un proyecto web con cliente, responsable, miembro, descripción y fechas propias; se agregaron dos etapas, se cambió su orden, se creó un hito fechado y un entregable con enlace y observaciones. La aprobación exigió marcar la revisión explícita de su versión. Recargar conservó el proyecto en revisión7, sus fechas, orden de etapas, hito y aprobación de contenido versión1.

La prueba detectó una pérdida de foco al cancelar: el formulario desaparecía y document.activeElement quedaba en BODY. La corrección devuelve el foco a una acción existente de la sección relacionada, después de retirar el editor del DOM. En una segunda sesión nativa, cancelar una etapa sin cambios dejó el foco en BUTTON Agregar etapa.

## Corrección implementada

Projects.jsx guarda una intención de retorno solo cuando canLeave acepta la cancelación y formRef sigue siendo el mismo observado antes de esa decisión. Un layout effect consume la intención una sola vez; otro formulario la retira sin ejecutarla. No se agrega foco a un desmontaje por guardado o navegación ni se cambian esos contratos.

projectFormReturnFocus.js selecciona la acción de creación o de la sección correspondiente y comprueba el scope de sesión/selección antes y después de buscar el nodo. Exige conexión, control habilitado, ausencia de hidden/inert y rectángulos visibles; comprueba activeElement después de focus. No usa temporizadores, almacenamiento ni nuevos tab stops. No promete volver al disparador exacto: una etapa puede volver a Ordenar si ese es el primer control de su sección. Si el destino desaparece o queda deshabilitado, no fuerza foco sobre otra vista.

Volta identificó el problema y revisó el diff sin cambios de archivos. El coordinador reprodujo el defecto, implementó la corrección y ejecutó pruebas. La revisión añadió el caso de canLeave reentrante que sustituye el formulario antes de regresar. No hubo cambios de API, permisos, esquema o backend.

## Pruebas y builds

Frontend final2520 aprobadas, cero fallos u omisiones. Backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build index-D9H6i4Bo.js y diff-check correctos. Logs /private/tmp/render2-goal197-frontend-final.log, /private/tmp/render2-goal197-backend.log y /private/tmp/render2-goal197-build.log.

Seis pruebas nuevas cubren destinos por tipo de formulario, sesión/selección obsoleta, controles ausentes/deshabilitados/ocultos, retirada de scope durante lookup, consumo del layout y decisión de descarte reentrante. Se conservan las aserciones existentes de confirmación, borrador y permisos. Los tests de nodos simulados y callbacks extraídos no se presentan como React montado.

El recorrido completo de altas móviles utilizó index-yfCmchh5.js, previo a la corrección de foco. El retorno corregido se verificó en navegador con index-D9H6i4Bo.js. Se añadió después únicamente la prueba de reentrancia, sin cambios adicionales de producto.

## Datos e integridad

El primer runner /private/tmp/render2-goal197-native.mjs usó PostgreSQL55854 y HTTP52816 con cliente sintético preparado. Los siete guardados operativos se realizaron mediante la interfaz real como Franco QA. El responsable elegido fue Designer91004 y el miembro Luciano91003. La aprobación fue del administrador creador; no prueba separación entre autor y aprobador.

El corte final confirmó un proyecto, dos etapas, un hito y un entregable. No había tareas, publicaciones, historias, objetivos mensuales, piezas de objetivo ni eventos editoriales. La recarga nativa confirmó las fechas24/10 y05/11, el hito02/11, Implementación antes de Diseño responsive y la aprobación vigente. Ancho de documento345px para viewport360px, sin desbordamiento horizontal; formulario287px. No se probó un teléfono físico, teclado virtual ni todos los textos máximos.

El runner terminó0 y verificó ausencia de /private/tmp/render2-local-yRmvsb. Se cerró la pestaña15 y se restauró viewport después de ese recorrido. Capturas /private/tmp/render2-goal197-project-form-mobile.png y /private/tmp/render2-goal197-project-persisted-mobile.png.

El segundo runner /private/tmp/render2-goal197-focus-native.mjs preparó por API un proyecto independiente para comprobar cancelación sin escrituras. Ocho tablas mantuvieron hashes idénticos: clientes, proyectos, proyecto_etapas, proyecto_hitos, proyecto_entregables, proyecto_tareas, proyecto_actividad y proyecto_entregable_aprobaciones. Terminó0 y eliminó /private/tmp/render2-local-CPAuzC.

## Límite del diálogo de descarte

Tras verificar el foco corregido, se escribió un borrador de hito y se pulsó Cancelar. El diálogo real de descarte se abrió, pero el control de diálogo no logró resolverlo: posteriores acciones, cierre de pestaña y reset de viewport agotaron el tiempo de la herramienta. El acceso nativo a la aplicación fue denegado por seguridad y no se intentó eludirlo. No se considera verificado el rechazo ni la aceptación del descarte en este segundo recorrido.

Se cerraron únicamente los servicios del fixture propio, previa verificación de PID96791, y se confirmó eliminación de la base temporal. No quedó confirmación de cierre de la pestaña16 ni de restauración del viewport de ese segundo recorrido; contiene solo QA descartable. No se reinició el servidor a causa del bloqueo de observación.

## Pendientes generales

Faltan el diálogo de descarte nativo de este recorrido, formularios restantes, pruebas completas de teclado/lector/zoom, textos máximos y dispositivos independientes. Render2 sigue en desarrollo local; no hubo push ni despliegue ni cambios de datos reales.
