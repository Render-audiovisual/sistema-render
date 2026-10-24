# Diagnóstico nativo de pérdida de borrador al volver atrás

Estado posterior: GOAL_DRAFT_RECOVERY_QA.md documenta la conservación temporal implementada y comprobada para navegación canónica. Este diagnóstico conserva la falla original y su contrato; no significa que los recorridos ya verificados continúen perdiendo el borrador. Siguen abiertos los límites de rutas heredadas y otros formularios.

La pérdida de borrador sigue sin corregir, pero ahora tiene una frontera observada: una salida nativa de Atrás llegó con cancelable false. El guard funciona para un traversal cancelable y conserva el borrador al rechazar el descarte; no puede garantizar conservación cuando el navegador permite salir sin cancelación. Esto explica un mecanismo reproducible, no prueba retrospectivamente todas las propiedades del intento anterior.

## Entorno y observación

Se reutilizó el script de preparación sintética render2-goal186-native.mjs en un clúster nuevo. Navegador integrado Chrome155 en macOS, frontend index-DMPN57gt.js, backend del commit8d2f11b, PostgreSQL55846 y HTTP52811. La sesión qa_luciano abrió Inicio, Clientes y objetivos, Reel1 y Editar contenido. La respuesta actual permitió editar su tarea por ID, confirmando nativamente ese caso positivo del permiso visual.

Se añadieron listeners diagnósticos de navigate, popstate y beforeunload que solo escribían tipo y flags en consola. CDP observó apertura y cierre de diálogos. No se reemplazó confirm, no se inyectaron eventos, no se cambió negocio ni se interceptaron peticiones. La pestaña se cerró al terminar, retirando los listeners. Las pestañas ajenas, incluidas las de producción, no se abrieron ni modificaron.

## Primera salida cancelada

El campo Copy recibió mediante entrada nativa el texto sintético QA189 borrador no guardado. Atrás abrió el confirm Hay cambios sin guardar. Se rechazó el descarte mediante el diálogo real. La URL permaneció en `/clientes?periodo=2026-10` y el campo conservó exactamente el borrador.

La traza posterior a la ejecución del guard fue:

```json
{"type":"navigate","cancelable":true,"canIntercept":true,"navigationType":"traverse","sameDocument":true,"defaultPrevented":true}
```

CDP registró javascriptDialogOpening de tipo confirm y javascriptDialogClosed con result false. Captura `/private/tmp/render2-goal189-back-cancel.png`.

## Segunda salida no cancelable

Con el mismo editor abierto se intentó volver otra vez. No apareció confirm. La navegación terminó en `/inicio?editorial_view=today&editorial_page=0`, el editor se desmontó y el borrador no guardado se perdió. No hubo aceptación explícita de descarte en esta salida.

```json
{"type":"navigate","cancelable":false,"canIntercept":true,"navigationType":"traverse","sameDocument":true,"defaultPrevented":false}
{"type":"popstate","cancelable":false,"defaultPrevented":false}
```

Después se observó el replace normal de la vista editorial de Inicio, cancelable true; no fue una restauración de la ruta anterior. Captura `/private/tmp/render2-goal189-unprotected-back.png`.

El estándar permite traversals no cancelables, incluyendo intentos de salida después de una navegación cancelada. La secuencia observada es compatible con esa regla, sin atribuir un umbral temporal concreto. canIntercept true no habilita cancelación anticipada: precommitHandler exige un evento cancelable. Referencias primarias: [HTML Standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html) y [NavigateEvent intercept en MDN](https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent/intercept). No corresponde intentar precommit como bypass ni compensar con bucles de history.

## Contrato para corregir la conservación

La siguiente implementación debe conservar el formulario temporal en memoria del documento, por encima del desmontaje de rutas, sin convertirlo en una tarea guardada ni en otra fuente de datos operativa. Debe cumplir:

- Vincular el borrador a la observación exacta de sesión, pieza, tarea, cliente y mes. Eliminarlo al cerrar o cambiar la identidad, incluida revocación y ABA. No usar localStorage, sessionStorage, IndexedDB, archivos ni una cola offline de negocio.
- Conservar título, copy, baseline y revisión originalmente observados. Actualizar esa memoria desde la edición humana; nunca guardar automáticamente en la API al navegar ni reemplazar un borrador distinto sin consentimiento.
- Permitir que Atrás continúe cuando el navegador lo exige, manteniendo pantalla y URL de destino coherentes. Mostrar una recuperación explícita que permita volver al formulario o descartar, sin forzar rutas ni atrapar el historial.
- Validar nuevamente pieza, tarea y permiso del servidor al retomar. Conservar el CAS original: un contenido más reciente no debe rebasarse ni sobrescribirse silenciosamente. Una operación sin ACK verificable sigue siendo incierta, no guardada por inferencia.
- Borrar el borrador solo tras ACK válido o descarte explícito. Mantener advertencia de recarga/cierre mientras haya borradores, con los límites del navegador documentados. La memoria del documento no promete supervivencia tras recarga, cierre ni otro dispositivo.
- Probar dos salidas consecutivas reales, recuperación, descarte, conflicto, pérdida de permiso, cambio de cuenta, callback obsoleto y móvil. Ampliar a otros formularios solo después de verificar este contrato, sin presentar el primer consumidor como cobertura global.

Volta revisó los patrones existentes: PieceDetail solo conserva estado mientras está montado; el registro global almacena guards, no contenido. No se modificó el kernel ni se añadió todavía almacenamiento de borradores. La revisión y esta traza cambian el siguiente trabajo de cancelación a conservación temporal recuperable.

## Integridad y estado

No se guardó contenido ni se crearon tareas desde el navegador. El fixture comprobó snapshots idénticos de nueve tablas, terminó0 y verificó ENOENT de `/private/tmp/render2-local-jjznyq`. Se cerró únicamente la pestaña6 creada para esta prueba. No hubo despliegue ni acceso de escritura a producción.

No se modificó producto ni se repitieron las suites o el build. Siguen vigentes los resultados anteriores por su alcance. La prueba de beforeunload y la cancelación aceptada no se completaron después de identificar la primera frontera rota; no se presentan como aprobadas. Render2 sigue sin aceptación global.
