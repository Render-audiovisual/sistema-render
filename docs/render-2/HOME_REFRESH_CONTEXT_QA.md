# Inicio conserva el contexto durante las actualizaciones

Inicio mantiene la última respuesta validada mientras actualiza los datos de la misma sesión. Esto evita desmontar las tarjetas y cerrar sus bloques desplegables cada vez que la ventana recupera el foco, vuelve la conexión o se pulsa Actualizar. Los datos siguen procediendo de la API; no se incorporó almacenamiento operativo en el navegador.

## Contrato de actualización y acceso

El loader conserva un snapshot únicamente durante su propia observación de sesión. La primera carga no tiene datos anteriores. Una nueva respuesta válida reemplaza el snapshot y actualiza la hora de consulta. Durante el refresco se muestra Actualizando tu trabajo y el botón de actualización permanece deshabilitado.

Un fallo temporal de red, HTTP408/429 o HTTP5xx conserva la última consulta con una advertencia explícita. No se presenta como información recién consultada. HTTP401/403, otros errores HTTP no temporales, fallos del runtime de sesión y respuestas que no cumplen el contrato retiran el snapshot. Un fallo posterior de red no recupera datos que ya se retiraron.

Las generaciones de solicitud y el AbortController impiden que una respuesta anterior sobrescriba o retire una posterior. La proyección del render solo admite resultados de la identidad exacta vigente; un cambio de cuenta, rol, sesión o actividad no hereda el snapshot de otra observación, ni siquiera antes de limpiar los efectos anteriores.

La sesión se comprueba antes de limitar los refrescos de fondo. Si ya cambió, se aborta la solicitud pendiente, se invalida su generación y se elimina el snapshot sin enviar otra petición; un foco reciente no aplaza esa retirada.

## Producción por cliente

La página seleccionada pertenece al período y a la observación de sesión, no al objeto de datos recibido en cada actualización. Una nueva consulta de Inicio conserva ese desplazamiento y vuelve a consultar la página elegida. No reutiliza los clientes de la primera página para etiquetarlos como si fueran otra página.

Si cambia la sesión o el período, la selección vuelve a la primera página y los resultados anteriores dejan de ser visibles. Los fallos de la página ofrecen Reintentar y Primera página; no se sustituyen por contadores cero. El bloque desplegable permanece montado durante una actualización de Inicio de la misma sesión.

## Pruebas y revisión

El integrador modificó personalHome.js, QuickHome.jsx y sus pruebas; Carver modificó HomeProductionMonthly.jsx, añadió ocho pruebas del componente con hooks/transport simulados y actualizó la aserción estructural de session-wrappers.test.js. Hypatia revisó independientemente los cambios y el refuerzo de revocación antes del refresco, sin hallazgos P1/P2. El test backend personal-home-ui.test.js se actualizó para distinguir rechazo de acceso de un error temporal, conservando la comprobación de mensajes genéricos y reintento.

`node --test src/pages/personalHome.test.js`:25 aprobadas. Incluyen conservación del DTO validado, tipos de fallo, descarte permanente tras invalidación, solicitudes superpuestas, nuevas sesiones, revocación antes del dispatch incluso dentro del throttle y render que impide mostrar otra identidad. Las ocho pruebas nuevas de paginación usan el componente real transpilado y el loader real, pero no se presentan como React montado ni navegador.

Regresión final del frontend: `node --test $(rg --files src -g '*.test.js')`, 2.163 aprobadas, cero fallos y cero omisiones; incluye los tests heredados de referencias sin modificar sus archivos. Build final satisfactorio, entrada index-7auvcaSq.js. `npm test` backend:2.036 casos,1.919 aprobados, cero fallos y117 omitidos por sus gates; la prueba física intersectorial se ejecutó aparte. Logs finales: `/private/tmp/render2-home158-release-frontend.log`, `/private/tmp/render2-home158-release-build.log` y `/private/tmp/render2-journey158-release-backend.log`.

## Verificación en navegador

Se creó un fixture propio con25 clientes y25 tareas de producción asignadas por API a una cuenta sintética. Con el build final y una nueva sesión cookie, se abrió Producción por cliente, se eligió la página2 y se pulsó Actualizar en escritorio y a390×844. En ambos casos el bloque siguió abierto y mostró los clientes21–25 en página2. En móvil el viewport y el ancho del documento midieron390px.

Capturas inspeccionadas: `/private/tmp/render2-home158-release-desktop.jpg` y `/private/tmp/render2-home158-release-mobile.jpg`. Se cerró la pestaña propia y se restableció el viewport. El fixture final `/private/tmp/render2-local-rMP2Pm` se eliminó con ENOENT, al igual que el primer fixture visual `/private/tmp/render2-local-cQqUMz`. Logs: `/private/tmp/render2-home158-release-native.log` y `/private/tmp/render2-home158-native.log`.

La consola final registró un error de Google Identity porque el origen loopback no está autorizado para el client ID configurado. La prueba utilizó únicamente usuario y contraseña sintéticos del servidor local; no intentó Google OAuth ni cambió sus orígenes. Este proveedor sigue sin certificarse en este corte. Los errores de transporte y revocación se comprobaron mediante pruebas automatizadas, no mediante interceptación de red en el navegador.

## Estado de entrega

UX155-02 queda corregido y comprobado localmente dentro de este alcance. No se incorporaron migraciones, dependencias ni persistencia comercial local; no hubo despliegue. Continúan pendientes el calendario por encima de su límite, foco del shell, drag nativo y aceptación visual/intersectorial global.
