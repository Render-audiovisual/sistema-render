# Permisos financieros con sesiones cookie

## Resultado

La matriz local verificó las respuestas del servidor para Diseño, Edición, Producción, Community y Programación mediante cookies emitidas por el backend. Los cinco roles consultaron datos operativos sin los campos ni importes privados comprobados y recibieron403 en las rutas financieras y administrativas incluidas. Ambos administradores QA recibieron los importes reales del fixture. No se encontró un bypass en este alcance ni se modificó producto.

Se renovaron53 comprobaciones físicas con PostgreSQL:16 de la matriz nueva y37 de cinco suites existentes. La aceptación global y el despliegue siguen pendientes.

## Transporte y contratos

backend/test/render2-cookie-role-financial-boundary.integration.test.js exige RENDER2_RUN_LOCAL_INTEGRATION=true y crea un clúster nuevo en55853 con browserSessions habilitado. Verifica identidad, directorio y eliminación al terminar. No lee una base configurada.

Cada cuenta obtiene el desafío de login, envía su contraseña sintética con cookie y CSRF del desafío y recibe una cookie de sesión; /sesion confirma identidad y contexto. Las llamadas de la matriz usan esa cookie y los headers de contexto/CSRF correspondientes, sin bearer. Los positivos comprueban la cabecera de contexto devuelta. Los rechazos no se aceptan como prueba de rol si corresponden a browser_csrf_invalid, browser_origin_invalid o browser_session_changed.

El cliente HTTP Node transporta las cookies manualmente. Esta prueba ejecuta autenticación y autorización reales del servidor, pero no certifica el motor de navegador, SameSite, TLS, proxy ni Google OAuth.

## Cobertura de datos y permisos

Los canarios sintéticos distinguen abono, contrato, gasto, pago, entrega histórica de edición, sueldo base y tarifas fácil/intermedia. Ambos administradores comprueban catálogos, contactos administrativos, Reportes, Sueldos, compensaciones calculadas, acuerdo mensual elegible y ledger. Así se evita aprobar una proyección financiera vacía.

Cada rol operativo consulta Reportes, Clientes, Operación de cliente, Usuarios e Inicio:25 lecturas útiles. Se comprueban identidad personal, cuotas y directorio compartido sin campos económicos, contactos administrativos, hashes, épocas o secretos de sesión. Reportes administrativo conserva el importe histórico autorizado; no se exige que ese DTO admin sea público.

La matriz negativa cubre17 combinaciones ruta/método para cada rol y el anónimo:102 rechazos. Incluye Sueldos, Contratos, contexto y ledger de pagos, inicio de acuerdo mensual GET/POST, configuración y abono de cliente, creación de clientes/usuarios y cambios de rol/acceso. Empleados reciben403 y anónimo401. El mismo payload de primer acuerdo mensual, con revisión válida y cliente elegible, se acepta después para un administrador: la negativa no depende de un cuerpo inválido.

Una excepción explícita agrega bearer admin a una cookie de empleado: el servidor devuelve400 browser_credentials_ambiguous, sin elevar identidad. La matriz general no usa ese bearer. Se revocan después las épocas de un empleado y un administrador: sus cookies anteriores reciben401 en Sesión, Inicio y Contratos.

## Integridad y coordinación

Los hashes comparan filas de las tablas públicas de dominio, usuarios, recibos e historiales antes/después de cada grupo negativo o de lectura. Excluyen tablas de autenticación; no prueban ausencia de efectos de login o throttle. Las comparaciones posteriores a las revocaciones toman baseline después de esas escrituras intencionales. El acuerdo mensual positivo también es una escritura autorizada deliberada, no parte de los grupos que deben permanecer inmutables. Las aserciones no imprimen cookies, tokens ni cuerpos de sesión.

Erdos escribió el archivo nuevo; Volta revisó rutas, canarios y los posibles falsos positivos de transporte. El coordinador ejecutó las suites, corrigió un alias SQL del fixture y añadió el control positivo de acuerdo y la exclusión explícita de rechazo por origen. Ningún agente modificó server.js ni los módulos del producto. La guía de seguridad orientó los controles en respuestas del servidor, no el ocultamiento en React.

## Ejecuciones reproducibles

Matriz aceptada:16 aprobadas, cero fallos u omisiones. Comando desde raíz: RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-cookie-role-financial-boundary.integration.test.js. Log /private/tmp/render2-goal196-cookie-matrix-accepted.log; fixture /private/tmp/render2-local-wKzI5t eliminado con ENOENT.

La primera corrida falló en setup por un alias SQL day sin AS y limpió /private/tmp/render2-local-bbeV1X. Tras corregir el fixture pasó una versión de15 pruebas y limpió /private/tmp/render2-local-3XnBjx. Solo la última versión de16 es el resultado vigente; no se suman intentos.

Cohorte renovada secuencialmente: render2-report-snapshot.integration.test.js, render2-finance-snapshot.integration.test.js, render2-client-catalog-authority.integration.test.js, render2-user-catalog-authority.integration.test.js y render2-browser-cutover.integration.test.js.37 aprobadas, cero fallos u omisiones. Log /private/tmp/render2-goal196-security-cohort.log; limpieza ENOENT de /private/tmp/render2-local-IYA6h6, /private/tmp/render2-local-0pTJlX, /private/tmp/render2-local-L3KB5i, /private/tmp/render2-local-bbp3Js y /private/tmp/render2-local-QZ9ars.

Pruebas de transporte separadas:12 aprobadas y una integración optativa omitida, log /private/tmp/render2-goal196-transport.log. Regresión backend final:2038 aprobadas,126 integraciones optativas omitidas, cero fallos; log /private/tmp/render2-goal196-backend.log. No se renovaron frontend ni build porque no cambiaron.

## Límites antes de producción

### Revalidación local del 24 de octubre de 2026

Tras la autorización explícita se retiraron25 segmentos SysV del usuario: cada ID se releyó inmediatamente antes de retirarlo, con cero conexiones y sin proceso creador ni último proceso vivos. Los dos segmentos con seis conexiones cada uno se preservaron. No se eliminaron archivos de bases ni se detuvieron servicios activos.

Se repitió la matriz cookie con el mismo comando indicado arriba:16 aprobadas, cero fallos u omisiones. La identidad del clúster descartable fue comprobada por el harness y su limpieza confirmó ENOENT para `/private/tmp/render2-local-I4Lk12`.

Después se ejecutaron las cinco suites de la cohorte anterior con `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1`, pasando los cinco archivos explícitamente:37 aprobadas, cero fallos u omisiones. Ambas ejecuciones terminaron con código0. Son53 comprobaciones físicas renovadas, no53 pruebas nuevas ni aceptación global. La evidencia se obtuvo en la salida de terminal de esta ejecución; no se atribuye a los logs históricos del corte196.

Volta contrastó en solo lectura el siguiente gate: preferencias nativas A/B/A, Atrás real, prioridad de URL explícita y ausencia de escrituras operativas. Ese recorrido sigue pendiente; esta renovación HTTP/PostgreSQL no lo sustituye. No cambiaron código de producto, frontend, configuración comercial ni producción.

Falta ampliar la aceptación transversal y verificar cuentas reales, navegador/TLS/proxy, proveedores y respaldo/restauración en un destino autorizado. Los canarios comprueban datos privados estructurados, no cualquier contenido libre que un usuario pueda escribir. Los resultados no autorizan despliegue ni demuestran que producción esté actualizada.
