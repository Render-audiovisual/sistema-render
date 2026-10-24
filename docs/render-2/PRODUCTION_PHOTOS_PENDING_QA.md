# Fotos y guiones pendientes en Producciones

Actualización195: PRODUCTION_PENDING_PHOTOS_QA.md documenta el banco integrado de fotografías pendiente/repetir y la edición posterior del mismo UUID comprobada nativamente, con recarga, revisión agregada y conservación de origen. Los límites de banco y edición descritos abajo corresponden a la prueba histórica174; el traslado entre visitas y la integración real con Drive siguen pendientes.

La aplicación canónica guardó tipos de fotografías, sus enlaces y observaciones, y permitió retomar un guion pendiente en otra visita sin borrar su origen ni generar edición automática. La prueba nativa detectó además una acción inválida: ofrecer Retomar cuando la visita elegida ya contiene ese video. Productions.jsx ahora deshabilita ese botón y el manejador rechaza el mismo caso antes de escribir. El servidor conserva su validación independiente.

## Registro conectado y conservación

El fixture `/private/tmp/render2-photos174-native.mjs` creó PostgreSQL temporal55832 y HTTP52800, con cliente sintético QA174 Fotos preparado por HTTP. Se ingresó mediante Login qa_franco con sesión cookie real. El build index-gpBnBq_Z.js sirvió la aplicación sin sustituir API, adaptadores o identidad.

Desde la interfaz se creó la visita25927155-a6a6-4685-8a88-2e554f3e475d del23/10/2026, con Franco participante. Se registraron dos tipos, no cantidades de imágenes:

- Retratos del equipo, Realizada, enlace example.invalid/qa174/retratos y observación sobre fondo neutro.
- Fotos del local, Repetir, enlace example.invalid/qa174/local y nota de toma oscura que debe repetirse con luz de mañana.

Se añadió QA174 Testimonio pendiente con guion de entrevista y observación de que faltó el encargado. Recargar conservó los dos registros de fotos y el guion, que pudo abrirse desde Ver guion. El Banco de pendientes mostró el video.

Se creó otra visita del mismo cliente,2da04a92-f410-479c-a861-9875fe5ea4b5, para28/10/2026, y se retomó el guion allí. El origen quedó Pendiente; el registro nuevo, Planificado, con video_origen_id y el mismo título/guion. La nota original se conserva en el origen; no se afirma que el destino copie todas las observaciones ni el material. La validación READ ONLY de identidad y dominio pasó en `/private/tmp/render2-photos174-observe.mjs`; salida `/private/tmp/render2-photos174-observed.json`. Comprobó dos visitas, dos UUID de fotos con campos/actor esperados, dos videos con linaje, cero tareas y cero eventos editoriales.

El banco lista guiones, no fotos. Las fotografías Repetir permanecen identificadas en su visita original. No se implementó transferencia ni banco global de fotografías en este corte. Tampoco se abrió Drive: los enlaces son sintéticos.

## Corrección del destino idéntico

Antes del cambio, tras retomar el guion el botón seguía habilitado contra la misma visita. Un intento nativo recibió el rechazo del servidor: El video pendiente no pertenece a otra visita de este cliente. El observador confirmó que no creó un tercer video.

La corrección agrega `selected.id===video.visita_id` al disabled, un título explicativo y una guarda imperativa en resume con aviso para elegir otra visita. Mantiene el rechazo por cliente distinto/sin destino y conserva exactamente el POST permitido para otra visita del mismo cliente. No cambia el contrato ni reemplaza permisos o validación de servidor.

Dos regresiones nuevas ejecutan el callback real y la expresión JSX de disabled/title; cubren destino igual, ausente, otro cliente, busy y destino permitido. Pasaron136 focales de Producciones,2363 frontend y build index-BBTTJSME.js. Logs: `/private/tmp/render2-photos174-focused.log`, `/private/tmp/render2-photos174-frontend.log`, `/private/tmp/render2-photos174-build.log`. No se repitió la suite global backend: no se cambió su código.

Un segundo fixture nuevo, `/private/tmp/render2-resume174b-native.mjs`, puerto55833/HTTP52801, sembró por SQL una visita y su guion para validar solo el caso corregido. Login real y UI canónica a390×844 mostraron Retomar deshabilitado con la ayuda de destino idéntico; isEnabled devolviófalse. Captura inspeccionada: `/private/tmp/render2-resume174b-mobile.png`. No equivale a alta nativa del fixture segundo ni repite el traslado permitido del primero. La captura del registro original `/private/tmp/render2-photos174-mobile.png` corresponde al build previo; su medición confirmó scrollWidth390/innerWidth390, no validación exhaustiva de todos los formularios móviles. Se restauraron los viewports.

## Limpieza y coordinación

Se verificaron los PID propios8117 y8704 antes de SIGTERM. Ambos handles terminaron exit0, con cero tareas/eventos y cleanup absent:true/ENOENT para `/private/tmp/render2-local-1r7hI1` y `/private/tmp/render2-local-PUddlh`. Se cerraron las pestañas159/160. Solo se eliminaron estos fixtures sintéticos descartables; no se tocaron bases existentes, servicios ajenos ni producción.

Hypatia revisó el flujo de fotos y sus límites. El coordinador ejecutó UI/SQL de observación, corrigió y probó el destino idéntico. También se confirmó por fuente que la flecha Bajar del tablero no infiere el final global al llegar al límite cargado: se conservó esa protección y la acción Al final. Las skills de trabajo estructurado y verificación guiaron la separación entre evidencia nativa, SQL y regresiones; la documentación sigue local.

El recorrido acredita alta y persistencia de fotos, guion retomado con origen y la corrección local descrita. No acredita edición posterior del mismo UUID de foto, dos dispositivos, transferencia de fotos, publicación externa ni aceptación completa de Render2.
