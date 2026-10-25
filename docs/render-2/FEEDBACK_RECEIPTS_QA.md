# Feedback receipts: independent principal HTTP QA

## Candidatos activos para avisos nuevos — corte255

private-feedback-notifications.js ahora exige activo IS TRUE en el SELECT de destinatarios. Antes, una cuenta inactiva podía encolar un aviso. Cambia solo la selección para nuevos enqueues: responsables por nombres, exclusión del autor, mensajes, fingerprints, detalles, recibos y permisos de notas quedan intactos. El fixture unitario de recibos se actualizó a la consulta exacta, sin relajar sus aserciones.

Erdos escribió3 unitarias nuevas, coordinador reprodujo3FAIL antes del cambio y24 focales PASS después. Volta preparó la física nueva render2-feedback-notification-active.integration.test.js; coordinador inspeccionó/ejecutó, Erdos revisó producto/alcance sin bloqueantes. PostgreSQL descartable55891 clusterOnly, pool dedicado e identidad física verificada: inactivo inicial no encola ni cambia tablas; activar permite una fila pending exacta; desactivar impide un intento con fingerprint distinto y conserva la fila anterior.106 tablas observadas, únicamente dos cambios de actividad/trigger074 y una notificación permitidos después del baseline; nota, otros usuarios y resto de tablas intactos.4PASS contando padre+3subtests, cleanup ENOENT /private/tmp/render2-local-1ZiJX4. Rojo Xy53ok: el primer negativo encoló indebidamente; fallos posteriores en cascada no son cuatro reproducciones independientes. Ambas raíces eliminadas. Logs /private/tmp/render2-goal255-unit-red.log, unit.log, physical-red.log y physical.log.

Renovada la integración HTTP de recibos existente:16PASS,0fallos/omisiones, log /private/tmp/render2-goal255-feedback-receipts.log con cleanup propio. Backend2259PASS/142optativasSKIP/0fallos, /private/tmp/render2-goal255-backend.log. No regresión frontend/build nuevo: este corte no modifica frontend. Superpowers, seguridad Express y guía PostgreSQL orientaron el filtro de servidor y las pruebas aisladas. No SMTP, proveedor, bases configuradas ni deploy.

Límite: la física nueva prueba resolver/servicio sobre PostgreSQL, no una ruta HTTP nueva ni worker. La integración HTTP renovada comprueba compatibilidad de recibos, no entrega a una cuenta inactiva. El filtro no revoca avisos existentes, no retiene actividad después del SELECT y no resuelve homónimos/reutilización de claves o binding por ID. La elegibilidad legacy de avisos ya encolados sigue pendiente. No aceptación global de notificaciones ni del objetivo maestro.

## Evidencia histórica inicial

Status: **PASS — final coordinator execution; files frozen**. Contract `FEEDBACK_RECEIPTS_CONTRACT.md` read completely. QA author owned only `backend/test/render2-feedback-receipts.integration.test.js` and this document; application integration and executions belong to the coordinator.

Final evidence: coordinator ran **16/16** feedback HTTP tests after the user-deletion guard and token lock/clock fixes, including two real PostgreSQL barriers (note lock and unchanged token-row lock). Each HTTP transaction demonstrably began and waited before expiry, then returned409 after expiry with unused token and identical persistence snapshots. Fixture `/private/tmp/render2-local-6HgXyU` stopped/removed with absence asserted. All ten suites then ran together: **116 passed, zero failures/skips**. Final backend pure regression **796 passed / 17 opt-in skipped**, frontend page regression **152 passed**, final frontend build passed.

Principal browser smoke: `qa_designer` edited another author's synthetic note containing server-provenance fields, saved and reloaded; mobile390 marked it resolved and reloaded with content/state/creator retained. Document width equals viewport390. Screenshots `/private/tmp/render2-feedback-desktop.png` and `/private/tmp/render2-feedback-mobile.png`. Fixture `/private/tmp/render2-local-cMwPri` stopped and removal confirmed; viewport reset and agent tab closed. No new layout was claimed, only scoped compatibility. An additional direct psql read was blocked by the local sandbox and not used as evidence; HTTP/SQL invariant tests independently prove provenance preservation.

Actor-history deletion is verified: within the current-auth subtest, admin DELETE of actor102001 with a committed receipt returns409 with a deactivation instruction. Full actor row remains present/active/unchanged and receipt/note/audit/token/notification snapshots are identical.

Expiry regression: two independent iterations hold (1) the target note by a no-op UPDATE and (2) the unchanged confirmation tuple via SELECT FOR UPDATE. Each uses one fixture SQL transaction/session, sleeps1.5s then rolls back. Token expiry is set to wall clock+0.8s before either lock; the token blocker never changes its row. `pg_stat_activity` marker/PgSleep establishes each blocker. The signed PATCH is observed waiting with transaction start and observation both before expiry, then returns409 after expiry. Token stays unused and full persistence snapshot is unchanged. Poll barriers650ms, intervals15ms, HTTP5s. These are the actual final coordinator-verified assertions, not simulated waits.

Initial coordinator run15/15 (fixture `/private/tmp/render2-local-qANDaz`, cleanup asserted) and intermediate ten-suite115/115 results were superseded by the final totals above. No old-suite assertions were weakened. Injected audit and queue errors deliberately return500 and roll back; they are passing fault-injection cases, not unexplained runtime errors. All fixtures are new/synthetic. These results do not establish production readiness or successful external notification delivery.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-feedback-receipts.integration.test.js
```

Exact file only; no broad test discovery. Fresh guarded PostgreSQL fixture **55604**, `deferFeedbackReceiptsMigration:true`, synthetic human users 102001/102002/102003, explicit WhatsApp mappings and Telegram map. In-memory ephemeral RSA keypair; public key injected through the harness allowlist. Real v2 signatures cover full target including query and canonical request body. Private key remains in the test process. Real `/confirmaciones` tokens for both feedback channels. No ordinary backend startup, existing DB, secrets, external transport or production write.

Parent timeout 180s; requests 5s; fixture queries/start/stop use harness bounds. Exact-root cleanup stops the owned cluster and asserts its directory absent. Execution remains reserved for main's explicit coordinated run. Ensure frontend build is complete (`frontend/dist/index.html` exists) before provisioning.

## Verified checks (15 subtests + parent: 16 tests)

- Defer actual `061_feedback_operation_receipts.sql`; seed notes with unverified historical JSON keys, notification, audit and old confirmation. Snapshot full PostgreSQL JSON values (including timestamp precision), apply actual migration, assert unchanged history and zero receipts/no key backfill, inspect minimal receipt columns, then ledger insertion.
- Browser POST/PATCH rejects all six reserved keys at root and nested feedback for both real-login admin and `qa_designer` employee; snapshots remain unchanged. Employee can create a normal note and edit another author's business metadata without changing its creator, retaining intentional shared-team access. Valid business edit preserves historical provenance without promoting its trust version.
- WhatsApp and Telegram both require an exact token. Forged signed display name never becomes confirmer; server actor ID/name/channel/time/version are checked. Editable JSON carries no replay key.
- A third linked WhatsApp actor is omitted from the individual allowlist but belongs to an allowed group. Its signed private confirmation/create/edit succeeds under the existing signed-unknown-private policy; group-only create/edit confirmations, mutations using valid private tokens, and retries of committed private create/edit receipts all return exactly 403 with unchanged SQL snapshots. Group ID is included in the actual v2 signature/header.
- Create retries return current shared DTO after browser edits; actor/operation/key/hash scopes remain separate. Legacy JSON poison cannot hijack a new operation. Minimal receipt has no saved business snapshot, secret, key or hash.
- Exact confirmation binds actor/key/intention, expires, rejects legacy tokens; unsuccessful requests leave token and persistence unchanged.
- Concurrent identical create: one 201 and one 200, one receipt/audit/private notification and one consumed token. Conflicting same-key create: one 201/one 409.
- Edit base version comes from actual HTTP GET. Concurrent different-key edits sharing one version yield one 200/one 409. Rapid versions increase by at least 1ms; a fresh GET-derived edit succeeds. Exact old replay survives a later edit; same key/different target conflicts; missing version rejects.
- Audit failure after create mutation, audit failure after edit UPDATE, and notification-INSERT failure each use fixture-only SQL triggers with internal SQLSTATE XX000. Snapshot note/receipt/audit/token/notification rollback; drop trigger/function in finally, retry same token once. Replay adds no side effects. Notification failure must fail the HTTP operation, not silently become a post-response callback gap.
- Create and edit receipts survive archive and permanent purge: null feedback plus archived/deleted flag, no resurrection or content snapshot.
- Current inactive/unsupported-role/disabled-mapping actor cannot obtain an old successful retry; authorization precedes replay.
- Keys reject malformed/empty/oversized values and header/body disagreement; valid 200-character key is trimmed, not truncated. Contradictory aliases and unknown/malformed business fields reject; contenido/detalle normalize to the same retry intent. PATCH explicit empty versus omission remains distinct.

## Interface coordination / limits

No helper imports are required from main or Archimedes; QA deliberately uses principal HTTP and independent SQL. Confirmation requests use the existing endpoint envelope `{operacion,tarea_id?,payload}`; edit target stays in `tarea_id`. Business fixtures use `seccion:'equipo'`, `contenido`, `responsables`, `permitir_duplicado`; equivalent `detalle` is the alias regression. If implementation changes these established transport fields, coordinate explicitly rather than silently adapting behavior assertions.

Default skip/syntax checks are separate from the coordinator's HTTP/SQL evidence. This suite does not change shared-team note access or purge policy. The existing browser notification transaction gap is outside scope and is not claimed fixed. Reliable external delivery, retention/rollout approval, UI behavior and production validation are not tested here.
