# Reportes en celular y escritorio

Reportes usa una sola estructura de datos y una sola tabla por sección. Hasta600px, sus filas se presentan como tarjetas con métricas etiquetadas; desde601px conservan la tabla de escritorio. No cambian los cálculos, los endpoints, el contexto de sesión ni los permisos. Estado: implementado y verificado por alcance en desarrollo local, sin despliegue.

## Componentes y coordinación

Poincare creó ReportTable.jsx y ReportCell, sus seis pruebas e integró las tres tablas de Reportes.jsx. Hypatia revisó los contratos e incorporó cuatro pruebas de presentación reales con React SSR y AST CSS. El coordinador integró ReportProductionRegistry.css y verificó el navegador conectado. No hubo ediciones concurrentes de los mismos archivos. Las guías Apple y frontend conservaron tipografía de sistema, colores claros, foco visible y controles táctiles de44px; la guía de verificación delimitó el recorrido local.

Las etiquetas móviles reutilizan exactamente los encabezados. Se conservan cero, No disponible, cuotas compartidas/conflictos, calificación de resultados visibles y las advertencias sobre publicaciones. El detalle por ID mantiene un único botón y los enlaces operativos; las filas con hidden permanecen ocultas incluso cuando las demás usan grid. Las cabeceras se ocultan visualmente, sin display:none, y se conservan roles explícitos de tabla.

## Pruebas reproducibles

Desde frontend, `node --test src/**/*.test.js`:2384 aprobadas, cero fallos/omitidas. Incluye las seis pruebas nuevas del componente y cuatro de la integración. El build terminó correctamente; entry index-BqqDLQyS.js. Desde backend, `npm test`:1982 aprobadas,122 integraciones optativas omitidas, cero fallos. Logs locales: `/private/tmp/render2-report181-frontend.log`, `/private/tmp/render2-report181-backend.log` y `/private/tmp/render2-report181-build.log`.

El navegador inició sesión como dueño ficticio y abrió Reportes mediante el enlace de la barra lateral. API y PostgreSQL temporales sirvieron un cliente, una cuota de0 carruseles/4 reels y cuatro tareas por ID de diseñador, distribuidas en pendiente, revisión, aprobada y finalizada. La fila mostró4 tareas,1 para revisar,1 aprobada,1 finalizada,3 no finalizadas y3 vencidas. Se abrió el detalle y se comprobaron sus cuatro enlaces a IDs1–4; el cierre por teclado conservó el estado de disclosure. Cambiar de período actualizó la URL y los datos; recargar conservó la URL del período, y volver atrás restauró Este mes seleccionado y los datos del rango.

| Ancho de viewport | Ancho del documento | Presentación de fila | Etiquetas móviles |
| --- | --- | --- | --- |
|320|305|grid|visibles|
|390|375|grid|visibles|
|600|585|grid|visibles|
|601|586|table-row|ocultas|
|1280|1265|table-row|ocultas|

Las mediciones incluyeron el detalle abierto, excepto la primera observación390. Los detalles cerrados dieron display:none. En escritorio las tablas extensas siguen desplazándose dentro de su contenedor; no se promete eliminar ese desplazamiento. Capturas: `/private/tmp/render2-report181-mobile.png`, `/private/tmp/render2-report181-person-mobile.png` y `/private/tmp/render2-report181-desktop.png`.

## Aislamiento y límites

El primer fixture falló por faltar abono_mensual en un dato sintético obligatorio y confirmó cleanup ENOENT. Se corrigió el script de preparación, no el producto. El segundo validó identidad exacta en127.0.0.1:55840/render2_local_test, HTTP52806 y raíz `/private/tmp/render2-local-d9vxI4`. Tras la prueba, siete tablas de dominio conservaron su snapshot; SIGTERM al proceso propio produjo salida0 y ENOENT de la raíz. No se accedió a bases existentes ni se desplegó.

La consola registró el rechazo del origen local por Google GSI; este recorrido usó contraseña ficticia y no valida Google. No certifica lectores de pantalla, dispositivos físicos independientes ni una matriz completa de roles. Los datos editoriales del recorrido nativo eran vacíos; valores editoriales no nulos, cuotas ausentes y conflictos se cubrieron con SSR, no con ese navegador. La tabla editorial anidada comparte el componente y contrato de presentación, pero su geometría con piezas asignadas pobladas sigue pendiente. La aceptación global de Render2 continúa abierta.
