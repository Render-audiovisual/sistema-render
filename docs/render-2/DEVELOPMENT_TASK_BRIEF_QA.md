# Brief de tareas de Desarrollo

Las tareas explícitamente no editoriales ofrecen requisitos, criterios de aceptación y entregables en lugar de guion, escena, placa o CTA. El editor conserva el mismo documento compartido en PostgreSQL y el guardado existente. No se introdujeron tablas, migraciones, permisos ni estados nuevos. Implementado y verificado por alcance en desarrollo local; sin despliegue.

## Presentación y contenido

`task-content-presentation.js` reutiliza el clasificador por tipo/subtipo de `task-editorial-context.js`. Desarrollo, Administración y subtipos web/chatbot/mantenimiento/automatización usan tres plantillas. Los vínculos editoriales válidos prevalecen ante contradicciones históricas; tipos desconocidos conservan compatibilidad. Los casos editoriales comunes mantienen las seis plantillas anteriores y los videos vinculados conservan cuatro, con el copy editorial separado. No se infieren identidades ni permisos desde nombres o títulos.

`TaskContentWorkspace` conserva `getUnifiedTaskContent`, los campos históricos, la escritura de borrador en aclaraciones, cancelación y guardado. No transforma contenido por abrir una tarea. El guardado canónico existente unifica guiones/copy históricos en aclaraciones, sin perder sus textos; el copy editorial vinculado mantiene su protocolo independiente.

El recorrido nativo detectó que insertar al inicio pegaba el último campo del bloque al texto previo. `task-content-insertion.js` delimita ambos bordes sin recortar ni normalizar el contenido fuera de la selección, respeta CR/LF y devuelve la posición del cursor. También se corrigió la regla móvil existente de TaskDetailNotion.css: botones de plantillas en varias filas, sin recortar el último ni agregar otra capa de estilos. La prueba de fingerprint permite únicamente esas dos reglas revisadas y conserva el baseline del resto del layout.

## Coordinación y pruebas

Poincare implementó los dos helpers y17 pruebas. Hypatia revisó los riesgos y añadió11 pruebas del JSX y callback reales, más contrato CSS. El coordinador integró WorkspaceReadOnly, corrigió CSS, adaptó dos contratos backend a comportamiento ejecutable y revisó el fingerprint. Se conservaron las reglas de negocio y los archivos heredados no relacionados. Las guías Apple/frontend orientaron legibilidad y controles móviles; la guía de verificación exigió comprobar UI, guardado y datos, no solo compilación.

La regresión final pasó2412 pruebas frontend sin omitidas y1982 backend con122 integraciones optativas omitidas; cero fallos. Build `index-BL1Y4AK0.js` y diff-check correctos. Logs: `/private/tmp/render2-brief182-frontend-accepted.log`, `/private/tmp/render2-brief182-backend-accepted.log` y `/private/tmp/render2-brief182-build-final.log`. Una ejecución intermedia detectó el fingerprint móvil y otra un contrato regex ligado a las constantes trasladadas; se actualizaron con aserciones exactas de los cambios autorizados, sin reemplazar todo el baseline.

## Recorrido conectado

Dos clústeres nuevos usaron PostgreSQL55841, HTTP52807, identidad render2_fixture/render2_local_test y raíces generadas. Una cuenta de dueño ficticia abrió por enlace directo una tarea de Desarrollo. Los registros sintéticos tenían indicaciones y guion/copy históricos. Estos últimos se prepararon mediante SQL acotado al fixture: el alta API deliberadamente no admite esos metadatos históricos. En el primer recorrido se corrigió esa preparación tras observar que el API no los había incorporado; no se amplió el contrato comercial de alta.

En la segunda ejecución se insertaron criterios al inicio, se guardó un marcador nuevo y se recargó. El navegador recuperó los tres textos previos, los criterios y el marcador. Al cerrar, la consulta SQL confirmó los cinco fragmentos, estado Pendiente y tipo Desarrollo, limpieza canónica de los campos históricos y la tarea editorial de control sin editar. La primera ejecución también abrió esa tarea editorial y observó sus seis plantillas originales. No hubo cambio de aprobación o publicación.

A390px, los tres botones midieron44px y el contenedor341px tuvo scrollWidth341: el último botón pasó a una segunda fila. A320px continuaron completos y la página midió320px; a1280px la página midió1280px y se conservó el layout de escritorio. Capturas finales: `/private/tmp/render2-brief182-mobile-final.png` y `/private/tmp/render2-brief182-desktop-final.png`. No certifica dispositivos físicos, lectores de pantalla ni todas las combinaciones editoriales en navegador; estas últimas tienen cobertura unitaria y JSX.

Ambos procesos terminaron con código0 y limpieza ENOENT de `/private/tmp/render2-local-k7Jh9o` y `/private/tmp/render2-local-aMEXoD`. Se cerraron pestañas temporales y se restauró el viewport. No se conectaron bases existentes ni se modificó producción. La aceptación transversal del prompt maestro sigue abierta.
