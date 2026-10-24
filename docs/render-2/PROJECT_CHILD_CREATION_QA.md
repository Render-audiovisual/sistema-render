# Creación recuperable de etapas hitos y entregables

Proyectos conserva ahora una identidad por intento de creación de etapa, hito o entregable. Si se pierde la confirmación, repetir explícitamente la misma solicitud recupera el recurso existente, sin crear otro ni duplicar actividad. El contrato se implementó en frontend y backend y se probó con PostgreSQL temporal. No se actualizó ninguna base existente ni producción.

## Error corregido

Las creaciones hijas no tenían recibo. Tras un commit con respuesta perdida, Guardar encontraba un409 por la revisión antigua; actualizar el proyecto y adoptar otra revisión mantenía el formulario de creación y podía insertar otro recurso. El CAS impedía la repetición inmediata, pero no identificaba el intento original después de ese rebase.

Cada formulario de alta genera ahora un UUID al abrirse. La revisión y el cuerpo enviados quedan congelados ante un resultado ambiguo. Solo Verificar la misma solicitud permite repetirlos. Un409 no ofrece adoptar otra revisión, ni siquiera mediante el callback interno. Empezar otra creación requiere cerrar y abrir un formulario nuevo explícitamente.

## Contrato compartido

Los POST de `/api/proyectos/:id/etapas`, `/hitos` y `/entregables` exigen `request_id` y `expected_revision`, además de sus campos anteriores. Un identificador ausente devuelve428; un UUID malformado devuelve400. Las ediciones PATCH no aceptan claves de creación.

La respuesta contiene `proyecto`, `replayed` booleano y `creacion` con seis campos: `request_id`, `proyecto_id`, `recurso_tipo`, `recurso_id`, `actor_id` y `expected_revision`. El frontend comprueba esos vínculos, la presencia del recurso en su colección y la revisión: alta nueva exactamente base+1; replay permite una revisión posterior. Recuperar una creación no certifica el contenido actual como aprobado.

El servidor captura ID, rol y epoch antes del lease, los revalida y retiene el actor bajo FOR SHARE. El mutex global existente serializa proyectos antes del lock del proyecto. Antes de recuperar un recibo vuelve a exigir permiso actual de edición y proyecto no archivado; no reutiliza permisos históricos del intento.

La clave del recibo es actor e identificador de solicitud. Su hash enlaza proyecto, tipo, revisión original y payload normalizado. Un recibo incompatible devuelve409. El replay comprueba existencia en la tabla, proyecto e ID correspondientes antes de devolver el detalle actual. Se resuelve antes del cap o CAS original, sin DML adicional. Un hijo eliminado deja el recibo como tombstone y no se recrea.

La migración088 añade `project_child_create_receipts`, claves restrictivas al actor/proyecto y un trigger que impide editar o borrar recibos. No modifica contenido histórico. No hay FK polimórfica al hijo que elimine ese tombstone. Recurso, revisión del proyecto, actividad y recibo se confirman juntos. Startup comprueba columnas y binding habilitado del trigger, sin instalarlo ni reparar el esquema; esto no certifica por sí solo el cuerpo del trigger o todas las constraints.

## Equipo y archivos

- Poincare: `backend/src/projects.js`, `startup-schema.js`, migración088 y nuevo `backend/test/project-child-creation.test.js`.
- Hypatia: `frontend/src/pages/Projects.jsx`, `projectsModel.js` y nuevo `projectChildCreation.test.js`.
- Carver: fixtures existentes de proyectos, aprobaciones, calendario, navegación y startup; pruebas físicas ampliadas y defer de088 en el harness histórico.
- Beauvoir: revisión independiente de contratos frontend/backend, sin nuevos P1/P2 confirmados en el delta.
- Integrador: contratos, gestos nativos, pruebas completas y físicas, limpieza autorizada de recursos y documentación local.

Los archivos críticos tuvieron propietarios únicos. No se modificaron App.jsx, server.js, proveedores, credenciales ni fuentes heredadas de preview/sandbox.

## Pruebas físicas

La suite `render2-projects.integration.test.js` pasó20 comprobaciones sobre una base nueva generada por `startLocalHarness`, con identidad de directorio, puerto, usuario y base verificados. Incluye preservación de historia al aplicar063/079/088, altas de los tres tipos, respuesta no usada para construir el retry, replay con contenido posterior, concurrencia, actor distinto, cambio de intención/proyecto/tipo, revocación, recibos inmutables, cap y tombstones. También mantiene CRUD, tareas vinculadas, permisos, proyecciones sin finanzas y archivo. Los snapshots incluyen recibos y actividad. El retry físico ignora la primera respuesta, no simula pérdida de red ni ejecuta el frontend. Promise.all comprueba201/200 y unicidad, sin una barrera que fuerce contención; esos límites no se presentan como otro recorrido de UI.

Otras tres suites pasaron19 comprobaciones físicas: calendario de proyectos, aprobaciones versionadas y actualización histórica de entregables. Se ejecutaron secuencialmente. Los after de cada suite verificaron limpieza y ausencia del directorio temporal. Ninguna se dirigió a una base existente.

Comandos desde backend:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-projects.integration.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-project-deliverable-approvals.integration.test.js test/render2-project-deliverable-upgrade.integration.test.js test/render2-calendar-projects.integration.test.js
RENDER2_RUN_LOCAL_INTEGRATION=false npm test
```

La primera ejecución física detectó dos problemas de fixtures: un negativo de cap carecía del UUID y el validador del rechazo inmutable esperaba un código SQL que el transporte de diagnóstico no conserva. Se corrigieron esos tests sin cambiar producto. La suite final pasó completa. La regresión backend final aprobó1969 pruebas, con119 omitidas y cero fallos; las suites físicas anteriores se ejecutaron por separado, no se presentan como todas las integraciones existentes.

Frontend pasó2346 pruebas, sin omitidas ni fallos;48 focales de proyectos. Backend focal pasó47 pruebas. El build produjo `index-DzFZ8sQQ.js`. Logs locales: `/private/tmp/render2-projects168-physical-final.log`, `render2-projects168-related-physical.log`, `render2-projects168-frontend-final.log`, `render2-projects168-backend-release.log` y `render2-projects168-build.log`.

## Prueba visual con transporte sintético

`/private/tmp/render2-projects168-browser.mjs` monta ProjectsPage real bajo StrictMode, con transporte HTTP y modelos reales. Sustituye la lectura de sesión y responde desde una API sintética en memoria sobre loopback, con CSP limitada al mismo origen. No es una segunda aplicación operativa ni prueba de autorización real.

En escritorio se creó una etapa simulando un503 después del commit sintético. El formulario conservó el título, bloqueó Guardar y mostró verificación explícita. Antes de verificar había un POST y un recibo; después hubo dos POST con UUID/cuerpo idénticos, una sola etapa y una sola revisión nueva. No hubo retry desde código de aplicación. Un primer diagnóstico con corte de socket produjo dos peticiones de transporte sin exponer el estado incierto; se cambió la simulación a503 para comprobar ese estado de forma determinista, no se atribuyó ese comportamiento al producto.

En390×844 se creó un hito con fecha30/10/2026 vinculado a esa etapa y un entregable con enlace y observaciones, en estado En revisión. Se recargó: persistieron una etapa, un hito y un entregable, tres recibos y revisión4 en la API sintética; no se aprobó ni publicó contenido. El documento midió390px, sin desbordamiento horizontal. Esto verifica recarga de memoria del servidor sintético, no un recorrido nativo conectado a PostgreSQL.

Capturas: `/private/tmp/render2-projects168-uncertain-desktop.png` y `/private/tmp/render2-projects168-mobile-records.png`.

## Recursos locales y actualización

El usuario autorizó liberar únicamente memoria compartida huérfana verificada. Se eliminaron cuatro segmentos de56 bytes, IDs65537,1179650,393219 y35389445. Antes de cada eliminación se revalidaron clave, propietario, cero conexiones, creador ausente, LPID0 y ausencia de adjuntos históricos. El script local `/private/tmp/render2-verified-ipc168.mjs` contiene la lista cerrada y aborta si cambia la observación. No es una tarea recurrente de limpieza.

Los dos PostgreSQL preexistentes, PID865 y54388, permanecieron activos y conservaron sus segmentos conectados. No se borraron archivos ni registros comerciales. Los segmentos eran memoria temporal sin usuarios conectados; no tienen recuperación de contenido y no se necesitó restaurarlos. La capacidad recuperada permitió ejecutar nuevamente clústeres aislados, que se limpiaron al terminar. El bloqueo SysV anterior ya no impide estas pruebas.

Para actualizar una instalación real se requiere aplicar088 explícitamente sobre la base autorizada y coordinar frontend/backend: el servidor nuevo rechaza altas antiguas sin UUID y el frontend nuevo no confirma respuestas antiguas sin recibo. Antes deben revisarse backup, entorno y gates pendientes. En este corte088 se aplicó solo a bases temporales generadas para QA.

## Pendientes

El recorrido nativo conectado a PostgreSQL de estas altas no se ha acreditado. Continúan el audiovisual nativo completo, orden de tablero conectado, aceptación visual global y proveedores/cuentas reales autorizados. Se registró además un P2 fuera del delta: un error no403 al refrescar el detalle pone `data:null` y oculta temporalmente el editor con un borrador conservado hasta que otra lectura funciona. No se corrigió ni se presenta como pérdida definitiva del texto.

Render2 completo no está certificado ni desplegado. Este corte sí implementa y prueba físicamente la identidad de creación de los tres recursos sin reemplazar el alcance del objetivo maestro.
