# Contenido: respuesta perdida después de guardar

## Resultado y alcance

Corte194, navegador real → Express → PostgreSQL desechable. El servidor guardó una vez y la interfaz conservó el borrador como incierto cuando no recibió la confirmación. Retomar no reenvió la escritura ni adoptó silenciosamente una revisión nueva. Un segundo Guardar explícito recibió409 sin volver a modificar datos.

No se modificó producto, backend, esquema ni dependencias. Se utilizó el build index-DZ7Ii23D.js aprobado en192. Volta revisó independientemente el contrato de guardado, los límites y las comprobaciones; el coordinador ejecutó el recorrido nativo.

## Inyección controlada

El runner `/private/tmp/render2-goal194-native.mjs` creó un clúster nuevo, verificó su identidad y preparó por API un reel del cliente QA194 Cliente respuesta perdida, asignado a Luciano. Revisión inicial1, sin publicación vinculada ni copy previo.

Un script externo temporal qa194.js se cargó antes del módulo principal, de modo que el adaptador de sesión capturó ese transporte instrumentado. Conservó fetch real y delegó todas las peticiones. Un botón visible armó un único fallo, restringido al PATCH same-origin de /api/cliente-objetivos/piezas/:id/contenido. Después de recibir200 real, lanzó TypeError en lugar de entregar la respuesta a la aplicación. Mostró en el DOM únicamente contador y estado HTTP; no leyó cuerpos, cookies ni credenciales.

Esto acredita pérdida inyectada de una respuesta exitosa al cliente, no una interrupción física de red. El bundle y los componentes reales no se alteraron. Se retiró el script y se restauró dist/index.html al finalizar.

## Recorrido observado

1. Luciano abrió Reel1 y escribió `QA194 guardado real con respuesta perdida`.
2. Armó el fallo y pulsó Guardar contenido. El control indicó PATCH1, servidor200, confirmación descartada. El editor siguió abierto con el texto exacto y mostró el error; no anunció éxito.
3. Pulsó Inicio en la navegación real. Apareció Contenido sin guardar con el mensaje No se pudo confirmar el guardado. Retomá el borrador para revisar el contenido. El contador continuó en1.
4. Retomar abrió la pieza con el texto idéntico tanto en el contenido leído del servidor como en el textarea conservado. Mostró el aviso de revisión original retenida. El contador seguía en1: ni navegación ni recuperación generaron otro PATCH.
5. Pulsó Guardar explícitamente otra vez. El control indicó PATCH2, servidor409, y la interfaz informó del conflicto sin borrar el texto.

No se realizó una espera prolongada de reintentos; el contador acredita ausencia de reenvío durante el recorrido observado. La salida ocurrió después de recibir TypeError, no durante una petición pendiente. No se atribuye a otra persona el cambio de esta prueba: fue el primer guardado del propio usuario cuyo ACK se ocultó.

## Integridad y limpieza

El runner terminó0. Revisión final2: incremento exacto de1. Tarea y pieza conservaron el mismo copy enviado. Tras excluir únicamente copy/updated_at y la revisión incremental de tarea, todos sus demás campos coincidieron con la preparación; no hubo registros adicionales. Las otras siete tablas permanecieron idénticas: clientes, cliente_configuraciones, tarea_asignaciones, publicaciones, historias, cliente_objetivos_mensuales y cliente_objetivo_eventos. Autenticación no forma parte de ese snapshot comercial.

Se verificó ausencia de `/private/tmp/render2-local-PhayoN`, se cerró solo la pestaña13 creada y se retiró el control de QA. No se usaron bases configuradas ni servicios externos para datos operativos. No hubo despliegue ni push.

Capturas: `/private/tmp/render2-goal194-uncertain.png` y `/private/tmp/render2-goal194-retry-conflict.png`. No se renovaron suites globales ni build en este corte: es evidencia nativa adicional, no nuevas cifras de regresión.

## Pendientes

Desmontaje mientras la petición sigue pendiente, carreras de logout, demás formularios y aceptación integral. La interfaz aún exige revisión humana: no reconcilia automáticamente el mismo texto ni infiere éxito del GET posterior. No se acredita conservación ante una recarga aceptada o cierre de pestaña.
