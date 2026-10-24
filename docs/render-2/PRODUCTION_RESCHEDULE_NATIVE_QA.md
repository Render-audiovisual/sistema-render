# Reprogramación de visitas con edición vinculada

Un integrante de Producción reprogramó una visita desde su agenda a otro mes y conservó videos, fotos, guiones, participantes y dos tareas de edición independientes. La aplicación siguió la fecha nueva, reparó un enlace antiguo y restauró el detalle al volver atrás. Verificado por alcance en desarrollo local, sin cambios de producto, migraciones sobre bases existentes ni despliegue.

## Recorrido de navegador

El fixture creó por HTTP una tarea de visita, su registro automático, dos videos grabados, una fotografía por tipo y dos envíos de edición a distintos responsables. Solo la cuenta sintética adicional y el cliente se prepararon con SQL sobre la base nueva. El navegador ingresó como qa_producer, rol produccion, seleccionó la visita del24/10 desde el listado del día y guardó03/11 mediante Editar datos de la visita.

Después del guardado, mes, día, UUID seleccionado y filtro de cliente coincidieron en URL y pantalla. El listado visible mostró una visita con sus dos videos y fotos. Los enlaces continuaron apuntando a la tarea origen1 y ediciones2/3, con Luciano y Franco como editores y entregas06/11 y07/11. Recargar conservó el detalle. Abrir el enlace antiguo de octubre reparó mes/día según el servidor. Mes anterior mostró octubre sin visita; Atrás volvió al03/11 con el mismo registro seleccionado.

En390×844, la página midió375px de ancho, sin desbordamiento del documento. Hubo una sola entrada de agenda visible; el DOM contiene además la alternativa de escritorio oculta por CSS, no una segunda visita en datos. Las capturas son `/private/tmp/render2-reschedule183-mobile.png` y `/private/tmp/render2-reschedule183-desktop.png`. No certifica dispositivos físicos ni todos los tamaños o roles.

La primera ejecución de automatización cambió el valor aparente del control de fecha sin confirmar el estado React y envió una actualización sin reprogramación; el paso nativo posterior sí reprogramó. El cierre encontró revisión9 frente a8 esperada, por los dos envíos, y limpió su raíz `/private/tmp/render2-local-zQHehY`. No se contó como recorrido aprobado. La repetición limpia usó el control nativo antes del único guardado; pasó revisión+1, todas las comparaciones y cleanup ENOENT de `/private/tmp/render2-local-ujPR5D` con salida0. No se cambió el producto para acomodar el automatismo.

## Evidencia de PostgreSQL y API

La repetición validó identidad de la base render2_local_test, usuario render2_fixture, puerto55842 y directorio exacto generado. Al cerrar, el origen conservó ID/estado y pasó al03/11. Doce tablas observadas conservaron sus filas completas; tareas se compararon excluyendo únicamente el origen que debía cambiar de fecha. Videos, fotos, asignaciones y entregas de edición no se reescribieron. La API omitió la visita en octubre y la incluyó en noviembre.

La prueba permanente `backend/test/render2-production-source-reschedule.integration.test.js` añade invariancia detallada del origen y de la visita, actor de actualización, conflictos de revisión antigua y reintento del handoff original sin nuevas tareas. Las entidades operativas se crean por API, no insertando sus filas directamente. Poincare la implementó y el coordinador la revisó y ejecutó físicamente:5 aprobadas sin omitidas; raíz `/private/tmp/render2-local-POs7o6` retirada con ENOENT. Log `/private/tmp/render2-reschedule183-source.log`.

Se renovó también `render2-production-full-workflow.integration.test.js` para bearer y cookie:17 aprobadas sin omitidas, con entregas, correcciones, aprobaciones, reprogramación y proyecciones en Inicio/Calendario/Reportes. Raíces `/private/tmp/render2-local-qb3ftN` y `/private/tmp/render2-local-uVkGrA` retiradas con ENOENT. Log `/private/tmp/render2-reschedule183-workflow.log`. Son22 comprobaciones físicas en total, no22 recorridos nativos. La nueva prueba aislada mantiene vacíos entregas/revisiones; el recorrido completo renovado cubre esos registros poblados.

La regresión backend `npm test` pasó1982 y omitió123 integraciones optativas, sin fallos; log `/private/tmp/render2-reschedule183-backend.log`. No se repitió frontend/build porque no cambió producto; se probó el build existente index-BL1Y4AK0.js de la integración anterior.

## Coordinación y límites

Hypatia revisó navegación, readback y contratos; Poincare revisó las relaciones y añadió la regresión. El coordinador ejecutó el navegador, las pruebas físicas y las comparaciones. La guía de verificación exigió recorrido de UI hasta PostgreSQL y delimitó los resultados; la documentación permanece en el repositorio local.

No se modificaron fechas de edición al mover la visita ni se registró publicación real. Quedan fuera de este cierre la reprogramación de contextos históricos protegidos, proveedores, dispositivos independientes y aceptación transversal de Render2. Los servidores y pestañas temporales quedaron cerrados y el viewport restaurado.
