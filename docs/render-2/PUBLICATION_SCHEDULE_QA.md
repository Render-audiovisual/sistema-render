# Fechas estables en los borradores de publicaciones

El preparador de Publicaciones muestra y transforma fecha y hora en Córdoba, independientemente del huso del navegador. Recuperar y guardar un borrador sin cambiar sus campos conserva el instante observado, incluidos segundos y fracciones. Un borrador sin programación mantiene ambos campos vacíos y envía `scheduledAt:null`. Implementado y probado localmente; no desplegado.

## Fallos corregidos

`savedDraft` combinaba la fecha UTC de `toISOString()` con la hora local de `toTimeString()`. Por ejemplo, `2026-10-24T01:30:45.123Z` corresponde al 23 de octubre a las 22:30 en Córdoba. La implementación anterior podía recuperar la fecha 24 y la hora 22:30 y desplazar el instante al volver a guardar. En un navegador con otro huso también podía cambiar la hora.

El guardado además calculaba `toISOString()` antes de comprobar si el modo era borrador y ambos campos estaban vacíos. Esto impedía utilizar el contrato ya admitido por backend para borradores sin programación. Al recuperar una fecha nula, se inventaban fecha actual y 09:00 en lugar de conservar la ausencia.

## Contrato actual y archivos

`frontend/src/components/publicationSchedule.js` centraliza cuatro funciones:

- `dispatchScheduleFields`: convierte un instante con zona explícita en fecha y minuto de Córdoba. Ausencia real produce campos vacíos; valores malformados no se convierten en la fecha actual.
- `dispatchScheduleInstant`: permite ambos campos vacíos solo en borradores. Rechaza campos parciales, fechas imposibles y modos desconocidos antes de construir el envío. Conserva exactamente el timestamp observado cuando el minuto no cambió; una modificación explícita genera otro instante.
- `dispatchToday`: calcula el día inicial en Córdoba, no mediante el día UTC ni el huso predeterminado del dispositivo.
- `DISPATCH_TIME_ZONE`: fija el mismo contexto de presentación para la vista previa y las etiquetas de la bandeja.

La conversión de nuevos horarios verifica la zona mediante `Intl` y una corrección acotada; no supone que todos los registros históricos tuvieron siempre UTC−03. Un horario civil inexistente se rechaza. No se migran ni reinterpretan registros históricos. El atributo local `observedScheduledAt` no se incorpora como campo adicional al payload de API.

`PublicationComposer.jsx` utiliza estas funciones al recuperar, mostrar y serializar. El control indica «Hora · Córdoba». Validar un borrador guardado ocurre antes de limpiar archivos, recibos o campos actuales. No cambian los IDs, tokens CAS de microsegundos, permisos, claves de operación ni la política de reintento explícito.

`composer-session.test.js` y `publicationDispatchPersistence.test.js` conservan sus pruebas reales de sesión y de fallo de guardado; solo se incorporaron los nuevos helpers a sus contextos de extracción.

## Verificación automatizada

Desde `frontend`:

```sh
node --test src/components/publicationSchedule.test.js src/components/publicationScheduleIntegration.test.js src/components/composer-session.test.js src/components/publicationDispatchPersistence.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Pasaron 56 pruebas focales y 2277 de frontend, sin fallos ni omitidas, y el build con entrada `index-CfNqXRFi.js`. Las nuevas suites prueban medianoche, fin de año, bisiestos, campos vacíos/parciales, datos inválidos, preservación de precisión, cambio explícito y recuperación/reintento con la misma clave. Procesos Node separados con TZ UTC, Córdoba, Los Ángeles, Tokio y Auckland producen los mismos resultados; no se modifica el entorno del runner. También se ejecutan los callbacks reales extraídos del componente con los helpers de sesión y fecha reales.

Backend: `RENDER2_RUN_LOCAL_INTEGRATION=false npm test` pasó con 1940 aprobadas, cero fallos y 118 omitidas. No se ejecutaron las suites físicas omitidas ni se cambió código de backend o esquema.

## Comprobación nativa del componente

El script temporal `/private/tmp/render2-schedule163-browser.mjs` compila `ComposerSession` y sus helpers reales, con React StrictMode y estilos reales. La sesión/transporte de esta prueba son sintéticos y las respuestas viven únicamente en memoria. La política del servidor de prueba bloquea conexiones externas; no hay API, PostgreSQL, Drive ni envíos a Meta.

Se comprobó:

1. Recuperar el borrador nocturno muestra 23/10/2026 y 22:30. Guardarlo envía exactamente `2026-10-24T01:30:45.123Z` y la revisión observada; un ACK válido permite mostrar la confirmación.
2. Recuperar un borrador con fecha nula muestra ambos campos vacíos y su actualización envía `scheduledAt:null`.
3. Introducir solo fecha conserva ese campo y muestra el error de fecha/hora, sin construir una programación. Completar la hora con 23:40 envía explícitamente `2026-10-24T02:40:00.000Z`.
4. A 390 × 844, la etiqueta de Córdoba, los campos y la confirmación se ven sin desbordamiento: ancho documental 390 px. No hubo errores ni advertencias capturados.

El primer pase del fixture devolvió un ID sintético incorrecto y el componente rechazó correctamente ese ACK. Se corrigió únicamente el fixture y se repitió el recorrido con confirmaciones válidas. La edición de fecha/hora se verificó mediante los controles nativos: el intento inicial de fill no cambió su valor y no se contó como edición exitosa.

Captura: `/private/tmp/render2-schedule163-mobile.jpg`. Logs finales: `/private/tmp/render2-schedule163-focused-release.log`, `/private/tmp/render2-schedule163-frontend-release.log`, `/private/tmp/render2-schedule163-build-release.log`, `/private/tmp/render2-schedule163-backend.log` y `/private/tmp/render2-schedule163-browser-final.log`. Se restauró el viewport, se cerró la pestaña propia y se apagaron los servidores de prueba verificados.

Esta aceptación de componente no acredita persistencia ni recarga desde PostgreSQL. El preparador sigue sin publicar realmente en Meta: este cambio no activa proveedores ni convierte una simulación en publicación efectiva. El registro editorial real mantiene su contrato separado.

## Equipo y revisión de otros dominios

Carver escribió las pruebas del helper de fechas; Hypatia, la integración de callbacks y formatos. El integrador implementó los helpers y su conexión, comprobó el navegador y ejecutó las suites completas. Beauvoir revisó el delta sin confirmar P1/P2 en su alcance. Poincare revisó las rutas financieras y snapshots actuales por fuente, sin identificar un hallazgo nuevo en ese alcance; no es certificación global de permisos ni de hosting.

El recorrido de Proyectos revisado conserva IDs, CAS, formas observadas y separación de etapas/hitos/entregables frente a cuotas de contenido. Esta lectura no sustituye su aceptación nativa poblada completa.

### Riesgo abierto en creación de Mi lista

OP163-01, P2: `PersonalLists.jsx` libera el bloqueo de creación tras un error de transporte y permite repetir el POST. `backend/src/personal-lists.js`, ruta POST `/`, hace un INSERT nuevo por solicitud y confirma antes de responder, sin recibo idempotente. Si se pierde la respuesta después del commit, repetir puede crear otra página con los mismos bloques. Es un riesgo confirmado por fuente; la reproducción física no se ejecutó en este corte.

La corrección debe preservar la creación intencional de páginas con títulos iguales: usar un identificador estable de operación y recibo transaccional por usuario, no deduplicar títulos ni guardar páginas en el navegador. Deben probarse pérdida del ACK, reintento exacto, cambio de payload, cambio de identidad, revisión del resultado y concurrencia. Sigue abierto, sin implementar ni declararlo resuelto mediante un bloqueo solo visual.

## Límites de entrega

Continúan pendientes OP163-01, el recorrido audiovisual nativo conectado, drop nativo con persistencia, aceptación visual global y configuración real autorizada de cuentas/proveedores. PostgreSQL de pruebas sigue limitado por SysV; la autorización de limpieza de recursos huérfanos no fue recibida ni inferida. No hubo limpieza IPC, migraciones, acceso comercial o despliegue. Render 2.0 completo permanece sin certificar.
