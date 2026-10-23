# Revisión 150: permisos transaccionales de Estructura

## Corrección implementada localmente

POST `/api/estructura` conserva su middleware administrador y respuesta 201. El guardado se extrae a `backend/src/client-structure.js`: captura ID/versión de sesión y parámetros escalares antes de esperar una conexión; abre transacción; adquiere el mutex administrativo existente; revalida la cuenta actual bajo FOR SHARE; ejecuta el UPSERT y confirma antes de responder.

El bloqueo de cuenta se mantiene durante las esperas de fila y hasta COMMIT. Una revocación confirmada antes del bloqueo impide el UPSERT: 401 por sesión revocada/inactiva y 403 por rol ya no autorizado. Si el guardado adquirió primero el bloqueo, la revocación espera su confirmación y los siguientes intentos quedan denegados. No se atribuye cancelación retroactiva a una operación ya autorizada.

Se preservan las reglas originales: clave cliente/día, domingo cero válido, tema vacío convertido a null, horario/CTA/tipo omitidos o vacíos conservados mediante COALESCE en actualización, reactivación de la fila sin duplicación. La validación de entradas sigue siendo la heredada; esta revisión no afirma que se haya endurecido todo el contrato de Estructura ni su concurrencia de contenido entre dos administradores. No añade versiones/CAS de la celda.

Rollback y liberación se ejecutan ante errores; una conexión con rollback fallido se descarta sin reemplazar el error original. El helper de autoridad existente se reutiliza, sin nuevas identidades por nombre ni copia de lógica de roles.

## Coordinación

- Integrador: nuevo helper, conexión de server.js y adaptación de la comprobación de extracción SQL en historias-weekly-structure.test.js. Único editor de server.js.
- Hypatia: client-structure.test.js, 17 pruebas unitarias.
- Poincare: render2-client-structure-authority.integration.test.js, fixture PostgreSQL físico.
- Beauvoir: revisión independiente favorable de orden de bloqueos, autoridad actual, paridad y cleanup; sin ediciones.
- Carver: confirmó mediante fuente el pendiente de error de lectura de tareas vinculadas en Publicaciones; sin ediciones.

No se modificaron esquema, dependencias, entorno, estilos ni interfaz. Se preservaron archivos heredados preview/sandbox no versionados. No hubo acceso ni despliegue en producción.

## Evidencia de pruebas

- `node --test test/client-structure.test.js`: 17/17 aprobadas. Orden BEGIN/mutex/actor/UPSERT/COMMIT, captura antes del lease, fallos SQL, autorización, ACK posterior al commit, rollback y descarte.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-client-structure-authority.integration.test.js`: 7/7 aprobadas, sin omisiones. Harness revisado, cluster nuevo propio en localhost:55800, identidad de base/usuario/puerto/directorio verificada, usuarios y cliente sintéticos. HTTP real prueba creación, actualización sin duplicar, COALESCE, reactivación y rechazo de empleado. Barreras sobre SQL real verifican revocación antes del bloqueo sin escrituras; pg_blocking_pids prueba el PID concreto del revocador esperando al guardado. Hashes de tablas verifican ausencia de DML en intentos denegados.
- Cleanup ENOENT y comprobación posterior confirmados para `/private/tmp/render2-local-Ujrwdh`.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-stories.integration.test.js`: 6/6 aprobadas en otro cluster nuevo propio, puerto55691, cleanup ENOENT comprobado por el test. Incluye que la estructura semanal y checklist no inventan publicación efectiva.
- `npm test` backend final: 2.011 casos; 1.897 aprobados, cero fallos, 114 omitidos por gates de integración. No representa ejecución de todas las integraciones físicas.
- `node --check` del helper/server y `git diff --check` satisfactorios.

Logs temporales locales: `/private/tmp/render2-structure150-unit.log`, `/private/tmp/render2-structure150-physical.log`, `/private/tmp/render2-structure150-stories.log`, `/private/tmp/render2-structure150-final-backend.log`. Sin nueva validación visual/móvil porque esta revisión modifica el servidor, no UI.

## Próximo pendiente confirmado

En `frontend/src/pages/Publicaciones.jsx`, el efecto de GET `/api/publicaciones/:id/tareas` convierte fallo o payload no-array en `[]`; el detalle después afirma que no hay tareas vinculadas. Separar loading/ready/error por observación de pieza y sesión, conservar abort/fence ABA y añadir reintento explícito de solo lectura. El vacío afirmativo debe mostrarse únicamente tras un array vacío verificado. La corrección aún no está implementada en esta revisión.

El rescate global continúa abierto: no se certifican todos los permisos, recorridos, diseño ni preparación global para despliegue por esta corrección local.
