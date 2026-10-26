# Preparación de publicación sin reemplazar la base — 2026-10-26

## Resultado de esta etapa

Hay un candidato Node local preparado y probado, no una publicación aprobada ni ejecutada. No push, despliegue, cambios de entorno del hosting, migración productiva, envío a proveedores o restauración sobre producción. No se habilita un override productivo en los CLI existentes.

La preparación continúa desde `a99dc6a` y mantiene intactos cambios no versionados ajenos. La rama publicada consultada read-only sigue en `43f02707e299293c5b0c2bb6f12386bd4642746b`. No merge/force-push de las ramas divergentes.

## Control de la fuente viva

Inspección desde el SQL Editor del proyecto Render verificado, dentro de REPEATABLE READ READ ONLY, con timeout acotado. A la observación del26/10:338 tareas,3 cierres,58 migraciones aplicadas, sin tabla normalizada de asignaciones todavía. El hash lógico de tareas coincide con el respaldo aceptado. Esto no afirma que otros registros no hayan cambiado ni que la base deje de cambiar después de consultar.

La inspección incluyó RLS y grants en el dashboard; el detalle permanece allí, sin copia de roles, tablas o ACL vivos en este informe. No se certifica todavía el acceso efectivo de las políticas productivas. RLS existente tampoco garantiza la seguridad de tablas futuras.

Las conexiones MCP disponibles no tienen permiso sobre este proyecto; no se utiliza otra empresa ni se intenta sortear ese rechazo. Se usa la sesión correcta ya abierta en el dashboard. El control de seguridad bloqueó exportar el payload completo de metadatos a un archivo local; se pidió autorización explícita y no se guardó ni se exportó por otra vía. Se puede continuar manteniendo los resultados dentro del dashboard.

Se añade [ops/render-release-preflight.sql](../../ops/render-release-preflight.sql): inspección manual repetible y de solo lectura, con conteos/hashes, historial, forma de columnas, RLS/grants, cantidad de políticas, definers accesibles y defaults. No contiene ni devuelve títulos, contraseñas ni importes. Sí devuelve metadatos privados: conservar resultados en el dashboard salvo aprobación de retención. No fue ejecutado todavía sobre producción como script completo y no autoriza escrituras. Contrato unitario pasa y ejecución sobre la copia local confirma sintaxis, read_only=on e invariancia física de tareas; terminal0 en `/private/tmp/render-release-preflight-copy-check.log`. Refrescar la observación al momento de una ventana aprobada.

## Corrección: objetos nuevos no deben heredar exposición Data API

La [documentación oficial de Supabase](https://supabase.com/docs/guides/api/securing-your-api) confirma que proyectos existentes pueden conceder grants automáticamente a nuevos objetos públicos. Las40 migraciones pendientes crean47 tablas; entre ellas hay registros operativos, recibos, control de login y finanzas. Esas tablas no deben aparecer accesibles por el solo hecho de aterrizar en public.

Nuevo `backend/src/application-object-security.js`:

- Inventario exclusivamente de catálogos: OIDs de tablas/particiones, secuencias y rutinas públicas; excluye objetos de extensiones y otros esquemas.
- Compara OIDs antes/después de cada SQL. Habilita RLS de nuevas tablas y revoca privilegios de PUBLIC, anon/authenticated existentes. Secuencias y ejecución de nuevas funciones/procedimientos también se cierran.
- No modifica registros, políticas/grants de objetos anteriores, defaults globales, auth/storage, extensiones ni roles. No crea cuentas ni políticas que inventen pertenencia.
- El rol propietario de la aplicación conserva su acceso; no se usa FORCE RLS ni SECURITY DEFINER para resolver permisos.

`migrations.js` invoca esa protección con el mismo cliente y transacción, **antes del COMMIT** de cada archivo. El bootstrap de ledger fresco tiene su propia transacción protegida. Si falla la protección, se revierte ese archivo. El hash del plan incorpora el SHA256 real del helper: un plan emitido antes de cambiar la política deja de servir.

Esto no repara automáticamente instalaciones que ya aplicaron las migraciones sin esa protección, ni certifica políticas de tablas anteriores. Un estado ya migrado inseguro exige un plan separado. Producción sigue bloqueada para apply mediante este CLI local.

### Ensayo sobre otra restauración real

Nueva copia privada `/private/tmp/render2-upgrade-sre1MV`, separada de todas las copias aceptadas anteriormente. Respaldo verificado como entrada; no nueva lectura de registros productivos. Se simulan únicamente allí defaults amplios de anon/authenticated y se ejecuta el runner real con el nuevo hash aprobado localmente:

- 40 migraciones;47 tablas nuevas con RLS y sin grants de lectura/escritura de anon/authenticated.
- 64 tablas/7.566 filas originales y338 tareas preservadas por conteo/hash de columnas originales; ledger58→98 legítimamente.
- RLS/ACL de las64 tablas anteriores idénticos antes/después; no defaults productivos alterados.
- `assertCoreSchemaReady` correcto, sin datos operativos inventados. Cluster propio detenido/PID ausente, terminal0.

Evidencia privada dentro de esa copia: `approved-upgrade-plan.json`, `upgrade-preservation.private.json`, `object-security-verification.private.json`. Logs locales `/private/tmp/render-release-secure-copy-{restore,apply}.log`. Es ensayo de esquema/seguridad; las asignaciones338+12 ya aceptadas siguen en la copia anterior, no se afirman aplicadas en esta nueva restauración.

### Prueba física permanente

Nuevo `render2-release-object-security.integration.test.js`, incorporado a la cohorte principal. Fixture descartable, roles Data API simulados y defaults amplios. Aplica las migraciones reales067/093 mediante el runner; un wrapper inspecciona su estado antes de cada COMMIT. Confirma RLS/grants cerrados, rutina nueva sin EXECUTE público, SELECT/INSERT rechazados42501 para ambos roles y acceso del propietario conservado. Registros anteriores y ACL de una tabla preexistente físicamente invariantes. Sin Supabase API/proveedores reales.

## Paquete nuevo, sin sobrescritura

`scripts/build-hostinger-output.mjs` ya no borra `hostinger-dist` ni ningún destino existente. Exige ruta nueva, revisa ancestros/symlinks/contención y no copia `.env`, respaldos o claves privadas. La única excepción PEM es `backend/src/wilson-public-key.pem`, validada con crypto como clave pública y registrada por hash; el servidor la necesita para verificar firmas.

Incluye backend/src/scripts/migrations, shared y frontend compilado; package raíz de arranque Node24. Valida assets locales referenciados por index, inventario exacto de archivos/directorios y fuente estable. Instala lockfile con npm ci --omit=dev --ignore-scripts, verifica resolución local de las8 dependencias declaradas y registra bytes/symlinks internos de node_modules mediante prueba separada. Comprueba de nuevo fuente y salida; manifiesto v2 solo al final.

Es **manifest-last, no publicación atómica**: un fallo puede dejar una carpeta parcial sin manifiesto; no es un paquete aceptado y se reintenta en otra ruta, sin borrarla automáticamente. No protege contra un proceso hostil alterando concurrentemente el filesystem. La prueba de dependencias no demuestra ausencia de vulnerabilidades ni comportamiento: se agregan audit y smoke aparte.

El antiguo `scripts/build-hosting.sh`, que reemplazaba archivos en la raíz y asumía frontend/API separados, se deshabilita antes de instalación o escritura. Render2 requiere mismo origen. No elimina archivos del usuario ni se presenta esa vía estática como válida.

## Dependencias: candidato inicial rechazado y corregido

El primer paquete `/private/tmp/render-release-candidate-23seXM/app` se conserva pero **no está aceptado para publicar**: npm audit reportó5 vulnerabilidades de runtime, incluida una crítica. No se ejecuta audit fix automático.

Se revisan y fijan compression1.8.2 y nodemailer10.2.1; lockfile resuelve body-parser2.4.0, proxy-addr2.0.8 y qs6.16.1. La corrección de proxy-addr está documentada en [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h); cambios de correo en [releases oficiales de Nodemailer](https://github.com/nodemailer/nodemailer/releases). Actualización acotada de lockfile y npm ci sin lifecycle scripts, sin tocar servicios/credenciales.

Pruebas nuevas comprueban mínimos/versión instalada, que una subred IPv6 mal configurada no confíe en cualquier IPv4 y que Nodemailer genere un mensaje local para un único destinatario sintético con adjunto inline, sin SMTP. No se cambian reintentos, recipients, plantillas ni política de entrega. La guía de correo orientó a preservar esos límites, no a enviar mensajes de prueba.

El segundo candidato `/private/tmp/render-release-candidate-LccX1v/app` tiene326 archivos de aplicación,8 dependencias resueltas en su propia salida y manifiesto SHA256 `18cfe270d76566cc9dec07cfb536fd64f7fb9a8ec2132720dbf27feac1bf5b88`. Audit de sus dependencias runtime:0 vulnerabilidades conocidas al26/10; no certifica futuras vulnerabilidades ni herramientas de build fuera de ese paquete. Logs `/private/tmp/render-release-candidate-build-final.log` y `render-release-candidate-audit-final.json`.

### Arranque del artefacto, no del checkout

Smoke real ejecuta el `backend/src/server.js` **del candidato**, usando sus node_modules y frontend, contra PostgreSQL descartable. Proceso con red saliente denegada salvo su puerto PG local, storage propio y entorno limpio, sin secretos ni jobs/proveedores externos.

- Arranque canónico y asset JS servido con hash idéntico al archivo empaquetado.
- Dos sesiones independientes por cookie/CSRF.
- Crear tarea asignada por ID, replay sin duplicado, edición CAS de fecha, Inicio propio, nueva sesión conserva fecha.
- Empleado rechazado en rutas financieras; Reportes operacional distingue archivo histórico ausente en instalación nueva.
- 326 archivos de aplicación y bytes de dependencias invariantes antes/después.
- Procesos detenidos y fixture eliminado ENOENT, terminal0. `/private/tmp/render-release-artifact-smoke.log`, `artifact-smoke.json` junto al candidato.

## Resultados y equipo

- Backend renovado tras actualizar dependencias:2.753PASS/180opt-inSKIP/0FAIL de2.933.
- Cohorte41archivos con versiones corregidas:360PASS/0FAIL/0SKIP,161,92s. PostgreSQL solo descartable, limpieza propia.
- Empaquetado/política/correo focal:22PASS; pruebas de catálogo/protección12PASS y contratos de migración/CLI renovados.
- Build frontend MhFIu74X; frontend completo3.335PASS/1opt-inSKIP/0FAIL de3.336. No nueva prueba visual en esta etapa; la revisión1280/390/320 de cierres pertenece a la etapa anterior.

Main coordina, integra runner, prueba restauración real, dependencias y artefacto. Hilbert implementa/revisa helper de objetos y endurece empaquetado con regresiones. Fermat revisa paridad Wilson y contratos publicados, sin acceso a datos/credenciales. Superpowers ordena criterios y controles; Supabase/PostgreSQL orientan cierre transaccional de exposición; guía de correo mantiene pruebas sin envío.

## Gates que siguen impidiendo publicar automáticamente

1. **Decisión de WhatsApp pendiente:** la rama publicada tiene creación vinculada desde visita parcial y finalización privada que faltan en el contrato nuevo. Se pidió conservar/adaptar ambas antes de publicar o aceptar temporalmente la web. No se seleccionó una pérdida de funcionalidad por silencio. Ver WILSON_RELEASE_PARITY_REVIEW.md; no copiar cierres que publiquen piezas o salten aprobación.
2. **Destino/ventana de ejecución:** revisar runtime real de Hostinger y configuración indicada abajo; respaldo fresco consistente de DB y archivos/configuración, rollback compatible y permiso específico de ejecución. Los CLI locales siguen rechazando producción. No ejecutar el plan del clon contra la base viva ni falsear el entorno.
3. **Estado vigente:** refrescar preflight justo antes de la ventana. La publicación debe ser forward-only sobre la base actual: no restaurar dumps, no subir fixtures, no reejecutar histórico044/050–055 ni seeds. Nuevas tareas y cambios posteriores deben conservarse; la conciliación por ID se vuelve a planificar y revisar frente a ese estado.
4. **Identidades/servicios reales:** confirmar cuentas de dueños independientes sin promover por nombres ni tocar la decisión Líder sin repartir. Verificar archivos/proveedores y ACL reales. Pruebas sintéticas, Node24 local y copia PG18 no certifican hosting, PG17/servicios Supabase, OAuth, SMTP, Drive o dos dispositivos reales.

### Configuración a revisar sin imprimir valores secretos

Frontend/API del mismo origen `https://sistema.rendercorrientes.com`, Node24 y entrada `backend/src/server.js`/npm start del paquete. DATABASE_URL explícita sin query overrides, RENDER_DB_ENVIRONMENT=production, JWT_SECRET propio existente/rotación revisada, transporte TLS con CA oficial mediante RENDER_DB_CA_PEM cuando corresponda. No desactivar validación TLS para que arranque.

RENDER_BROWSER_SESSIONS=true, RENDER_BROWSER_ORIGIN con el origen exacto HTTPS, RENDER_BROWSER_ALLOW_LOCAL_HTTP=false. SETUP_DEMO_DATA=false; RENDER_BACKGROUND_JOBS vacío, RENDER_ALLOW_BACKGROUND_WRITES=false. Los workers externos no quedan detenidos por esos flags: revisar por separado antes de la ventana. La publicación coordinada requerirá nuevo login tras el cambio de contrato de sesión; no confundirlo con pérdida de tareas.

Revisar Google Client ID público de build y backend sin publicar claves privadas. El fallback de Login existente no prueba pertenencia ni entrega de OAuth real. No cambiar JWT/secrets/cuentas/integraciones a mano durante una subida de archivos como solución implícita.

Estado: **candidato local preparado y probado, no despliegue productivo aprobado ni realizado**. Un artefacto válido no elimina las decisiones y controles anteriores.
