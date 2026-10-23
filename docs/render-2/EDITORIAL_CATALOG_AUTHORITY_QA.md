# Revisión 156: autoridad y snapshot de catálogos editoriales

## Corrección local de S155-01

GET `/api/historias` y `/api/publicaciones` usan `backend/src/editorial-catalog.js`. Captura ID/rol/versión de sesión antes de esperar el lease; abre REPEATABLE READ READ ONLY; lee y valida actor activo; obtiene piezas, evidencia editorial y DTO con ese mismo cliente/snapshot; confirma antes de devolver. Un cambio de ID/rol/epoch/actividad observado al primer SELECT devuelve401 antes de consultar piezas/evidencia. Las rutas añaden Cache-Control no-store.

Se preservan exactamente las consultas anteriores (comparación contra HEAD155 ignorando solo whitespace), columnas/aliases Unicode, formato de fechas, orden y condiciones de archivo. Historias sigue excluyendo archivo; Publicaciones conserva el flag exacto `req.query.incluir_archivadas === "true"`. No se introduce whitelist de roles ni permiso nuevo: administrador verificado conserva proyección administrativa; demás roles mantienen DTO operativo cerrado. El flag y autoridad se capturan antes del primer await y no pueden cambiarse mutando los objetos del caller durante el lease.

La autorización es temporalmente consistente en el primer snapshot: una revocación posterior no cancela retroactivamente la lectura ya autorizada; la siguiente lectura con epoch anterior se rechaza. El mismo snapshot evita combinar contenido viejo con revisión/evidencia nueva. El lector no escribe piezas, eventos ni tareas.

Rollback y release son únicos; si falla rollback se descarta la conexión sin reemplazar el error original. No se modificó el algoritmo de evidencia ni se fabricaron confirmaciones. Sin cambios de esquema, migración, dependencia, frontend o entorno. No se consultaron bases configuradas, secretos ni producción.

## Coordinación

- Integrador: helper, extracción SQL, conexión de ambas rutas en server.js y pruebas finales. Único editor de server.js.
- Carver: editorial-catalog.test.js, 10 pruebas unitarias con anotación real y transporte simulado.
- Poincare: render2-editorial-catalog-authority.integration.test.js, fixture físico aislado; integrador lo revisó y ejecutó.
- Beauvoir: revisión independiente favorable de SQL/paridad, captura, snapshot y cleanup, sin ediciones.
- Hypatia: contrato de compatibilidad para los writers pendientes S155-02/03, sin editar ni ejecutar servicios.
- Skills: trabajo estructurado y seguridad guiaron el límite actor/dominio, validación de invariantes y distinción entre fallo de autorización ordinario y carrera de revocación. No se afirma que el hallazgo permitiera acceso financiero ordinario de empleados.

## Evidencia reproducible

- `node --check src/editorial-catalog.js` y server.js satisfactorios desde backend; git diff --check satisfactorio. La primera invocación de syntax check tuvo un prefijo de ruta duplicado por cwd; se corrigió y no se presentó ese error de invocación como defecto de producto.
- Paridad SQL contra el server.js de155 mediante extracción y comparación sin whitespace: historia=true/publicacion=true. Log `/private/tmp/render2-editorial156-sql-parity.log`.
- `node --test test/editorial-catalog.test.js`: 10/10 aprobadas. Incluye anotación real de evidencia consistente/inconsistente, proyección cerrada, captura prelease, dominio/flags inválidos, filas malformadas/vacías, fallos BEGIN/actor/catálogo/evidencia/COMMIT y rollback fallido.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-editorial-catalog-authority.integration.test.js`: 12/12 aprobadas, sin omisiones. Nuevo PostgreSQL propio55803, identidad de base/usuario/puerto/directorio verificada. HTTP real para ambos dominios con dueño, empleado y rol custom; campos administrativos previos, metadata privada solo para dueño, no-store y archivo conservados.
- Barreras sobre SQL físico, sin fabricar filas: seis revocaciones antes del actor (rol/epoch/inactivo × dos dominios) devuelven401 con solo BEGIN/actor/ROLLBACK. Cambio externo de pieza/metadata/revisión y revocación después de la lectura base conserva contenido/metadata/revisión antiguos coherentes; siguiente consulta vieja denegada y consulta con epoch nuevo ve los cambios/revisión siguiente. Mutación de auth/options mientras espera lease no cambia actor ni archivo.
- Hashes de todas las tablas comparados después de preparar las mutaciones de prueba acreditan ausencia de DML de los lectores. Se usan canarios sintéticos y hashes para evitar imprimir payloads privados.
- Cleanup ENOENT y ausencia posterior confirmados de `/private/tmp/render2-local-13NpNa`.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-stories.integration.test.js`: 6/6 aprobadas, sin omisiones, otro cluster nuevo propio55691 y cleanup comprobado por el test. Regresión de edición/persistencia, checklist separado de publicación y conversiones seguras.
- `npm test` backend final: 2.022 casos, 1.907 aprobados, cero fallos, 115 omitidos por gates de integración. No equivale a ejecutar todas las integraciones físicas. Frontend no cambiado ni nueva validación visual requerida/acreditada por este corte.

Logs temporales: `/private/tmp/render2-editorial156-unit.log`, `/private/tmp/render2-editorial156-physical.log`, `/private/tmp/render2-editorial156-stories.log`, `/private/tmp/render2-editorial156-final-backend.log`.

## Límites y próximo trabajo

La prueba de concurrencia física invoca el helper real con un wrapper de conexión que pausa SQL; las rutas HTTP reales se prueban aparte para identidad/proyección/archivo. No se afirma haber retenido la petición HTTP en middleware ni haber reproducido producción. Evidencia confirmada manualmente se prueba con la función real y filas simuladas; la barrera física comprueba revisiones reales y ausencia de publicaciones inventadas, no un recorrido nativo completo de confirmación.

S155-02 y S155-03 siguen abiertos: writers del checklist/fechas especiales necesitan actor retenido y contrato estricto. Caller actual del checklist envía boolean sin nombre, por lo que puede endurecerse preservando ese payload. Checklist no debe convertirse en confirmación editorial. PATCH de fechas especiales no debe adquirir campos nuevos por inferencia; resolver estado/idea con tipos explícitos y vacío vs omisión. No añadir CAS/recibos implícitos sin coordinar DTO/caller.

Los gates de recorrido intersectorial completo, orden manual nativo, calendario por encima del cap, refresh de Inicio, foco del shell y diseño global continúan pendientes según CURRENT_MASTER_REVIEW_155.md. Estado: implementado y verificado localmente; no preparado globalmente para despliegue, no desplegado. Objetivo maestro activo.
