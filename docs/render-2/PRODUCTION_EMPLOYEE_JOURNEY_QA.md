# Producción con tres editores empleados — corte282

## Alcance

Se conserva la suite de recorrido audiovisual en transportes bearer y cookie, con dos dueños que también editan y un editor empleado. Se añade una tercera cohorte cookie con tres empleados de rol edicion:91003,91005 y91006; dos dueños separados crean visita, envían cada video a edición y revisan. Los participantes de visita no se confunden con editores remotos. No se cambia producto ni se reemplaza el caso operativo anterior.

91005/91006 se crean exclusivamente dentro del clúster generado PG55913, después de verificar identidad de fixture; copian en SQL el hash de la contraseña sintética ya conocida del fixture91003. Ninguna cuenta/hash real se lee, imprime o provisiona. Se verifican roles recibidos del servidor y las cinco sesiones se renuevan al final. Esto no acredita roster real aprobado ni onboarding de Franco/Agustín.

Cada empleado recibe tarea distinta por video/UUID, entrega versión1, no puede autoaprobar esa entrega ni entregar en la tarea de otro editor, recibe corrección de dueño, entrega versión2; aprobar versión1 devuelve409 y el dueño aprueba versión2/finaliza. Persisten seis entregas y seis decisiones con actor/artefacto/revisión exactos. Retries tardíos no duplican ni reinician tareas terminadas. Reprogramar visita no cambia entregas. Inicio personal, calendario mío/equipo y Reportes conservan IDs, fechas y estado. El snapshot editorial permanece sin piezas/cuotas/eventos inventados por terminar trabajo. La cohorte separada de acuerdo→objetivos→producción→publicación explícita sigue en el coordinador para verificar esa otra relación.

Rechazos se contrastan con snapshots de las tablas comerciales/historial declaradas por la suite; no se afirma invariancia de toda la base de datos ni del registro de autenticación.

## Ejecución

Harvey modificó únicamente `backend/test/render2-production-full-workflow.integration.test.js`; coordinador revisó el diff y ejecutó las pruebas reales. Superpowers/Verification guiaron alcance, seguridad de fixtures y distinción HTTP/navegador.

- `npm run qa:core:local` antes de ampliación sobre5283c09:90PASS/0FAIL/0SKIP, salida0; log `/private/tmp/render2-goal282-core.log`.
- Mismo comando después de ampliación:99PASS/0FAIL/0SKIP, salida0,26394ms; log `/private/tmp/render2-goal282-core-expanded.log`. Diez archivos fijos y doce fixtures (producción ahora tres cohortes), no99 recorridos independientes. Hooks de cleanup/ENOENT pasaron; diez raíces impresas y dos verificadas por hooks sin impresión. Cohorte nueva raízOvxUUB, PG55913.
- Suplemento serial de `render2-project-deliverable-approvals`, `render2-goal-content-capability`, `render2-feedback-browser-writes`, `render2-moodboard-reference-writes` (todos `.integration.test.js` con opt-in):60PASS,0FAIL/SKIP, salida0; `/private/tmp/render2-goal282-supplement.log`. Cuatro fixtures/puertos55735,55847,55770,55774; hooks cleanup/ENOENT pasaron. No cuentan como parte de los99.
- Regresiónbackend `npm test`:2333PASS/151opt-inSKIP/0FAIL, salida0; `/private/tmp/render2-goal282-backend.log`. La cohorte nueva es omitida, no ejecutada, en ese comando.
- Pruebas de coordinador3PASS y entrada canónica/transitiva App/Vite4PASS: `/private/tmp/render2-goal282-runner.log` y `canonical.log` con mismo prefijo render2-goal282. El grafo no alcanza preview/sandbox recuperados; eso no certifica todos los sinks o artefactos de release.

## Límites y siguientes gates

No hubo prueba roja de defecto ni corrección de producto: se amplía cobertura de una garantía ya implementada. Todo HTTP/PostgreSQL sobre la aplicación principal; cookies administradas por helper, no navegador ni dispositivos físicos. No hay nueva compilaciónfrontend; build281 OJAdpaMU y su evidencia visual conservan su alcance anterior.

No sustituye el recorrido UI conectado multirol sobre el grafo actual, el QA visual de todos los módulos ni una aceptación global. A–C tienen evidencia integrada de estados/versiones/IDs; D límites financieros por cinco roles y dos admins con cookies/canarios en otra suite; E/F persistencia/orden/destinos y proyectos víaHTTP no prueban todos los recorridos de navegador. La matriz amplia de238 y los límites de281 siguen vigentes.

Pendientes de mayor impacto: bindings explícitos/aprobados de revisores (persisten literales de notificación en server.js y elección de revisor adicional sin resolver), cuentas reales independientes provisionadas, validación nativa integrada y proveedores/infraestructura autorizados. No se deduce autoridad de nombres QA ni se infieren cuentas de producción. Sin DB configurada, nuevos esquemas de producto, env real modificado, despliegue o certificación de preparado para desplegar.
