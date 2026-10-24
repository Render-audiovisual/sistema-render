# Recorrido audiovisual nativo conectado

El recorrido con la aplicación canónica compilada, Express real, PostgreSQL temporal y sesiones cookie obtenidas desde Login completó una visita, tres videos, tres piezas y exactamente tres tareas originales de cuota. Cada tarea pasó por entrega, corrección, segunda entrega, aprobación y finalización desde la interfaz. Las tres publicaciones se confirmaron manualmente después, mediante una acción distinta. PostgreSQL conservó los mismos vínculos y no creó tareas adicionales. El entorno de prueba ya se cerró y limpió correctamente.

Esta cohorte acredita el recorrido audiovisual y su reflejo en objetivos, Inicio, Calendario y Reportes. No constituye aceptación global de Render 2.0: no incluye fotos, Drive real, publicación en redes, dos dispositivos ni todos los recorridos pendientes del prompt maestro.

## Entorno aislado observado

El scaffold `/private/tmp/render2-journey161-native.mjs` inició un clúster nuevo mediante startLocalHarness y verificó base, usuario, dirección, puerto y directorio. Cliente QA169 Estudio se creó por HTTP de preparación; el resto del recorrido descrito abajo se realizó por controles de la interfaz. No se fabricaron tareas, vínculos ni evidencia en SQL.

El build servido es el canónico de168, sin sustitución de getSesion, adaptadores o API. Se usaron cuentas QA independientes, no un selector local Franco/Agustín. Los enlaces de material y entregas son example.invalid y no se abrieron proveedores. La prueba no acredita Drive, Google OAuth ni cuentas reales de la agencia.

## Primer video desde la interfaz

1. Login qa_franco. Nueva visita de23/10/2026, con Franco y Agustín participantes, y tres videos grabados con guiones y enlaces independientes.
2. Acuerdo mensual de tres reels y cero carruseles, importe sintético0. Preparación explícita del objetivo con Luciano como responsable inicial:0 tareas vinculadas y3 nuevas, IDs1,2 y3.
3. Cada video se vinculó al casillero correspondiente, conservando esas tareas. Programaciones editoriales28,29 y30/10, separadas de la visita.
4. Envíos individuales: video1 a Luciano para26/10; video2 a Franco para27/10; video3 a Agustín para28/10. No se crearon tareas4–6. Las colaboraciones originales de Luciano se conservaron en2 y3; no se las interpreta como permisos indebidos ni como tres asignaciones exclusivas.
5. Logout y Login qa_luciano. La tarea1 mostró guion/material y visita compartidos. Se inició el trabajo y se registró v1; pasó a revisión.
6. Logout y Login qa_franco. Se pidió la corrección de apertura y subtítulos contra la entrega v1 observada; quedó actor91001, revisión6 y la nota. La tarea regresó a En proceso.
7. Logout y Login qa_luciano. Se registró v2 corregida, revisión de tarea7. La recarga conservó dos entregas y una corrección.
8. Logout y Login qa_franco. Se reconoció expresamente la entrega v2, se aprobó esa versión y se finalizó la tarea1. El historial mostró dos decisiones, sin convertir el trabajo en publicación real.

El menú se adaptó al cambio de ancho de la ventana. El menú de empleado no mostró Finanzas. Esto no reemplaza la prueba de privacidad de todas las respuestas API.

## Observación intermedia del primer video

`/private/tmp/render2-journey169-observe.mjs` comprueba la identidad exacta antes de leer dentro de una transacción READ ONLY. Su salida quedó en `/private/tmp/render2-journey169-observed.json`:

- Una visita, revisión10; tres videos y tres tareas, con tarea_entrega_id/tarea_edicion_id1,2,3.
- Responsables91003,91001 y91002, respectivamente; Luciano sigue como colaborador de2 y3 por la preparación inicial.
- Tarea1 finalizada, revisión9; tareas2 y3 pendientes, revisión3.
- Dos entregas de Luciano para1, revisiones5 y7; corrección y aprobación de Franco, revisiones6 y8.
- Tres publicaciones pendientes con programación28,29,30/10; todas con fecha real nula y cero eventos editoriales reales.

La consulta es observación, no una transición del recorrido. El script tiene asserts para este punto intermedio y debe revisarse cuando avance el dominio; no debe usarse sin cambios para el estado final con publicaciones confirmadas.

Capturas: `/private/tmp/render2-journey169-correction.png` y `/private/tmp/render2-journey169-finalized-mobile.png`. El segundo nombre es histórico: el encuadre observado mide855×764, no acredita390px. Muestra Finalizada y el editor asignado. La UI de ese build conserva el texto antiguo de vínculo mensual; su corrección de fuente se documenta en PROJECT_REFRESH_RECOVERY_QA.md.

## Los otros dos videos y las publicaciones

Franco completó la tarea2: primera entrega, corrección del segundo paso y cierre, segunda entrega, aprobación de esa versión y finalización. Agustín inició sesión con su cuenta independiente y completó la tarea3, con corrección del llamado a la acción y contraste de subtítulos. En las tareas2 y3 el editor también actuó como administrador revisor, algo permitido por el sistema; no prueban revisión por una segunda persona. La tarea1 sí tuvo editor Luciano y revisor Franco separados.

Una consulta READ ONLY independiente, `/private/tmp/render2-journey170-observe.mjs before`, comprobó tres tareas finalizadas en revisión9, seis entregas, seis decisiones, tres piezas pendientes con fecha real nula y cero eventos editoriales. La salida es `/private/tmp/render2-journey170-before.json`.

Agustín confirmó cada pieza por separado en Registro de publicación, con fecha real de prueba23/10/2026 a09:01,09:03 y09:05 de Córdoba. Cada acción exigió reconocer expresamente la publicación y mostró Confirmada manualmente, actor91002 y versión1. Los registros son sintéticos; no se enviaron publicaciones a redes.

El observador `after` pasó, incluida su versión reforzada tras la revisión independiente de Carver. Compara identidad, visita, videos, tareas, asignaciones responsables, casilleros, entregas y decisiones contra el snapshot anterior. Exporta las versiones editoriales y comprueba sus current_event_id y revisiones contra tres eventos distintos. Las fechas reales son12:01,12:03 y12:05Z; las programaciones28,29 y30/10 no cambiaron. Resultado: `/private/tmp/render2-journey171-after.json`. Estos asserts cubren las entidades consultadas de este cliente, no duplicación global ajena ni colaboradores nuevos.

## Reflejo en las otras secciones

- Publicaciones conservó las tres confirmaciones después de recargar.
- Clientes mostró3/3,100% y las tres tareas Finalizada. El texto explica que mide trabajo, no publicación.
- Inicio de Agustín mostró1/1 tarea terminada y cero abiertas. Tras cerrar sesión e ingresar como Luciano, mostró3/3 por su responsabilidad en1 y colaboración conservada en2 y3; no se confundió ese total personal con tres ediciones exclusivamente suyas.
- Calendario, Equipo y Programación mostró las piezas en28,29 y30. Al cambiar a Publicaciones confirmadas, mostró tres eventos el23 y ninguno el28. La agenda del23 enumeró las tres piezas y su clasificación manual.
- Reportes de dueño mostró tres reels programados y tres confirmados manualmente, una visita, tres videos grabados, cero fotos y tres tareas únicas. Las filas de personas indican colaboraciones y no deben sumarse como producción global.
- En la nueva sesión de Luciano, Reportes conservó los tres registros editoriales y la visita; Trabajo por persona mostró solo a Luciano y no hubo cuota administrativa en esa respuesta. El menú no incluyó Finanzas.

La prueba HTTP adicional `/private/tmp/render2-journey171-http.mjs` obtuvo una sesión bearer real del fixture para Luciano91003. Reportes devolvió200, con186 campos inspeccionados y sin coincidencias en la lista de nombres económicos privados de la prueba. Sueldos y Pagos con período válido devolvieron403. La petición inicial de Pagos sin período devolvió400 de validación, por lo que no se usó como evidencia de autorización. Resultado final: `/private/tmp/render2-journey171-http.json`. Esto cubre esas respuestas, no todas las rutas posibles ni reemplaza las pruebas de inyección de campos privados existentes.

## Escritorio y celular

Captura de Reportes en el ancho normal: `/private/tmp/render2-journey171-reports.png`. La validación móvil midió innerWidth390, innerHeight844 y scrollWidth390; captura `/private/tmp/render2-journey171-calendar-mobile.png`. No hubo desbordamiento horizontal en ese calendario, pero los tres filtros en una fila recortan las etiquetas de tipo y cliente. La legibilidad de filtros sigue pendiente. La captura muestra el comienzo de la agenda; la enumeración completa se verificó en el árbol accesible. El viewport temporal se restauró.

El ingreso local incluyó el iframe habitual de Google del formulario, pero no se usó Google OAuth; las identidades fueron cuentas QA de usuario y contraseña.

## Limpieza y pendientes

Se verificó que PID1700 correspondía exactamente al scaffold propio y se le envió SIGTERM. El handle55197 terminó con exit0, emitió el dominio final con una visita, tres videos y tres tareas finalizadas, y confirmó cleanup con absent:true para `/private/tmp/render2-local-A9dCXF`, comprobado por ENOENT. Se cerró la pestaña temporal156. No quedaron como servicios disponibles estos puertos de prueba ni se tocaron los PostgreSQL preexistentes.

Carver revisó los snapshots y límites de asserts; Hypatia contrastó contratos de métricas y fechas. El coordinador realizó las acciones nativas y las consultas aisladas. No hubo cambios de producto en este corte; solo evidencia y documentación. Continúan el ajuste móvil de filtros, QA de fotos y pendientes, dispositivos independientes, proveedores reales y la aceptación global de las demás áreas. Las pruebas locales no constituyen preparación ni autorización de despliegue.
