# Publicación segura en Hostinger — preparación sin cambios remotos

Fecha:27/10/2026. Estado: protocolo y configuración propuestos, no aplicados. No autorización para migrar/publicar. Correos de Agustín y Franco pendientes por decisión del usuario; conservar Líder y sus tareas sin repartir. No cambiar roles por nombre ni promover a Franco Romero.

## 1. Configuración preparada, no guardada en el panel

La última inspección del panel fue el26/10: sitio `sistema.rendercorrientes.com`, Node24.x, frameworkOther, raíz`./`, build`npm run build`, entrada`backend/src/server.js`, rama`hostinger-deploy`, commit publicado43f02707e299293c5b0c2bb6f12386bd4642746b. Autodeploy habilitado. Son datos históricos, no una nueva verificación del estado vivo.

Para la ventana futura, conservar raíz, runtime y entrada. Propuesta de build determinista para fuente Git:

```sh
npm ci --prefix backend && npm ci --prefix frontend && npm run build --prefix frontend
```

No añadir migraciones, seeds ni backfills al build/start. Revisar esta propuesta contra el servicio real antes de guardarla. No confundir el empaquetador local `build-hostinger-output.mjs` con un mecanismo de publicación o restauración. El servidor canónico sirve `frontend/dist`; no publicar solo archivos estáticos ni subir una copia de PostgreSQL.

Revisar [plantilla de variables](../../ops/hostinger-release.env.example). **No es un .env listo para importar**: contiene marcadores obligatorios. Nunca sustituir el conjunto de variables del panel por esta plantilla; podría borrar integraciones omitidas. La API de reemplazo de variables no es un merge. Conservar aparte una copia privada de la configuración actual antes de cualquier cambio autorizado.

Guardar variables mediante la API de Hostinger reinicia el proceso en ejecución; no es un borrador inocuo. Por eso toda esta propuesta permanece local. La documentación también advierte que iniciar un build puede reemplazar contenido del sitio: verificar primero backups y ubicación persistente de uploads/archivos. No asumir que carpetas del build actual sobreviven ni borrar archivos porque su sección visual se haya retirado.

| Grupo | Propuesta para revisar |
| --- | --- |
| Origen | APP_URL y RENDER_BROWSER_ORIGIN=`https://sistema.rendercorrientes.com`, sin slash final |
| Sesión browser | RENDER_BROWSER_SESSIONS=true; RENDER_BROWSER_ALLOW_LOCAL_HTTP=false; NODE_ENV=production |
| Base | RENDER_DB_ENVIRONMENT=production; conservar DATABASE_URL actual, usuario/base/destino y credenciales; nunca usar URL del clon |
| TLS PostgreSQL | RENDER_DB_CA_PEM con CA pública verificada, TLS de cadena y hostname estricto; no sslmode en query ni verificación deshabilitada |
| Seguridad | Conservar JWT_SECRET exacto; rotación y recuperación de sesiones son decisiones separadas |
| Arranque | SETUP_DEMO_DATA=false; RENDER_BACKGROUND_JOBS vacío; RENDER_ALLOW_BACKGROUND_WRITES=false |
| Procesos históricos | MIA_SUPERVISOR_ENABLED=false, MIA_SUPERVISOR_REASONING_ENABLED=false, TASK_COMPLETED_CLEANUP_ENABLED=false como propuesta de arranque controlado; coordinar pausa/reanudación, no silenciar flujos sin avisar |
| Integraciones | Conservar valores existentes Google, SMTP y Wilson; revisar Google Client ID del build y backend juntos; no activar Drive/Moodboards ni inventar credenciales |
| Proxy | Conservar PORT/HOST gestionados por Hostinger; no imponer127.0.0.1 o un puerto local de QA |

Si la URL vigente contiene query TLS incompatible, **frenar**: no quitar parámetros ni cambiar el destino silenciosamente para pasar el validador. Proponer y revisar la equivalencia de host/puerto/base/usuario/credencial y la nueva política TLS por separado. No emitir URLs ni secretos en logs o argumentos. El validador no certifica acceso remoto, proxy, OAuth, SMTP o WhatsApp reales.

Las cookies canónicas son __Host-, Secure, HttpOnly, Path=/, sin Domain y SameSite definido por el código. Hay que probar HTTPS real y el origen del navegador en la ventana; el éxito HTTP local no certifica el proxy público.

## 2. Lo que puede prepararse offline

`backend/scripts/prepare-hostinger-release.js` tiene únicamente help, prepare, check y config. No importa db.js ni abre conexiones; no existe apply/deploy. Requiere JSON privados0600, salida nueva0600 y rechaza sobreescritura. Los comandos no aceptan secretos en argumentos.

```sh
node backend/scripts/prepare-hostinger-release.js help
node backend/scripts/prepare-hostinger-release.js config --input /RUTA/PRIVADA/config.json --output /RUTA/PRIVADA/revision-nueva.json
node backend/scripts/prepare-hostinger-release.js prepare --input /RUTA/PRIVADA/evidencia.json --output /RUTA/PRIVADA/plan-nuevo.json
node backend/scripts/prepare-hostinger-release.js check --input /RUTA/PRIVADA/evidencia-actual.json --plan /RUTA/PRIVADA/plan-nuevo.json --output /RUTA/PRIVADA/comparacion-nueva.json
```

Las rutas son ejemplos, no archivos existentes. `config` recibe `{env,nodeVersion,currentDatabaseUrl,currentJwtSecret,frontendGoogleClientId?}` exclusivamente desde el archivo privado. La salida contiene nombres/categorías/estados, nunca valores. Código0 significa revisión sintáctica completa favorable;2 significa configuración bloqueada;1 error de archivo/contrato. Ninguno concede autorización de publicación.

El input de prepare está definido en `release-preparation-plan.js`: manifest+commit exactos, SQL ordenado y hashes, identidad observada y huella completa de base, hash de asignaciones, revisión de configuración, respaldo y evidencias de ventana/autoridad. Los hashes son vínculos de integridad, **no prueba de que un backup exista o de que alguien autorizó publicar**. Incluso con todos los estados reportados, el plan es NOT_EXECUTABLE, executable=false, authorized=false. No convertir esto en un `&& deploy`.

## 3. Inspección para proteger los datos nuevos

`release-preservation-snapshot.js` exige un cliente retenido dentro de `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Captura huellas SHA256 de todas las filas públicas, formas de columnas, ACL/RLS, constraints, índices y triggers. No exporta títulos, descripciones, contraseñas, importes ni contenido de tareas. Rechaza RLS activo que pudiera ocultar filas al observador; no omite tablas que no puede leer. Aplica solo formato/timeouts locales a la transacción y no crea ni modifica registros.

El caller debe cerrar la transacción/cliente inmediatamente. No usar el pool directamente entre consultas. Límites locales por consulta: statement15s y lock3s. Las huellas no son backup ni certificación de objetos fuera de public, roles globales, servicios, Storage, secuencias o todos los permisos efectivos.

`compareReleaseSnapshot` es **estricto para comprobar que el estado previo sigue vigente**. Una tarea nueva, edición, cambio de permisos o columna invalida el plan; no se permite ignorarla porque el conteo o plan SQL coincida. El comparador no es el verificador postmigración: después del DDL se esperan cambios aprobados de esquema y se usa la preservación por columnas originales ya ensayada, con un contrato separado de cambios permitidos. Nunca ampliar excepciones a ciegas para obtener PASS.

## 4. Secuencia de la futura ventana — necesita autorización nueva

1. Confirmar sitio, rama, commit y artifact/manifest exactos. No hacer push mientras autodeploy pueda activar un release fuera de ventana. Una modificación local no autoriza cambiar esa opción en el panel.
2. Identificar y pausar **todos** los escritores: runtime anterior, tráfico de escritura, sesiones, agentes WhatsApp, cron/timers externos, supervisor, editorial, trash y correo/notificadores. Un lock del migrador no equivale a mantenimiento. Guardar estado previo para reanudar los flujos autorizados.
3. Con escrituras drenadas, obtener respaldo final consistente DB+archivos/configuración y verificar su restauración aislada. Los respaldos del26/10 no incluyen datos posteriores. No borrar ni sustituir la base vigente por ninguna copia.
4. Capturar la observación actual de solo lectura; revisar historial reconocido y **solo** los SQL pendientes por hash, identidad, esquema y permisos. Regenerar el plan de asignacionesv2 para todos los IDs actuales, con excepciones explícitas revisadas; tareas nuevas no se descartan. No repartir Líder ni cambiar usuarios/roles.
5. Aprobar artefacto+SQL+asignaciones+huella+respaldo+ventana como un alcance exacto. Cambiar cualquiera exige nueva revisión. Revalidar al inicio efectivo con escritores detenidos; un plan obtenido mientras el sistema sigue escribiendo se vuelve obsoleto.
6. Usar conexión de migración directa o pooler **de sesión** verificado; nunca asumir que un pooler transaccional mantiene locks/estado entre archivos. No reciclar la URL de QA. TLS estricto y cliente retenido. No aceptar un simple pg_backend_pid repetido como prueba suficiente del modo de pooling.
7. El ejecutor productivo debe ser separado y revisado contra ese alcance. Los CLI actuales siguen rechazando apply productivo y estos nuevos archivos son solo preparación. No usar --force, cambiar production por sandbox, forjar `_migrations`, repetir044/051/052 ni ejecutar SQL manual para sortear el bloqueo. **La activación y revisión del ejecutor productivo todavía son un gate, no algo probado por este preparador.**
8. Aplicación futura por archivo y con timeouts; verificar preservación de columnas/filas originales, asignaciones porID y permisos al terminar. No es una transacción única de41 archivos. Registrar resultado confirmado de cada COMMIT. Si se pierde conexión durante COMMIT, estado incierto: detener, inspeccionar con conexión nueva y no reintentar automáticamente.
9. Solo tras verificar la base, preparar variables aprobadas y desplegar/arrancar el candidato exacto con jobs inicialmente apagados. Probar HTTPS, sesiones/CSRF, Inicio porID, tareas, Reportes sin dinero para empleados, edición porvideo, revisión, auditoría y persistencia. Pruebas de proveedor real requieren autorización separada.
10. Abrir tráfico y reanudar únicamente los escritores revisados, incluidos los dos flujos WhatsApp preservados. Observar errores y mantener evidencia privada de versión/cambios, sin secretos ni contenido comercial.

## 5. Frenos y recuperación

Ante huella distinta, tarea no cubierta, respaldo no verificado, credenciales no comparadas, permisos inesperados, diferencias de migración o falta de mantenimiento: **no aplicar ni publicar**. Corregir la causa y emitir un plan nuevo; conservar los datos nuevos.

Antes de escribir DB, retirar el candidato no activo es seguro. Después de algún COMMIT de esquema, el runtime antiguo puede ser incompatible: retirar un trigger histórico ya cambia su contrato. No usar una restauración antigua como rollback automático ni borrar datos cargados después. Mantener escrituras cerradas y elegir un arreglo forward verificado o una recuperación compatible con registro explícito de todas las escrituras posteriores. Una restauración de emergencia requiere decisión propia y respaldo de lo nuevo, no está autorizada por este documento.

## 6. Referencias verificadas y límites

Documentación oficial consultada el27/10: [redeploy Node.js en Hostinger](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/) describe versión, build, start y variables como parte del redeploy; [SDK oficial Hostinger](https://github.com/hostinger/api-python-sdk/blob/main/docs/HostingNodeJSApi.md) documenta la operación de reemplazo de variables. No se llamó esa API ni se cambió el panel. El contrato real del repositorio prevalece sobre ejemplos genéricos de hosting.

Las guías Supabase orientan TLS, RLS, historial y verificación; no hay cambios de esquema nuevos en esta etapa. Las herramientas añadidas no sustituyen un ejecutor de producción aprobado ni convierten simulaciones/booleanos en autorización. Los correos personales pendientes no autorizan deshabilitar el SMTP existente.

## 7. Verificación local de esta preparación

Main integró y probó; Hilbert preparó/revisó la configuración, Meitner el plan puro y Fermat la prueba física independiente de preservación. Sin acciones en Hostinger, Supabase productivo, DNS, autodeploy ni variables remotas.

- 47 pruebas focales PASS: contrato del plan, configuración, huella y CLI offline. Inputs JSON privados y salida0600; rechazo de salida existente, plan manipulado, datos nuevos, errores con fragmentos secretos y comandos apply/deploy. La revisión config con placeholders termina2 y releaseApproved=false: es un bloqueo esperado, no un diagnóstico de variables reales del hosting.
- Backend general:3.000 PASS/189 opt-in SKIP/0 FAIL de3.189. `/private/tmp/render-hostinger-procedure-backend.log`.
- Cohorte50 archivos:426 PASS/0 FAIL/0 SKIP. `/private/tmp/render-hostinger-procedure-core.log`.
- Fixture físico propio55995:7 PASS, incluido registro creado después del respaldo aunque el plan SQL no cambie; ediciones, columnas, constraints y ACL también invalidan la observación previa. Captura/comparación no alteran filas; cleanupENOENT. `/private/tmp/render-release-preparation-physical.log`.
- La misma captura se ensayó en la copia privada restaurada y ya actualizada:111 tablas públicas, huella idéntica después de reiniciar y abrir otra transacción readonly. Sin conexión a producción. La copia quedó detenida. No es una nueva captura de la base viva ni un respaldo final.
- Sin cambios visuales: se conserva la aceptación frontend anterior3.335 PASS/1 SKIP; no nueva certificación móvil.

Candidato nuevo con herramientas incluidas: `/private/tmp/render-hostinger-preparation-rFXpZo/app`,337 archivos, manifestSHA256229963d0a5f71c997cc009c15fdb32c0b69bbd22e4fcfd3c0f723fc7f28bb24c. Los candidatos anteriores permanecen intactos. Su estado final de smoke/inventario se registra en CURRENT_ACCEPTANCE, no inferir aprobación por la sola existencia del directorio.

Smoke del candidato desde su servidor/dependencias:12 controlesPASS, incluyendo ambas funciones WhatsApp, auditoría, corrección, login, datos y bytes invariantes; fixture eliminadoENOENT. El comando help del preparador empaquetado también pasó sin conexión. Audit runtime0 vulnerabilidades conocidas al27/10. Logs: `/private/tmp/render-hostinger-preparation-artifact-smoke.log` y `render-hostinger-preparation-runtime-audit.json`. No prueba de proveedores reales o de las variables públicas del sitio.

Mantener los JSON de configuración/planes en un directorio privado propio, sin symlinks en ancestros ni otros escritores. Un error de escritura puede dejar salida JSON parcial: descartarla y reintentar con nombre nuevo; nunca aceptar un archivo solo porque existe. El reporte config no expone valores ni acredita la configuración remota; un hash de ese reporte tampoco vincula automáticamente todos los valores privados. Revisar la configuración vigente y los proveedores separadamente antes de una autorización real.
