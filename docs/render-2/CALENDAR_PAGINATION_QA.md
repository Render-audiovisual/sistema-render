# Calendario completo con agenda paginada

El calendario conectado permite consultar todos los eventos de un rango, incluso cuando un solo día supera los2.000 registros. La grilla muestra recuentos completos y hasta dos vistas previas por día; la agenda consulta páginas del día seleccionado. Los datos provienen de PostgreSQL mediante la API existente, sin almacenamiento comercial local ni una aplicación paralela.

## Contrato de API

`GET /api/calendario` conserva filtros, permisos, fuentes y DTOs operativos anteriores. El modo paginado se solicita con `limit` entero decimal canónico entre1 y500, `offset` entero seguro no negativo y `expected_snapshot` con formato `c1:` seguido de64 caracteres hex minúsculos. Offset mayor que cero requiere snapshot. `dia` es opcional y debe pertenecer al rango semiabierto desde/hasta, de1 a62 días. Cualquier argumento de paginación exige limit; no se admiten coerciones, duplicados, arrays ni campos desconocidos.

La respuesta añade `pagination:{version:1,limit,offset,total,has_more,snapshot,day,days}`. Total corresponde al día seleccionado, o a todo el rango si no se solicita dia. Days contiene fechas ordenadas con total positivo y preview de hasta dos eventos cerrados. Esa metadata corresponde siempre al rango completo, no a la página. Events contiene solo la página solicitada. Truncated significa que events no contiene todo ese total, también en la última página; has_more indica si queda otra página posterior. Página fuera de resultados devuelve cero filas con el total real, no una afirmación falsa de día vacío.

Las peticiones sin argumentos nuevos conservan la respuesta legacy y su aviso de truncación. La interfaz canónica ya solicita paginación explícita; esa compatibilidad no es otro sistema operativo ni una segunda lógica de permisos.

## Consistencia y autorización

La identidad se captura por ID, rol y epoch antes de esperar una conexión. El actor vigente, catálogo de clientes, candidatos, evidencia, recuentos y página se consultan en una transacción repeatable-read/read-only. La sesión se valida antes de leer el dominio. Un error de rollback descarta la conexión sin sustituir el error original.

El snapshot combina el contexto autorizado, filtros, día, catálogo y una huella de todo el conjunto candidato. No incluye limit u offset: cambiar el tamaño de página no cambia la observación. Los candidatos se ordenan explícitamente por date, kind y key con collation C. Se calcula SHA256 por fila, se concatenan sus hex de longitud fija en ese orden y se calcula la huella exterior. Cada página vuelve a comprobar el conjunto; si cambió devuelve409 sin eventos. No hay caché comercial ni una transacción abierta entre peticiones.

Las consultas paginadas reutilizan los SELECTs estáticos y sus predicados de acceso; se retira exclusivamente su límite terminal legacy. El SELECT materializado calcula en PostgreSQL la huella, totales, días, vistas previas y ventana paginada. Node recibe una página de hasta500 candidatos más124 vistas previas como máximo, no todas las filas del rango. Los SELECTs de evidencia se agrupan por dominio, sin una consulta por evento.

Una publicación real requiere el evento manual vigente, dominio/pieza/cliente concordantes, versión válida y timestamp real coincidente. El helper autoritativo de evidencia vuelve a comprobar las filas de página y previews dentro del mismo snapshot. Una discrepancia entre conteo y proyección falla cerrado; no devuelve una página corta como si estuviera completa. Estado o fecha históricos y metadata inventada no conceden publicación. Programación y publicación del mismo ID son eventos diferentes, identificados por key completa.

## Navegación y experiencia diaria

La interfaz utiliza200 eventos por página y conserva mes, día, ámbito, tipo, cliente y pagina en la URL. Cambiar un filtro o día reinicia pagina0. Atrás y recarga restauran el contexto. Al abrir un enlace a una página posterior, el loader obtiene primero la observación en0 y luego solicita el offset deseado con ese snapshot; no expone la página inicial como si fuera la solicitada.

Actualizar y Reintentar descartan la observación anterior. Un conflicto409 queda visible y exige reintento explícito, sin bucle automático. Generación, binding de sesión y observación del render impiden repintados obsoletos, incluso al volver a la misma URL antes de limpiar efectos. La grilla conserva recuentos y previews de otros días; la agenda indica total, cantidad mostrada y página, con controles antes de la lista larga y recuperación a Primera página.

## Equipo y componentes

El integrador modificó calendar.js, añadió pruebas de captura/contrato/cleanup, integró y ejecutó todas las verificaciones. Poincare implementó calendar-pagination.js y sus pruebas; el integrador redujo la agregación de huella a hashes por fila. Carver modificó Calendar.jsx y calendarModel.js, actualizó sus pruebas y añadió calendarPagination.test.js. Hypatia preparó la prueba física independiente y revisó el frontend final; Beauvoir revisó backend, evidencia, orden y huella. Los revisores no iniciaron servicios. No hubo modificaciones simultáneas de server.js o App.jsx.

Las skills de trabajo estructurado, verificación y PostgreSQL orientaron la separación de contratos, la comprobación de todas las capas y la medición del SELECT real. La documentación queda en el repositorio, sin crear documentos en servicios externos.

## Pruebas ejecutadas

- Contratos, lector paginado y calendario legacy:40 pruebas aprobadas con `node --test backend/test/calendar-pagination-contract.test.js backend/test/calendar.test.js backend/test/calendar-pagination.test.js`. Cubren validación, captura prelease, autoridad, orden, conteos, pruebas cerradas y descarte de conexión.
- Prueba física `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-calendar-pagination.integration.test.js`:10 aprobadas, cero fallos y omisiones. Incluye2.107 tareas del mismo día y fuentes mixtas, recorrido completo con distintos tamaños, orden/IDs únicos, días/previews completos, paridad legacy en subconjunto pequeño, día/cliente/tipo/mine/team, casos vacíos y offset extremo, privacidad, revocación y cambios entre páginas. Las confirmaciones/retiros editoriales se realizan mediante la API; los datos masivos son fixtures sintéticos.
- Los hashes de tablas públicas antes y después acreditan que las lecturas y rechazos comprobados no realizan DML. Las mutaciones intencionales de título, fecha, asignación, cliente activo y confirmación producen409 con snapshots anteriores.
- `EXPLAIN (ANALYZE, BUFFERS)` del SELECT generado real, sobre el fixture propio:23.856ms de ejecución,14.906 shared hits y cero shared reads. Se observó Limit en PostgreSQL; no se descargó todo el conjunto para paginar en JavaScript. Es una medición local de este volumen, no una garantía de producción.
- `npm test` backend:2.058 casos,1.940 aprobados, cero fallos y118 omitidos por gates. La prueba física anterior se ejecutó aparte. Frontend completo:2.177 aprobados, cero fallos y omisiones. Build satisfactorio, entrada index-HtrfB-IW.js. Syntax y git diff --check satisfactorios.
- Regresión física `render2-calendar.integration.test.js`:9 aprobadas, cero fallos y omisiones en otra base nueva. Comprueba acceso de los seis roles, IDs homónimos, privacidad, diferencias entre visita/entrega/programación/publicación, edición de fechas, retiro de confirmación y compatibilidad del límite legacy. Fixture `/private/tmp/render2-local-ca5OAD`, PostgreSQL55619, eliminado con ENOENT; log `/private/tmp/render2-calendar159-legacy-regression.log`.

Logs: `/private/tmp/render2-calendar159-final-unit.log`, `/private/tmp/render2-calendar159-physical.log`, `/private/tmp/render2-calendar159-backend.log`, `/private/tmp/render2-calendar159-frontend.log` y `/private/tmp/render2-calendar159-build.log`. Fixture físico `/private/tmp/render2-local-DFPN7C`, PostgreSQL55824, eliminado con ENOENT.

## Verificación en navegador

Sobre el build final y otra base nueva, se probaron2.107 eventos de un día y uno de otro día. Escritorio mostró200 en página1; Siguiente conservó filtros y URL en página2; recarga mantuvo esa página y Atrás volvió a1. El enlace directo pagina10 mostró página11 con107 eventos y Siguiente deshabilitado. La grilla siguió contando2.107 y conservó la vista previa del otro día.

En390×844, Anterior mostró página10 con200 eventos, ancho del documento390px y controles utilizables. Seleccionar el día de un único evento reinició pagina0 y mostró exactamente ese evento. No se observaron errores o warnings en la consola capturada. Capturas inspeccionadas: `/private/tmp/render2-calendar159-desktop.jpg`, `/private/tmp/render2-calendar159-mobile.jpg` y `/private/tmp/render2-calendar159-mobile-agenda.jpg`.

Se cerró la pestaña propia y se restableció el viewport. El fixture visual `/private/tmp/render2-local-xMaSA0`, PostgreSQL55826/HTTP52794, comprobó sus2.108 tareas sintéticas al finalizar y quedó eliminado con ENOENT. Log: `/private/tmp/render2-calendar159-native.log`.

## Estado y riesgos pendientes

UX155-01 queda corregido y probado localmente para el calendario conectado. No hubo cambios de esquema, dependencias, entorno configurado, proveedores ni producción. No se ha desplegado.

La huella, conteos y previews requieren recorrer el conjunto completo de hasta62 días en PostgreSQL en cada página. Offset permite enlaces directos y restauración aleatoria; no se presenta como una consulta O(1). Antes de producción corresponde medir capacidad, índices y memoria con volúmenes representativos en un entorno autorizado. No se mantuvieron snapshots de servidor abiertos ni se introdujeron nuevos servicios para resolverlo.

El corte no certifica todos los dispositivos, concurrencia de carga, lectores de pantalla o módulos ajenos. Siguen abiertos foco del shell, drag nativo dentro de columna, recorrido visual completo de tres videos y aceptación general del diseño y del prompt maestro.
