# Canonical task workflow: isolated HTTP QA

## Preparación del cliente de comentarios — corte209a

Se añadió `frontend/src/pages/taskCommentCreation.js` como modelo comprobable de un intento, todavía **sin importarlo en WorkspaceReadOnly ni cambiar el botón Comentar**. El riesgo de duplicación desde la interfaz descrito en208 sigue abierto hasta la integración209b y su prueba nativa. No se considera este helper una funcionalidad conectada ni otra fuente de datos.

El modelo captura guard/request, tarea, contenido normalizado, autor y generación antes del POST; genera UUID criptográfico sin fallback legacy y serializa el body una sola vez. Conserva intención separada del texto editable y ofrece recuperación mediante GET no-store, nunca un segundo POST automático.404 no demuestra ausencia definitiva. Verifica UUID/tarea/contenido y DTO mediante mergeTaskComments; permite renombre de staff y validación explícita del autor administrativo. Descarta campos extra del DTO. No usa Storage, temporizadores ni servicios externos.

Erdos implementó exclusivamente modelo y unitarias. Volta revisó el contrato independientemente; señaló la necesidad de retener el intento aunque el compositor quede vacío, separar sus leases de lectura y no interpretar un booleano obsoleto como confirmación. La integración deberá consumir una confirmación una sola vez, fusionar207, limpiar solo la generación206 original y proteger salidas por intento no resuelto, además del texto. Descartar o desmontar no cancela ni revierte el servidor; no se promete recuperar el intento después de recargar.

La revisión corrigió éxito obsoleto tras publicación reentrante: se revalida el intento, scope y comentario exactos después del observer.401/403/409 conservan intento bloqueado como unavailable, sin ofrecer consultas indefinidas ni permitir otra creación. Los demás errores/ACK inválidos permanecen inciertos; verificar404 conserva UUID y permite otra consulta. No se afirma que todo rechazo HTTP equivalga a fallo de commit.

Verificación final:43 unitarias específicas y2682 pruebas totales frontend aprobadas, cero fallos/omitidas. Log `/private/tmp/render2-goal209a-frontend-accepted.log`. Prueban transporte modelado, no navegador/React montado ni PostgreSQL nuevo. Incluyen cambios de sesión/ABA, DTO/correlación erróneos, doble admisión, lectura404 seguida de recuperación, ausencia de UUID y reentrancias de descarte/sesión/nuevo intento al confirmar POST/GET. No se regeneró build porque el módulo aún no pertenece al grafo activo.

Este corte no modifica rutas/API/esquema, no aplica migraciones ni renueva pruebas físicas de208. La skill de trabajo estructurado orientó la separación de responsabilidades y la referencia de seguridad frontend la validación de respuestas y ausencia de secretos/negocio en Storage. Sigue pendiente209b: integración real de interfaz, pruebas de callbacks/guardas y recorrido nativo de ACK perdido.

## Recibos de creación de comentarios: base de servidor — corte208

Implementado y verificado localmente el contrato PostgreSQL/API; **la interfaz todavía no envía request_id ni ofrece recuperación**, por lo que el riesgo de reintento desde la pantalla aún no se declara resuelto. No se creó otra implementación de tareas: todos los POST, con o sin UUID, pasan por task-comment-receipts.js.

POST `/api/tareas/:id/comentarios?workspace=render_os` admite request_id UUID opcional. Cuando existe, comentario y recibo se confirman atómicamente. Mismo actor/UUID/payload normalizado devuelve la fila original con200; creación nueva201. Reutilizar UUID para otro contenido/tarea/workspace produce409. Añade creation_request_id al DTO solo cuando hay UUID. Sin UUID conserva201 y DTO plano, pero no adquiere garantía idempotente. Números/objetos antes convertidos con String ahora se rechazan400; los escritores legítimos de texto continúan compatibles.

GET `/api/tareas/:id/comentarios/solicitudes/:request_id?workspace=render_os` recupera sin reenviar, con no-store. Comprueba actor, tarea, workspace y ACL de escritura vigentes; poseer UUID no autoriza acceso.404 no prueba ausencia definitiva de una petición aún en vuelo. Un recibo cuyo comentario desapareció devuelve409, sin recrearlo. Si falta la tarea, falla disponibilidad. Recibos no contienen copia del contenido ni credenciales y no se exponen hashes privados.

El servicio captura actor/entrada antes del lease, utiliza READ COMMITTED y retiene usuario FOR SHARE, mutex transaccional actor/UUID y tarea FOR SHARE, en ese orden. La asignación se comprueba en una sentencia posterior al lock de tarea. IDs/rol/época/activo actuales deben coincidir; staff deriva autor de la fila del servidor. Su nombre no entra en el hash, pero sí el autor explícito de administración. Commit precede al ACK. Replay no entra en la rama de avisos; esta condición fue revisada en código, **no se comprobó físicamente una entrega externa de notificaciones**. Un crash entre commit y aviso aún puede perder ese aviso; no hay outbox exactamente una vez.

### Esquema y coordinación

089_task_comment_create_receipts.sql añade tabla actor/UUID, hash versionado, IDs de tarea/comentario, workspace y commit; sin backfill ni FK que elimine tombstones al borrar tarea/comentario. El FK actor RESTRICT impide borrar físicamente usuarios con recibos, intencional para auditoría; no cambia la baja lógica. Trigger rechaza UPDATE/DELETE de recibos. Startup exige columnas/tipos y binding habilitado del trigger, sin instalarlo ni repararlo; no certifica todo su cuerpo/PK/restricciones por inspección. La migración solo se ejecutó en bases descartables nuevas, no sobre una copia poblada ni sobre bases configuradas. La revisión/ensayo de actualización poblada queda pendiente antes del despliegue.

Erdos implementó módulo,089 y43 unitarias; el coordinador integró rutas, startup y pruebas físicas; Volta revisó autoridad, DTO, compatibilidad y límites en solo lectura. Sin cambios de frontend ni dependencias. Las skills de seguridad y PostgreSQL orientaron captura de autoridad, orden de locks y transacciones cortas sin llamadas externas.

### Verificación vigente

Regresión backend2082 aprobadas,127 integraciones optativas omitidas, cero fallos; frontend2639 aprobadas, cero fallos u omisiones. Logs `/private/tmp/render2-goal208-backend.log` y `/private/tmp/render2-goal208-frontend.log`. No se regeneró el frontend/build, sin cambios desde207. Focal backend67 aprobadas. Diff-check correcto.

La suite `backend/test/render2-task-comment-receipts.integration.test.js`, con RENDER2_RUN_LOCAL_INTEGRATION=true, aprobó12 comprobaciones contando el padre, sin fallos u omisiones. Log vigente `/private/tmp/render2-goal208-physical-accepted.log`. HTTP principal usa bearer real de cuentas sintéticas, no navegador/cookies/CSRF. PG55861 nuevo, identidad exacta comprobada en harness y pool de barreras. Cubrió cuatro envíos exactos concurrentes con una fila/un recibo; conflicto concurrente; intención igual con claves distintas; scope por actor; legacy; rename staff/autor admin; recuperación/replay con ACL retirada; tombstone inmutable; rollback entre INSERTs; asignación retirada mientras espera lock; revocación previa sin escritura y posterior esperando al commit autorizado (pg_blocking_pids comprobó bloqueo real); startup con trigger deshabilitado falla sin reparación.

Las comparaciones de recuperación/rechazo revisan las filas de comentarios/recibos o sus conteos según cada caso, no toda la base. Hubo setup y mutaciones intencionales de identidades/asignaciones dentro del fixture. Cleanup ENOENT final `/private/tmp/render2-local-8mgfic`, código0. Intentos previos aceptados de9 y11 comprobaciones limpiaron `/private/tmp/render2-local-zJNFsQ` y `/private/tmp/render2-local-4xyuBq`; no se suman como pruebas distintas. Sin servicios activos propios, bases existentes, proveedores, push o despliegue.

### Integración siguiente y riesgos abiertos

Conectar intento inmutable y UUID por acción en WorkspaceReadOnly, verificar recibo/ACK antes de limpiar y ofrecer Verificar envío mediante GET, conservando206/207, B posterior, guardas e incertidumbre. No generar otra clave ni reintentar automáticamente al perder ACK. La prueba nativa de respuesta perdida y recuperación queda pendiente. Los escritores legacy sin clave aún pueden duplicar reintentos; tampoco se promete persistir el intento al recargar ni deduplicar por texto.089 y servidor requieren despliegue coordinado/revisión autorizada del destino; nada está publicado ni preparado globalmente para producción.

## Lectura tardía de comentarios — corte207

Estado vigente del intercalado GET/POST: corregido localmente. La lectura inicial podía reemplazar toda la lista y ocultar un comentario confirmado mientras su respuesta estaba pendiente. No borraba la fila en PostgreSQL; la pérdida era de continuidad en pantalla.

WorkspaceReadOnly mantiene ahora una observación de lectura ligada al owner de tarea/sesión. Solo fusiona el resultado de esa lectura con sus POST confirmados, por ID, en orden created_at/id. taskCommentCollection.js valida array, ID int32 positivo, tarea esperada, strings y timestamp parseable; duplicados conflictivos generan error sin reemplazar confirmados. La validación ocurre antes de publicar estado, fuera de updaters React. No es sincronización multiusuario continua ni validación más estricta de todo el DTO del servidor.

Cada reset retira la observación de lectura y su lease UI, sin afirmar que cancele escrituras ya enviadas al servidor. Un token pendingComment separado bloquea doble admisión en la misma lease y permite que solo el intento actual libere busy. ACK/error anteriores no publican ni desbloquean un envío nuevo. Se conserva206: la generación de edición evita vaciar B al confirmar A, incluso ABA.

Erdos implementó helper, integración y25 pruebas nuevas de intercalados/validación/owners; ajustó los fixtures anteriores al DTO completo y el contrato estático de task-opening-speed. Volta identificó el bloqueo de busy durante la revisión intermedia; se corrigió y probó antes de integrar. Coordinador ejecutó regresión, build y reproducciones nativas. Backend productivo y esquema permanecen sin cambios.

Regresión final: frontend2639 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build `index-Cz_yId4p.js`. Logs `/private/tmp/render2-goal207-frontend.log`, `/private/tmp/render2-goal207-backend-final.log`, `/private/tmp/render2-goal207-build.log`. La primera regresión backend falló en una aserción estática que exigía el setComments anterior; el fixture conserva la verificación de abort/owner y exige el nuevo merge. No se retiraron pruebas ni se presentan integraciones omitidas como ejecutadas.

### Evidencia nativa y datos

El runner `/private/tmp/render2-goal207-native.mjs` creó y verificó clúster55860/HTTP52822, tarea sintética1 asignada a Luciano91003, y tomó baseline posterior al setup por API. El script temporal qa207.js se cargó antes del módulo en el index generado. Un botón visible retuvo una Response200 real del GET de comentarios sin leer su cuerpo; el POST continuó normal y el control solo mostró contadores/estados. No se inyectaron comentarios ni respuestas ficticias. Es demora controlada de lectura, no interrupción física de red.

Build206 anterior: armar lectura → abrir tarea → GET vacío retenido → enviar `QA207 comentario A confirmado` →201 y A visible → liberar GET → A desapareció, conteo DOM0. Captura `/private/tmp/render2-goal207-before-hidden.png`. PostgreSQL conservó una fila A: la reproducción no prueba eliminación de datos.

Build207 corregido a390×844: repetir la secuencia → liberar GET → A continuó visible, conteo DOM1. Tras recargar sin retener el nuevo GET, A siguió una sola vez, compositor vacío. Captura `/private/tmp/render2-goal207-after-visible-mobile.png`, inspeccionada visualmente. El control QA se superpone al pie y no forma parte del diseño publicado. No se probaron nativamente todas las variantes de reset/errores/ABA de las pruebas automatizadas.

Ambos runners confirmaron una fila exacta A, autor Luciano QA, tarea1;103 tablas completas restantes invariantes, excluyendo tarea_comentarios y familias auth/browser_session del hash general. Resultado `EXACT_ONE_COMMENT_A_ONLY; OTHER_TABLES_UNCHANGED 103`, código0 y cleanup ENOENT: anterior `/private/tmp/render2-local-ggCnGj`, corregido `/private/tmp/render2-local-sJLeLt`. Pestañas propias cerradas, viewport restaurado y qa207.js/referencia retirados con comprobación de ausencia. Sin base existente, proveedor, push o despliegue.

En207 quedaban pendientes recibo/idempotencia ante ACK perdido y reintento humano, concurrencia entre leases/dispositivos y aceptación integral.208 incorpora la base de servidor descrita arriba, todavía no el cliente ni su recuperación nativa. Retirar una lease permite coexistencia de una escritura antigua ya enviada y otra nueva: no se promete cancelación remota ni deduplicación entre claves distintas. El pendiente histórico de GET tardío de206 queda cerrado solo bajo el contrato y recorrido207 descritos.

## Continuidad del compositor de comentarios — corte206

Corrección local del24 de octubre de2026, independiente de la prueba histórica de estados descrita abajo. El compositor de WorkspaceReadOnly vaciaba el texto incondicionalmente después del ACK: escribir B mientras se enviaba A perdía B aunque nunca hubiera sido enviado.

Ahora cada edición incrementa una generación síncrona dentro de un owner ligado a tarea y captureRequest. El POST captura ese owner/generación; añade el comentario confirmado, pero solo vacía la observación enviada si no hubo otra edición. A→B→A tampoco se confunde con texto intacto. Reset de contexto invalida la generación, y errores/finally antiguos no repintan otro propietario. Backend, payload, permisos y almacenamiento no cambian; no se guardan borradores en Storage ni se reintenta automáticamente.

Erdos implementó WorkspaceReadOnly y19 pruebas nuevas en taskCommentDraftObservation.test.js; el fixture existente workspace-session recibió el owner real requerido sin relajar aserciones. Volta revisó generación, errores, ABA y límites; el coordinador ejecutó regresión y dos recorridos nativos. Los tests ejecutan callback/handler reales y kernel cookie, no un React montado por sí mismos.

Regresión final: frontend2614 aprobadas, cero fallos u omisiones; backend2038 aprobadas,126 integraciones optativas omitidas, cero fallos. Build `index-CKa36j8q.js` y diff-check correctos. Logs `/private/tmp/render2-goal206-frontend.log`, `/private/tmp/render2-goal206-backend.log`, `/private/tmp/render2-goal206-build.log`. Las integraciones omitidas no se dan por renovadas.

### Reproducción anterior y corrección nativa

El runner `/private/tmp/render2-goal206-native.mjs` usó clúster nuevo55859 y HTTP52821, verificó identidad exacta y creó por API una tarea sintética asignada a Luciano91003. Un script QA temporal se cargó antes del módulo en el index generado, sin modificar bundles ni fuentes de producto. Un botón visible armó una única retención: solo POST same-origin `/api/tareas/:id/comentarios`; tras recibir201 real, retuvo la Response hasta pulsar Liberar. No leyó cuerpos/cookies/credenciales y delegó el resto del transporte. Es demora inyectada del ACK, no pérdida física de red.

1. Build205 anterior, escritorio: escribir `QA206 comentario A enviado`, armar retención y pulsar Comentar. Control confirmó POST1/servidor201. Escribir `QA206 borrador B sin enviar`, liberar: A apareció guardado y B desapareció. Reproducción del defecto, no un resultado aceptado de UX. Captura `/private/tmp/render2-goal206-before-loss.png`.
2. Build206 corregido,390×844: repetir exactamente. A apareció en la lista, B conservó su valor exacto y Comentar volvió a habilitarse. Lectura DOM confirmó textarea editable con B. Captura `/private/tmp/render2-goal206-after-preserved-mobile.png`, inspeccionada visualmente; el control QA visible se superpone a parte del pie y no representa el diseño de producto.
3. Tras restaurar escritorio, Cerrar tarea mostró el diálogo de descarte existente. Seguir editando conservó B. Para limpiar la prueba se vació B manualmente sin enviarlo; tras recarga A siguió visible y el compositor quedó vacío. No se afirma que B sobreviva a una recarga aceptada. Captura adicional `/private/tmp/render2-goal206-after-preserved-desktop.png`.

En ambas bases se verificó exactamente una fila de comentario: tarea1, autor Luciano QA, contenido A. B nunca fue enviado. Las otras103 tablas completas comparadas quedaron invariantes; se excluyeron tarea_comentarios y las familias de autenticación del hash general. Cada runner terminó0 con `EXACT_ONE_COMMENT_A_ONLY; OTHER_TABLES_UNCHANGED 103` y cleanup ENOENT: anterior `/private/tmp/render2-local-6h7XGR`, corregido `/private/tmp/render2-local-5OuhCJ`. Se cerraron solo las pestañas propias, se restauró viewport y se retiraron qa206.js y su referencia del index generado. Sin bases existentes, proveedores, push ni despliegue.

### Límites vigentes

En206 no se resolvieron idempotencia ante ACK perdido, admisión síncrona de dos envíos antes del render ni reemplazo por GET anterior.207, documentado arriba, corrige GET tardío y admisión dentro de una lease; idempotencia y concurrencia entre leases siguen pendientes. No se declara completo el dominio de comentarios. No se modificó TareasTablero, cuyo montaje canónico no se confirmó. La prueba histórica de estados y sus cifras siguientes conservan su alcance original.

Status: latest authorized isolated run with shared DB approval-invalidation guard completed: **10 passed, 0 failed, 0 skipped** (9 assertion groups plus parent). Owned files only: `backend/test/render2-task-workflow.integration.test.js` and this document. No application, schema, harness or older test edits.

## Isolation / execution

Uses the guarded principal harness with `port:55598,deferTaskStateMigration:true`. A fresh disposable PostgreSQL cluster binds only to loopback; principal HTTP is manually bound to another ephemeral loopback port, default startup/schedulers disabled, inherited secrets absent, external fetch rejected. All identities and content are synthetic. Only this suite's exact fixture is stopped/removed; cleanup asserts that directory is absent. Never use production or an existing database.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-task-workflow.integration.test.js
```

Default test discovery skips before PostgreSQL provisioning. Suite timeout 150s; bounded HTTP/SQL/startup/cleanup are inherited from the harness.

## Verified assertions

- Actual 058 upgrade over populated legacy `publicada`/`programada` tasks, editorial real-date history and goal/slot/event history. Compare all rows before/after applying unchanged SQL, then record only successful 058 in the migration ledger. No old function swaps or backfills.
- Real logins: admin, assigned editor, Community finalizer, Production employee. Canonical HTTP progression `pendiente → en_progreso → en_revision → aprobada → finalizada`, with current integer revisions on each write.
- Generic approval is admin-only and requires review; dedicated approval supports non-video tasks, publisher ID handoff and revision checks; repeat approval rejects.
- No skipped approval, employee approval/finalization, initial approved/finalized POST, stale revision or missing state-write revision. Rejected requests preserve task/binding snapshots where applicable.
- Client `revision_aprobada` metadata cannot approve a review-state task; rejected or sanitized input must leave approval false and finalization blocked.
- Reopen approved work clears approval identity/timestamp metadata and requires another approval.
- Editing approved material via assigned-employee HTTP returns the task to `en_revision`, clears verified approval fields and blocks finalization. After admin reapproval, direct SQL changes to instructions/copy trigger the same invalidation and block finalization again. Only fresh admin approval permits completion; editorial state/date remain unchanged.
- Legacy API final write `publicada` stores canonical `finalizada`; raw historical SQL rows remain untouched by 058.
- Completing/reopening a linked task never publishes/unpublishes or changes the editorial real date. Only the actual existing editorial publication route marks it published and sets its real date.
- Exception is restricted to actual Production visits: incomplete visit cannot finish; actual recording endpoint supplies completion before Production owner can finalize without approval. Generic production work still requires approval. No Phase 2 per-video implementation claim.
- Omitted-workspace regression: admin PATCH of an incomplete persisted Render OS visit without `?workspace=` must still return 400; full task/metadata/revision/binding snapshots must remain unchanged. Query omission cannot select a weaker historical path.

Main owns semantic updates to prior Phase 1/assignment suites: old API-completion assertions expecting task `publicada` must use canonical `finalizada`, and prior approval setup may need actual state approval rather than trusting client metadata. This QA task does not edit those files.

## Results

Ran against coordinator READY implementation with actual migration 058 deliberately deferred, populated legacy history snapshotted, real SQL applied and ledger recorded only after invariance assertions. All nine groups passed, including exact canonical persisted states, stale-write snapshots, metadata forgery rejection/sanitization, actual editorial publication date, non-video dedicated approval, the production visit exception via real recording HTTP and shared approval invalidation through HTTP/raw SQL. Installing the new BEFORE UPDATE guard still preserved every historical row snapshot.

The first run stopped the production group at a test expectation mismatch: a production employee was correctly rejected with 403 for generic production work, not a transition-status error. The test now asserts that exact 403 and separately checks an admin is rejected for missing approval; the subsequent full run passed 9/9. No application behavior was changed or approval invariant relaxed.

Latest rerun including omitted-workspace rejection: **10/10 passed**, no failures/skips. Admin finalization without a workspace query returned 400 and preserved the complete incomplete-visit snapshot. Cleanup stopped the exact own fixture and asserted `/private/tmp/render2-local-NESuQ3` no longer exists; port 55598 had no remaining listener. Other fixture clusters were not touched. Syntax/whitespace checks passed. This does not claim per-video Phase 2 production completion, every historical workflow writer, or frontend verification.

P2 compare-and-swap protection on specialized production recording remains explicitly pending and is not claimed by this suite's normal recording-flow checks.
