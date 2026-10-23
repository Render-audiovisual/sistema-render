# Aceptación integrada del circuito de tres videos

El circuito compartido pasó una prueba física de API con PostgreSQL y sesiones cookie independientes. Un acuerdo mensual genera tres casilleros y tres tareas; una sola visita registra tres videos y reutiliza esas mismas tareas para edición. Las entregas corregidas y aprobadas no publican las piezas. La publicación requiere una confirmación explícita y queda respaldada por un evento independiente.

## Recorrido y criterios comprobados

La suite `backend/test/render2-unified-three-video-journey.integration.test.js` crea todo el dominio mediante HTTP. SQL se utiliza únicamente para verificar identidad del fixture, obtener el reloj y comprobar persistencia. No fabrica tareas, conexiones ni evidencia editorial directamente en tablas.

1. Cuentas sintéticas de Franco y Agustín con rol admin, más Luciano con rol edición, inician sesiones cookie diferentes. Se crea un cliente y su primer acuerdo mensual con tres reels y cero carruseles, revisión observada e importe sintético.
2. La preparación genera tres casilleros en cuota y tres tareas canónicas. Se conservan sus IDs, se cargan contenido y responsables por ID, y se eliminan explícitamente colaboradores anteriores antes de enviar a edición.
3. Una visita contiene tres videos con UUID, guion y enlace a material independientes. Cada video pasa de planificado a grabado. Repetir la intención de creación devuelve la misma visita, sin escritura adicional.
4. Cada video se vincula a un casillero distinto antes de editar y se envía individualmente a su responsable con su propia entrega. El total permanece en tres tareas, no seis. Las fechas de visita, entregas, programación y publicación real se mantienen separadas.
5. Cada tarea pasa por trabajo, entrega v1, corrección, entrega v2, aprobación exacta de v2 y finalización. Las decisiones retienen autor, versión, notas y revisión. Aprobar v1 obsoleta devuelve409 sin cambiar las tablas comprobadas; un editor no asignado no puede entregar los videos de los otros responsables.
6. Los reintentos exactos de asociación, entrega y corrección no agregan registros ni alteran acuerdos, objetivos o evidencia. Antes de confirmar publicaciones, las tres tareas finalizadas siguen con cero eventos reales de publicación y fechas reales nulas.
7. Se confirma cada publicación mediante acción explícita, revisión observada, request_id y occurred_at. Cada reintento conserva el evento original. Al final existen una visita, tres videos, tres tareas, tres piezas, seis entregas, seis decisiones y tres eventos de publicación.
8. Nuevas sesiones cookie leen los mismos registros. Inicio cuenta una tarea terminada por responsable; Calendario team/mine respeta asignaciones y conserva por separado visita, entregas, programación y publicaciones respaldadas por evidencia. Reportes devuelve las tareas originales y las publicaciones confirmadas. Su proyección de empleado no contiene campos ni el importe financiero sintético.

Los snapshots comparan las tablas de dominio enumeradas en la suite, incluyendo acuerdos, asignaciones, objetivos, relaciones, registro audiovisual, entregas, decisiones y evidencia. Las lecturas finales y los reintentos comprobados no realizan DML en esas tablas. La clave legacy `resumenRenderOsPorDia.*.publicadas` mide trabajo terminado; la prueba no la interpreta como evidencia de publicación real.

## Resultado y entorno

Comando ejecutado desde backend: `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-unified-three-video-journey.integration.test.js`. Resultado final: una prueba integrada aprobada, cero fallos y cero omisiones. Incluye los asserts ampliados de Reportes y privacidad.

El harness genera una base nueva `render2_local_test` con usuario `render2_fixture`, loopback55816 y directorio propio verificado. No utiliza DATABASE_URL del proyecto. El primer recorrido pasó y limpió `/private/tmp/render2-local-fbsSrq`. Un intento ampliado no llegó a arrancar por agotamiento local de segmentos de memoria compartida de PostgreSQL; su directorio `/private/tmp/render2-local-tdJD36` quedó eliminado. Después de cerrar únicamente el fixture visual propio, la repetición completa pasó y limpió `/private/tmp/render2-local-PkiFIq` con ENOENT.

Logs: `/private/tmp/render2-journey158-physical.log`, `/private/tmp/render2-journey158-resource-limit.log` y `/private/tmp/render2-journey158-final-physical.log`.

## Equipo y alcance pendiente

Poincare implementó la suite sin ejecutar servicios. El integrador revisó los contratos, corrigió una expectativa de DTO de creación, añadió comprobaciones de Reportes y ejecutó los fixtures. Beauvoir revisó independientemente la fidelidad y los límites del recorrido, sin hallazgos P1/P2.

Esta aceptación es de API y base de datos, no un recorrido nativo de tres videos en React. Utiliza dos dueños y un editor, no tres empleados editores; es secuencial, no una prueba de concurrencia. Los enlaces `.invalid` y las cuentas son sintéticos: no acredita Google Drive real, cuentas comerciales ni despliegue. El objetivo maestro sigue abierto, incluyendo QA visual global, calendario por encima del límite actual, foco del shell y orden manual nativo.
