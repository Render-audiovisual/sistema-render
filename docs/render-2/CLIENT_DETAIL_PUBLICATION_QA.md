# Confirmaciones editoriales en el detalle del cliente

El detalle administrativo de Clientes ya no cuenta estados históricos como publicaciones confirmadas. Reutiliza la evidencia del servidor y conserva los mismos registros, cuotas y fechas. Corregido y verificado por alcance en desarrollo local, sin despliegue.

## Error y corrección

`DetalleClienteSession` contaba reels y carruseles con estado publicada, aunque no existiera confirmación manual válida. El padre le pasa piezas del mismo cliente/feed según fecha programada, sin excluir históricos. Por eso el modal podía mostrar más publicaciones que la tarjeta de cartera, cuyo cálculo ya usa `isConfirmedPublication`.

`ClienteModals.jsx` ahora usa ese mismo helper para los dos contadores. Las filas distinguen Confirmada manualmente e Histórica sin confirmación. Las etiquetas aclaran que se observa la cohorte programada del período: una confirmación puede tener otra fecha real y no acredita verificación externa. Historias conserva el resumen ya validado del padre, con una etiqueta explícita de confirmación. No se cambió el algoritmo de cuotas, el ámbito por feed, el backend ni las reglas de guardado.

## Pruebas y coordinación

Poincare implementó el cambio del modal; Hypatia confirmó el recorrido y añadió `clientDetailPublicationEvidence.test.js`. Sus12 pruebas ejecutan el JSX real y los helpers reales con React SSR. Cubren cuenta individual/feed compartido, fecha histórica, prueba malformada, evidencia retirada, confirmación válida de otra fecha real, exclusión por mes/cliente desde la proyección real del padre y conservación de datos. El control negativo reproduce el filtro anterior:2 reels/2 carruseles sin pruebas válidas frente a0/0 corregidos.

El coordinador integró las dependencias reales en los tests SSR de clientes básicos/acuerdos y verificó el navegador conectado. La guía de verificación exigió comprobar los límites UI/API/PostgreSQL. La documentación permanece local.

Regresión frontend:2424 aprobadas, cero fallos/omitidas. Backend:1982 aprobadas y123 integraciones optativas omitidas, cero fallos. Build index-BBv7z8hY.js correcto. Logs `/private/tmp/render2-client184-frontend.log`, `/private/tmp/render2-client184-backend.log` y `/private/tmp/render2-client184-build.log`.

## Recorrido conectado

El fixture generó un cliente con cuota de3 reels y2 carruseles y cuatro publicaciones sintéticas de octubre: un reel histórico, un reel confirmado, un carrusel histórico y uno confirmado. Las dos confirmaciones se registraron por el endpoint real con UUID y revisión; el histórico se preparó expresamente mediante SQL solo en la base nueva. La lectura API verificó dos clasificaciones confirmadas y dos históricas antes de abrir la UI.

Una sesión de dueño ficticia abrió `/clientes?gestion=1&cliente=1&periodo=2026-10`. El modal mostró Reels1/3 y Carruseles1/2, no2 por formato, y la tabla mantuvo los cuatro registros con sus clasificaciones correctas. A390px, documento y diálogo midieron375px, dentro del viewport. Recargar mantuvo los contadores. Ver operación del cliente abrió el mismo cliente/período y mostró Contenido4, dividido en2 confirmaciones manuales y2 históricas. Los demás bloques operativos se consultaron, pero este fixture no tenía tareas, proyectos ni visitas pobladas.

Capturas `/private/tmp/render2-client184-desktop.png` y `/private/tmp/render2-client184-mobile.png`. La comprobación nativa cubrió cuenta individual y dueño; el feed compartido y prueba inválida se comprobaron mediante SSR, no en este navegador. No certifica todos los roles ni dispositivos físicos.

PostgreSQL55844/HTTP52809 validó identidad exacta render2_fixture/render2_local_test y raíz `/private/tmp/render2-local-adHt0M`. Ocho tablas conservaron su snapshot después de las consultas nativas; no se alteró evidencia histórica al visualizarla. El proceso terminó0, cleanup comprobó ENOENT y se cerró la pestaña/restauró viewport. No se modificaron bases existentes, servicios externos ni producción. La aceptación global de Render2 sigue abierta.
