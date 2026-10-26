# Controles renovados y corrección audiovisual — 26 de octubre de 2026

## Alcance

Desarrollo y pruebas aisladas. No publicación, push, migración productiva ni reemplazo de la base actual. El usuario requiere adaptar la auditoría de edición antes de publicar; esa adaptación sigue pendiente y no está cubierta por los resultados de corrección indicados abajo.

## Respaldo y estado vivo

Se obtuvo un nuevo respaldo lógico de Supabase con snapshot de solo lectura, TLS verificado y restauración en PostgreSQL local aislado. Captura: 2026-10-26T23:19:47.973Z. Se verificaron 64 tablas públicas, 7.732 filas y 338 tareas, 244 restricciones originales y 46 estados de secuencia. Las restricciones NOT NULL adicionales del motor local PG18 se comprobaron por separado respecto del origen PG17. El servidor de restauración quedó detenido.

Las tareas conservan el mismo conteo, pero su contenido cambió desde el respaldo anterior; los usuarios no cambiaron. Por eso los planes anteriores no habilitan aplicar cambios sobre el estado vigente. Los archivos privados, dumps, credenciales y contenido comercial no se incorporan al repositorio. Un respaldo lógico no certifica restauración de servicios administrados, archivos externos o secretos del hosting.

Hostinger confirma un nuevo respaldo manual completado, con fecha mostrada 2026-10-26 19:50. No se ejecutó restauración. La base externa se respaldó por separado. La rama publicada observada es `hostinger-deploy`, commit `43f02707e299293c5b0c2bb6f12386bd4642746b`, con autodespliegue habilitado: no subir cambios sin coordinar el corte.

Preflight productivo de solo lectura: 64 tablas con RLS habilitado y sin políticas. Los grants existentes por sí solos no demuestran exposición de filas con ese RLS. Sigue pendiente revisar la rutina SECURITY DEFINER accesible y la configuración de objetos nuevos. Entorno del hosting: Node24, inicio `backend/src/server.js`, build `npm run build`, APP_URL correcto y SETUP_DEMO_DATA=false. Faltan variables nuevas de entorno/TLS/cookies; no se modificaron valores.

## Corrección audiovisual compartida

`production-registration-correction.js` centraliza la corrección antes implementada dentro de la ruta web. Web conserva su autorización por ID y actor retenido; WhatsApp agrega actor humano administrador vigente, firma v2 y conversación privada. Ningún nombre recibido concede permisos.

Dos pasos explícitos: `POST /tareas/:id/produccion/registros/:recordId/previsualizar` y `PATCH /tareas/:id/produccion/registros/:recordId`. Cantidad, revisión, registro y tarea quedan ligados al token. El vencimiento se reclama después de esperar bloqueos; corrección, auditoría y recibo son atómicos. Replay no reescribe el registro. Se recalculan adelantos posteriores y se revoca la aprobación previa. Los registros ambiguos y las visitas canónicas incompatibles requieren conciliación, no conversiones automáticas.

El CLI requiere revisión observada, identificador y cantidad; la confirmación exige el token exacto. No consulta otra revisión ni reintenta una corrección automáticamente. Deben actualizarse coordinadamente las instrucciones del agente externo antes de usarlo en producción.

Pruebas focales: CLI y módulo, 74 PASS, 0 FAIL. Prueba HTTP con firmas reales sintéticas y PostgreSQL descartable: 5 PASS, 0 FAIL. Verifica concurrencia/replay, política web compartida, sustitución de intención, rol retirado, grupos, IDs ambiguos y vencimiento bajo un bloqueo físico. La publicación de control conserva contenido, xmin y ctid. Fixture propio eliminado con ENOENT. Un primer fallo correspondía a una fecha obligatoria omitida en el dato sintético; se corrigió el fixture antes de la corrida aprobada.

## Pendientes que impiden declarar publicación lista

Regresión backend de esta integración: 2.923 PASS, 184 pruebas opt-in omitidas, 0 FAIL de 3.107. La primera ejecución restringida no pudo abrir un servidor HTTP local; la repetición autorizada terminó correctamente. No se cuentan las pruebas omitidas como verificadas. Cobertura de asignaciones: 22 unitarias y 8 físicas PASS; el coordinador principal ahora incluye 45 archivos y su contrato de aislamiento pasó 3 pruebas. Corrida completa de ese coordinador: 387 PASS, 0 FAIL, 0 SKIP en 114,43 segundos. No cubre la auditoría todavía en desarrollo. Logs locales: `/private/tmp/render-refresh-backend-authorized.log` y `/private/tmp/render-refresh-core.log`.

- Adaptación y pruebas de la auditoría de edición, sin reinterpretar atribución histórica.
- Integración y regresión final de cobertura exhaustiva de asignaciones; planes anteriores deben regenerarse.
- Accesos independientes de dueños: botones Agustín/Franco no equivalen a autenticación. No se promovió a Franco Romero ni se repartieron las 62 tareas de Líder.
- Ejecutor productivo forward-only, ventana de mantenimiento, drenado de procesos antiguos y controles de preservación de todas las columnas/ACL. Los guardas locales siguen rechazando producción.
- Configuración y proveedores reales, nuevo artefacto después de integrar cambios y su verificación. El candidato anterior no contiene esta corrección.

No confundir estos resultados locales con despliegue ni con autorización para sustituir datos actuales por una copia.
