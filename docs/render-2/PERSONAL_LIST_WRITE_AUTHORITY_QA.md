# Autorización transaccional de escrituras personales

S175-01 queda corregido y verificado en desarrollo local para los escritores HTTP de Mi lista. Las operaciones capturan ID, rol y época antes de adquirir conexión, verifican el actor actual bajo bloqueo exclusivo y conservan ese bloqueo hasta commit. Una revocación confirmada antes de autorizar la operación impide su DML; una revocación posterior espera a la escritura ya autorizada. No hay rechazo retroactivo de commits legítimos.

## Implementación

personal-list-write-authority.js expone withPersonalListWrite(pool,auth,normalizedInput,run). Clona/congela la entrada normalizada y el actor antes del primer await. Abre READ COMMITTED, lee usuarios FOR UPDATE y exige ID/rol/época exactos y activo:true. El callback recibe esa conexión y devuelve datos, no una respuesta HTTP. COMMIT precede al retorno. Ante error intenta rollback; si este falla, descarta la conexión y conserva el error original.

personal-lists.js adopta el helper en14 rutas: plantillas2, páginas2, secciones3, items3, bloques3 y reordenamiento1. El alta raíz con recibo087 conserva su servicio transaccional independiente:15 escritores en total, no transacciones anidadas. El reordenamiento elimina su BEGIN/COMMIT interior y utiliza el mismo callback autorizado. GET no se convirtió en escritura ni en snapshot nuevo.

Se conservaron SQL de dominio, propiedad por ID, BIGINT como string, normalización, DTO/status, CAS existentes y semántica de orden parcial. No se agregaron CAS a endpoints legacy ni permisos basados en nombres. El orden actor→dominio coincide con087 y con el usuario objetivo SHARE de MIA. COUNT/MAX y altas por usuario ahora también quedan serializados dentro de esas rutas. Esto no introduce una restricción global de posiciones únicas ni demuestra toda concurrencia MIA/UI.

No hay migraciones nuevas, cambios de server.js ni frontend. No se modificaron las listas reales ni los servicios de producción.

## Pruebas

- 53 pruebas focales aprobadas. Incluyen11 del helper y handlers reales PATCH de página/bloque con COMMIT retenido: ninguna respuesta anticipada. Fallo de COMMIT provoca rollback/error sin respuesta de éxito. La validación400 local mantiene cero consultas; DTO/CAS/propiedad conservan sus asserts.
- Regresión backend final:1982 aprobadas,120 integraciones omitidas, cero fallos. Las omitidas no se presentan como ejecutadas.
- Cohorte física de regresión:26 aprobadas en recibos087, persistencia/CAS y runtime cookie, secuencial sobre tres clústeres nuevos.
- Cohorte física final:38 aprobadas,26 en autorización nueva y12 en interoperabilidad MIA. Cero fallos/omitidas.

La suite nueva render2-personal-list-write-authority.integration.test.js verifica identidad exacta de fixture y observa pg_stat_activity/pg_blocking_pids. Las esperas temporizadas solo espacian consultas: no constituyen la evidencia de bloqueo. Matriz:

1. Cada una de las14 rutas espera al usuario bloqueado; una época revocada durante esa espera produce401 y snapshots personales/MIA/tareas intactos. Los tres tipos adicionales de orden completan listas/secciones/items además de bloques.
2. Página y bloque rechazan también cambio de rol o inactivación antes de autorizar el DML.
3. Si la escritura ya retuvo al actor y espera la fila de dominio, la revocación espera al PID real del escritor. Al liberar dominio, el guardado confirma una vez y la revocación termina después; la petición siguiente con época vieja obtiene401.
4. Un trigger de fallo sintético en la segunda fila de un orden de bloques revierte todas las posiciones/versiones previas. Tras retirar solo ese trigger de fixture, el reintento explícito funciona.
5. CAS viejo, dueño ajeno y petición anónima siguen rechazados sin cambios de dominio.

La primera ejecución no pasó por dos errores del test, no por un fallo confirmado del helper: un cambio SQL solo de rol no revoca la época, por lo que una lectura posterior con rol fresco puede ser200; la petición en vuelo sí había sido rechazada. Además, más de20 logins del mismo identificador sintético alcanzaron el throttle. El test corregido retira únicamente ese bucket del identificador en la fixture verificada, conserva el bucket de peer y no cambia límites del producto. El fallo500 del trigger de reorder es intencional y su rollback forma parte de la prueba.

Logs locales: `/private/tmp/render2-authority176-focused.log`, `/private/tmp/render2-authority176-backend-final.log`, `/private/tmp/render2-authority176-regression-physical.log`, `/private/tmp/render2-authority176-final-cohort.log`. El intento fallido está en `/private/tmp/render2-authority176-physical.log`; no se usa como resultado verde.

## Limpieza y alcance

Los hooks verificaron ENOENT de las raíces generadas en cada ejecución. Regresión: `/private/tmp/render2-local-1tiBKx`, `render2-local-npEFJH` y `render2-local-4sVAdb` bajo el mismo directorio. Cohorte final: `/private/tmp/render2-local-l17DG0` y `/private/tmp/render2-local-stBGVz`. Los intentos anteriores también limpiaron sus raíces mSH3oW y X6mqXc. No se reutilizaron bases comerciales ni se limpiaron recursos de PostgreSQL ajenos.

Poincare implementó helper y11 pruebas unitarias; Hypatia escribió las barreras físicas; Beauvoir y Carver hicieron revisión independiente. El coordinador integró14 rutas, actualizó los dobles CAS, añadió pruebas de respuesta postcommit y las tres variantes de orden, y ejecutó las suites. Las skills de seguridad/trabajo estructurado guiaron la separación entre autorización vigente y controles visuales; documentación solo local.

La cobertura nueva no es navegador nativo, no cambia la política de borrado legacy, no añade recibos a cada operación, no revisa todos los GET ni demuestra toda intercalación concurrente MIA/UI. La interoperabilidad MIA ejercita contratos y revocación, pero no todos los posibles bloqueos entre productores simultáneos. La aceptación global de Render2 y el despliegue continúan abiertos.
