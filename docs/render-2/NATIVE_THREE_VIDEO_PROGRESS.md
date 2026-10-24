# Recorrido audiovisual nativo conectado en curso

El recorrido usa la aplicación canónica compilada, Express real, PostgreSQL temporal y sesiones cookie obtenidas desde Login. Ya creó una visita, tres videos, tres piezas y exactamente tres tareas originales de cuota. El primer video completó entrega, corrección, segunda entrega, aprobación y finalización desde la interfaz. Los otros dos todavía están pendientes. No se declara aceptación nativa completa del circuito.

## Entorno aislado observado

El scaffold `/private/tmp/render2-journey161-native.mjs` inició un clúster nuevo mediante startLocalHarness y verificó base, usuario, dirección, puerto y directorio. Cliente QA169 Estudio se creó por HTTP de preparación; el resto del recorrido descrito abajo se realizó por controles de la interfaz. No se fabricaron tareas, vínculos ni evidencia en SQL.

El build servido es el canónico de168, sin sustitución de getSesion, adaptadores o API. Se usaron cuentas QA independientes, no un selector local Franco/Agustín. Los enlaces de material y entregas son example.invalid y no se abrieron proveedores. La prueba no acredita Drive, Google OAuth ni cuentas reales de la agencia.

## Acciones realizadas desde la interfaz

1. Login qa_franco. Nueva visita de23/10/2026, con Franco y Agustín participantes, y tres videos grabados con guiones y enlaces independientes.
2. Acuerdo mensual de tres reels y cero carruseles, importe sintético0. Preparación explícita del objetivo con Luciano como responsable inicial:0 tareas vinculadas y3 nuevas, IDs1,2 y3.
3. Cada video se vinculó al casillero correspondiente, conservando esas tareas. Programaciones editoriales28,29 y30/10, separadas de la visita.
4. Envíos individuales: video1 a Luciano para26/10; video2 a Franco para27/10; video3 a Agustín para28/10. No se crearon tareas4–6. Las colaboraciones originales de Luciano se conservaron en2 y3; no se las interpreta como permisos indebidos ni como tres asignaciones exclusivas.
5. Logout y Login qa_luciano. La tarea1 mostró guion/material y visita compartidos. Se inició el trabajo y se registró v1; pasó a revisión.
6. Logout y Login qa_franco. Se pidió la corrección de apertura y subtítulos contra la entrega v1 observada; quedó actor91001, revisión6 y la nota. La tarea regresó a En proceso.
7. Logout y Login qa_luciano. Se registró v2 corregida, revisión de tarea7. La recarga conservó dos entregas y una corrección.
8. Logout y Login qa_franco. Se reconoció expresamente la entrega v2, se aprobó esa versión y se finalizó la tarea1. El historial mostró dos decisiones, sin convertir el trabajo en publicación real.

El menú se adaptó al cambio de ancho de la ventana. El menú de empleado no mostró Finanzas. Esto no reemplaza la prueba de privacidad de todas las respuestas API.

## Lectura independiente de PostgreSQL

`/private/tmp/render2-journey169-observe.mjs` comprueba la identidad exacta antes de leer dentro de una transacción READ ONLY. Su salida quedó en `/private/tmp/render2-journey169-observed.json`:

- Una visita, revisión10; tres videos y tres tareas, con tarea_entrega_id/tarea_edicion_id1,2,3.
- Responsables91003,91001 y91002, respectivamente; Luciano sigue como colaborador de2 y3 por la preparación inicial.
- Tarea1 finalizada, revisión9; tareas2 y3 pendientes, revisión3.
- Dos entregas de Luciano para1, revisiones5 y7; corrección y aprobación de Franco, revisiones6 y8.
- Tres publicaciones pendientes con programación28,29,30/10; todas con fecha real nula y cero eventos editoriales reales.

La consulta es observación, no una transición del recorrido. El script tiene asserts para este punto intermedio y debe revisarse cuando avance el dominio; no debe usarse sin cambios para el estado final con publicaciones confirmadas.

Capturas: `/private/tmp/render2-journey169-correction.png` y `/private/tmp/render2-journey169-finalized-mobile.png`. El segundo nombre es histórico: el encuadre observado mide855×764, no acredita390px. Muestra Finalizada y el editor asignado. La UI de ese build conserva el texto antiguo de vínculo mensual; su corrección de fuente se documenta en PROJECT_REFRESH_RECOVERY_QA.md.

## Continuación y limpieza

Al registrar este punto el proceso propio1700 y su handle55197 seguían vivos. El servidor HTTP está en127.0.0.1:52797; PostgreSQL55829; raíz generada `/private/tmp/render2-local-A9dCXF`. La pestaña propia154 se conserva como handoff, con Franco conectado en tarea1. Estos datos son un checkpoint, no prueba futura de vida: comprobar handle/proceso e identidad antes de continuar. No reiniciar solo por timeout de observación.

El scaffold tiene temporizador de una hora y finally de limpieza verificado por ENOENT. Al finalizar se debe esperar su resultado final y cleanup. No se ha declarado esa limpieza realizada todavía. No tocar los PostgreSQL preexistentes ni usar su directorio/puerto para reemplazar el fixture.

Falta completar las entregas/revisiones/aprobaciones de2 y3, confirmar publicaciones efectivas explícitas desde UI, contrastar objetivos/Inicio/Calendario/Reportes con nuevas sesiones y comprobar el estado final antes de cerrar este gate. También continúan los otros requisitos de aceptación global. El parcial169 no redefine esos criterios.
