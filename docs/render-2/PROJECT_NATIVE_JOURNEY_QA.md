# Prueba local de proyectos de Desarrollo

El recorrido conectado verificó la creación de un proyecto web, sus etapas, hitos, entregables y una tarea existente desde la interfaz real. La aprobación corresponde a una versión concreta del entregable y se invalida al cambiar su contenido. El proyecto no genera cuotas mensuales de contenido. Es aceptación parcial local, no autorización de despliegue.

## Entorno y responsabilidades

Se usaron Express y PostgreSQL descartables en los puertos52802 y55834, con identidad y directorio exactos comprobados antes de consultar datos. Todos los registros operativos se crearon mediante el navegador; no se importaron clientes ni datos comerciales. Los enlaces example.invalid son referencias de prueba y no se abrieron.

Hypatia y Carver revisaron contratos y criterios en modo de solo lectura. El coordinador ejecutó las acciones nativas y las comprobaciones SQL. No se modificaron componentes del producto en este recorrido. Las skills de trabajo estructurado, verificación y documentación orientaron las comprobaciones y sus límites.

## Recorrido verificado

1. Franco QA creó un cliente sin acuerdo mensual y un proyecto web con responsable Designer QA, miembro Luciano QA y fechas independientes de inicio y entrega.
2. Tras cerrar sesión e ingresar como Designer QA, el responsable no administrador creó una etapa, un hito fechado y un entregable en revisión. No disponía del botón de crear o archivar proyectos ni de los accesos administrativos financieros.
3. El responsable revisó y aprobó explícitamente la versión1. Cambiar enlace y observaciones devolvió el entregable a revisión, eliminó la aprobación vigente y conservó el registro histórico. La versión2 requirió una nueva confirmación de revisión. Autor y aprobador fueron el mismo responsable; no demuestra separación de personas.
4. La recarga conservó la versión2 aprobada, la etapa y el hito. Tres recibos de creación correspondieron a los tres recursos, con actor estable y revisiones esperadas1,2,3.
5. Designer QA creó la tarea web con cliente, responsable, instrucciones, prioridad y entrega28/10/2026. Desde el proyecto consultó su ID y revisión, eligió la etapa y la vinculó sin copiarla. El vínculo sobrevivió a la recarga.
6. Desde ese vínculo abrió la tarea y cambió de pendiente a en proceso y a Para revisar. El proyecto mostró En revisión, revisión de tarea3, conservando su propio estado Planificado y revisión8.

## Comprobación independiente de PostgreSQL

Los observadores utilizaron transacciones REPEATABLE READ READ ONLY e identidad exacta de la base temporal. Las comprobaciones de versión1, edición, versión2 y vínculo final pasaron. La primera expectativa del observador final usó el rótulo para_revisar; se corrigió a en_revision, el estado canónico realmente almacenado. No fue una corrección del producto.

El corte final confirmó un proyecto, una tarea, un vínculo a su etapa y fecha de entrega28/10/2026. Los dos registros históricos de aprobación y el entregable aprobado coincidieron íntegramente con el corte anterior al vínculo. Permanecieron en cero publicaciones, historias, piezas de objetivos, eventos de publicación, objetivos mensuales, configuraciones de acuerdo y pagos del equipo.

Scripts y cortes temporales: `/private/tmp/render2-project177-native.mjs`, `/private/tmp/render2-project177-observe.mjs`, `/private/tmp/render2-project177-linked.mjs` y `/private/tmp/render2-project177-{v1,edited,v2}.json`. Son evidencia temporal, no una suite portable del repositorio.

El harness terminó con código0 y comprobó ENOENT del directorio `/private/tmp/render2-local-YBrvAs`. Se eliminaron únicamente sus datos sintéticos descartables. No se detuvieron otros servicios PostgreSQL.

## Vista móvil

La vista de detalle a390×844 mostró el menú contraído y tarjetas legibles. documentElement y body midieron390px de ancho, sin desbordamiento horizontal. Captura: `/private/tmp/render2-project177-mobile.png`. Se restauró el viewport. No se probó en un teléfono físico ni se completaron todos los formularios móviles en este corte.

## Pendientes de aceptación

Falta completar como miembro la lectura y los rechazos de escrituras desde API, terminar y aprobar la tarea con el rol correspondiente, contrastar Inicio y Calendario, y repetir el flujo completo en móvil. La ausencia de botones administrativos no sustituye las pruebas de autorización del servidor. Tampoco se aceptan por este corte todos los módulos, proveedores ni condiciones de hosting.
