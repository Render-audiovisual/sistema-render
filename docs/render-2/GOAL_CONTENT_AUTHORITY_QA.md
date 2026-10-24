# Autoridad transaccional para contenido de objetivos

S187 01 está corregido y verificado en desarrollo local para editGoalContent. La transacción ahora conserva una identidad vigente del servidor hasta terminar la escritura. El permiso de presentación incorporado antes sigue siendo orientativo y no reemplaza este control. El cierre no certifica los demás escritores ni autoriza producción.

## Corrección

backend/src/client-goals.js captura valores primitivos de actor y contenido antes de obtener la conexión. Rechaza identidades inválidas con401 y abre READ COMMITTED explícito. Antes de consultar o bloquear tareas, toma usuarios FOR SHARE y compara ID, activo, rol y session_version con la observación capturada. Construye el ACL con la fila verificada y conserva ese bloqueo hasta COMMIT o ROLLBACK.

El orden es usuario, tarea y los bloqueos de publicación/pieza de los triggers existentes. El camino no actualiza usuarios ni adquiere después el mutex administrativo. Mantiene pertenencia por ID, workspace, papelera/archivo, revisión entera y timestamp observados. Una revocación que confirma primero rechaza la escritura; una edición que obtiene autoridad primero puede finalizar antes de que la revocación consiga su bloqueo. No se promete cancelación retroactiva de un commit autorizado.

Los errores conservan su causa original. Si falla el rollback, la conexión se libera para descarte y no vuelve al pool como conexión sana. No hay migraciones, llamadas externas dentro de la transacción, cambios visuales ni modificaciones de roles operativos.

## Coordinación y pruebas unitarias

El coordinador implementó el escritor y las barreras HTTP con PostgreSQL. Erdos añadió exclusivamente backend/test/goal-content-write-authority.test.js, con39 pruebas del servicio real y conexión simulada. Cubren validación previa al lease, denegaciones de identidad bloqueada, orden de consultas, captura inmutable mientras connect espera, permiso asignado y dueño, CAS, rollback y descarte de conexión sin perder el error original.

Volta revisó el orden de locks y triggers antes de la integración y el delta final después, sin hallazgos accionables en ese alcance. Las guías de seguridad y PostgreSQL orientaron la retención de autoridad y las transacciones cortas; no se presenta la revisión por fuente como prueba de ausencia global de deadlocks.

## Barreras HTTP con PostgreSQL

render2-goal-content-authority.integration.test.js usa clúster fresco55848 y valida base, usuario, dirección loopback, puerto y data_directory antes de probar. Pasaron12 subpruebas más el contenedor,13 comprobaciones:

- Dueño y empleado asignado esperan realmente en el lock de usuario después de atravesar middleware. Otra conexión confirma incremento de epoch, desactivación o cambio de rol. Las seis variantes responden401 sin DML en las siete tablas operativas observadas.
- Dueño y empleado que ya retienen autoridad esperan en la tarea mientras una revocación intenta actualizar el usuario. pg_blocking_pids acredita que la revocación espera al escritor real. Tras liberar la tarea, la edición confirma, la revocación continúa y la petición posterior con la sesión antigua responde401.
- Dos ediciones del mismo actor producen un200 y un409, sin incremento del contador de deadlocks de la base de prueba.
- Rechazos404 y409 conservan snapshots y liberan autoridad: una actualización posterior de sesión termina con timeout acotado en vez de quedar bloqueada.
- Cambiar copy de una tarea aprobada con publicación vinculada invalida aprobación y sincroniza el contenido/estado de la pieza. No asigna fecha real de publicación ni crea eventos de confirmación.

El último escenario prepara la relación editorial en ambas tablas mediante SQL sintético; no valida creación de vínculos por interfaz. Su primer intento falló porque el fixture solo había vinculado la tarea, no la pieza. Se corrigió el armado del fixture y el nombre acentuado real de la columna de publicación; la corrida final pasó. No fue una modificación del comportamiento de negocio para hacer pasar la prueba.

La suite inicial de10 comprobaciones y el primer intento ampliado no se suman al total final. El fixture final terminó0 y verificó ENOENT de `/private/tmp/render2-local-5gpCCN`; los intentos anteriores también ejecutaron su cleanup. No se reprodujo el ataque sobre la versión vulnerable anterior.

## Regresión y estado de entrega

Se renovaron17 comprobaciones físicas de las suites existentes de contenido y capacidad de edición, cada una con su clúster descartable y limpieza verificada. Con las13 de autoridad, el corte acredita30 comprobaciones físicas finales, cero fallos u omisiones. Log `/private/tmp/render2-goal188-content-regression.log` y `/private/tmp/render2-goal188-authority-final.log`.

La regresión backend aprobó2021 pruebas y omitió125 integraciones optativas, sin fallos. Log `/private/tmp/render2-goal188-backend.log`. El frontend y sus assets no cambiaron: siguen vigentes los resultados anteriores de2472 pruebas y build index-DMPN57gt.js, no ejecutados nuevamente en este corte. diff-check correcto.

El endpoint de contenido está implementado y verificado localmente frente a estas carreras. La salida nativa de Atrás sigue pendiente en GOAL_PIECE_DRAFT_QA.md. No se verificaron dispositivos independientes ni todos los escritores del sistema; el despliegue sigue pendiente de aceptación global y autorización explícita. No hubo acceso de escritura a producción, push ni publicación.
