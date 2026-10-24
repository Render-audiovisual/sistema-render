# Canonical task workflow: isolated HTTP QA

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

El fix no resuelve idempotencia ante ACK perdido, admisión síncrona de dos envíos antes del render ni el posible reemplazo de la lista por un GET anterior demorado. Estos intercalados necesitan su propio contrato/pruebas; no se declara completo el dominio de comentarios. No se modificó TareasTablero, cuyo montaje canónico no se confirmó. La prueba histórica de estados y sus cifras siguientes conservan su alcance original.

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
