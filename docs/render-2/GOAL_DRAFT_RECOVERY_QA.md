# Recuperación temporal de contenido de objetivos

El formulario de contenido de Objetivos conserva ahora un borrador en memoria del documento al cambiar de sección y permite retomarlo explícitamente. No guarda tareas automáticamente, no añade almacenamiento operativo en el navegador y no compensa el historial. La recuperación canónica está implementada y comprobada localmente; no representa aceptación global de todos los formularios o rutas de Render2.

## Arquitectura y límites de los datos

GoalDraftMemoryProvider vive en el shell autenticado, por encima de las páginas canónicas, con clave por observación de sesión. Captura el binding real y verifica su vigencia al leer o cambiar memoria. Cierre/cambio de identidad retira el contenido; un propietario obsoleto no recupera acceso por ABA. Solo admite un borrador pendiente y no lo reemplaza por otro recurso sin resolverlo.

goalDraftMemory.js conserva campos del formulario, baseline, IDs de pieza/tarea/cliente, mes y CAS originales. No usa localStorage, sessionStorage, IndexedDB, archivos, red ni timers. PostgreSQL sigue siendo la fuente de las tareas guardadas. El borrador no sobrevive cierre de pestaña o recarga aceptada y no se comparte entre dispositivos.

PieceDetail actualiza esa memoria desde las entradas humanas. Las salidas same-document con borrador retenido no son descartes y pueden continuar; recarga/cierre mantienen la advertencia antes de perder memoria. El aviso ofrece Retomar y Descartar, sin mostrar texto privado del formulario en otras secciones. Se oculta mientras el modal posee la edición, evitando dos controles de descarte sobre el mismo formulario.

Retomar abre cliente/mes/pieza por URL. Exige coincidencia exacta de IDs, cuenta del grupo y permiso booleano del resumen recién leído; después consulta la tarea. Restaura baseline y CAS originales, no la revisión más reciente. Un cambio ajeno muestra aviso y no rebasa el borrador. El reintento en la misma URL vuelve a consultar datos sin agregar entradas al historial.

Un ACK válido limpia únicamente el objeto exacto que estaba guardándose. Conflicto, respuesta no verificable o desmontaje durante la petición conservan estado incierto; no hay reenvío automático ni éxito inferido. El servidor sigue verificando identidad, pertenencia y CAS en cada escritura.

## Coordinación y componentes

Volta implementó el almacén puro y diez pruebas, y revisó ownership, restauración y guardado. Erdos añadió16 pruebas de callbacks reales con el almacén real, amplió el getter de navegación y creó siete pruebas de provider/aviso con hooks instrumentados. El coordinador integró App, provider, formulario, estilos y prueba adicional de reglas responsive. Se actualizaron las dependencias explícitas de los fixtures existentes, conservando sus aserciones de sesión, navegación y foco.

Archivos nuevos principales: frontend/src/components/GoalDraftMemoryProvider.jsx y CSS, frontend/src/shared/navigation/goalDraftMemory.js, sus tests y frontend/src/pages/goalPieceDraftRecovery.test.js. App.jsx y ClientesObjetivos.jsx son los consumidores. No hubo cambios de backend, migraciones o dependencias.

Las guías de diseño orientaron un aviso claro con tokens compartidos, tipografía del sistema y acciones táctiles; seguridad y verificación mantuvieron el borrador separado de autenticación y persistencia comercial. No se extendió el mecanismo a otros formularios sin probarlos.

## Pruebas automatizadas

Frontend2507 aprobadas, cero fallos u omisiones. Las35 nuevas cubren validación/propiedad/ABA del almacén, CAS original, borrador rival, callback obsoleto, conflicto/ACK incierto, descarte, navegación retenida, warning de unload, provider y replay de cleanup/setup de StrictMode, rutas de recuperación y aviso. Los tests de JSX/callbacks/hooks extraídos y SSR no se presentan como React montado.

Backend2021 aprobadas y125 integraciones optativas omitidas, sin fallos. No se renovaron suites físicas de escritura porque el backend no cambió; los snapshots nativos sí se contrastaron con PostgreSQL. Build final index-zNHisYk-.js y diff-check correctos. Logs `/private/tmp/render2-goal190-frontend-accepted.log`, `/private/tmp/render2-goal190-backend.log` y `/private/tmp/render2-goal190-build-accepted.log`.

La primera corrida frontend detectó dependencias ausentes en fixtures de extracción y el cambio de raíz Fragment a provider transparente. Se corrigieron esos fixtures y se mantuvo la comprobación de DOM/foco sin wrapper adicional de dashboard. La corrida final corresponde al árbol integrado completo.

## Recorridos nativos conectados

Una sesión sintética de Luciano abrió Objetivos, editó copy sin guardar, usó Atrás a Inicio y pulsó Retomar. Se reabrió la misma pieza con el texto exacto. Después se recorrió Inicio, Reportes y Objetivos; dos Atrás consecutivos devolvieron Reportes e Inicio. Retomar conservó nuevamente el texto. No se forzó ni se observó nuevamente cancelable false en este recorrido: la prueba acredita conservación tras desmontajes reales, mientras la traza anterior del evento no cancelable permanece en NATIVE_GOAL_DRAFT_TRAVERSAL_QA.md.

En el build funcional siguiente se repitió recuperación a390px. El aviso ocultó sus acciones mientras el modal estaba activo: display none y cero rectángulos de ambos botones. Una recarga produjo apertura beforeunload registrada por CDP y cierre result false; la herramienta la canceló antes de poder obtener un diálogo activo. El texto permaneció. Esto demuestra warning real y recarga cancelada, no supervivencia tras recarga aceptada.

Descartar desde Inicio abrió confirm real; se aceptó explícitamente y desapareció el aviso. Al volver al editor apareció el copy original del servidor, no el borrador descartado. Se escribió otro borrador, se cerró sesión y se inició como Designer: cero avisos heredados. Designer abrió la pieza compartida y vio Abrir tarea, pero cero botones Editar contenido y solo el copy guardado original. Este recorrido acredita también el caso negativo nativo pendiente del permiso visual.

La revisión visual detectó doble espacio bajo el header móvil. El último build corrigió solo ese espaciado y alineó el breakpoint con el shell980px. Nueva sesión/fixture verificó390px,375px útiles y scrollWidth375px, botones44px y padding superior de Inicio24px. Capturas `/private/tmp/render2-goal190-recovery-mobile-final.png`, `/private/tmp/render2-goal190-restored-mobile.png` y `/private/tmp/render2-goal190-restored-desktop.png`; las dos últimas pertenecen a builds funcionales anteriores al ajuste final de espaciado.

## Integridad y pendientes

Los tres fixtures nativos generaron clústeres nuevos en loopback55846/HTTP52811. Cada uno terminó0, comprobó snapshots idénticos de nueve tablas y verificó ENOENT de su raíz: `/private/tmp/render2-local-0HxEHK`, `/private/tmp/render2-local-6lEx2V` y `/private/tmp/render2-local-OxUV38`. No hubo POST/PATCH operativo desde la UI; sí autenticación de prueba. Se cerraron solo las pestañas creadas y se restauró viewport. No se tocaron datos reales ni producción.

Actualización191: restauración con conflicto, retirada de asignación y devolución del permiso verificadas nativamente en GOAL_DRAFT_CONFLICT_NATIVE_QA.md. Se conservaron texto y CAS originales; no hubo sobrescritura ni cambios comerciales adicionales a las tres mutaciones previstas del fixture.

Pendientes de aceptación: ACK perdido durante guardado en navegador real, todas las rutas heredadas/redirects y demás formularios. El provider está dentro del retorno autenticado de dashboard de App; rutas que lo desmonten, cargas completas o retirada de identidad no prometen conservar memoria. No hubo despliegue ni push y la aceptación global continúa abierta.
