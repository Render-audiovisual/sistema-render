# Wilson / WhatsApp release parity contract — 2026-10-26

## Status, ownership and decision gate

Read-only source audit baseline: local `a99dc6a92de73f2683b2ce3c9b494c458ed07540` versus remote `43f02707e299293c5b0c2bb6f12386bd4642746b`; merge base `86b6396573d1c0ef39a58a74d3b8d5310e5cc37b`, 32 remote-only commits (including merges). This is divergent history, not 32 patches safe to apply in order.

This change owns ONLY this document. No product changes, adapter implementation, deployment, migration, credential/configuration-value inspection, DB connection or provider call is authorized here. Existing untracked local previews are outside scope.

**Release gate: preserving the known WhatsApp operational contract requires a human decision.** A working website or passing package tests does not establish Wilson parity. User intent is preservation of functions, not implicit permission to remove them. Do not publish claiming parity, silently disable commands, or reinterpret a WhatsApp confirmation as consent to a different operation.

Main reports that the package source-overwrite issue is closed with five passing tests and that deprecated static `build-hosting` will be disabled without data writes. Main also owns RLS / atomic migration work. These are separately owned updates, not reverified or certified by this audit. The earlier package-source-overwrite finding must not be presented as still open on the strength of this baseline alone; conversely its closure does not close this WhatsApp decision gate.

## Concrete remote capabilities and local gaps

| Remote capability | Exact missing / changed contract at local baseline | Compatibility and disposition |
| --- | --- | --- |
| `984f480`: create editing linked to recorded material of a partial visit | Missing exported `validateWilsonProductionLink(task, source)`; `buildWilsonTask` does not normalize `tarea_origen_id` into `tarea_padre_id`; `findWilsonDuplicates` lacks `{ verifiedSourceId }`; creation does not persist that parent or `origen_visita_parcial_id`; `notificar_asignacion:false` is not supported by the current closed intent. | P1 if preservation is required. Local `canonicalTaskOperationIntent` rejects these extra fields, so the old payload cannot simply be sent to HEAD. Extend the canonical contract only after approval. |
| Same linked-editing patch: duplicate and race behavior | Remote validates same client/workspace/material, editing destination and recorded count >=1; excludes only the verified source from duplicates, removes the 100-row cap for linked candidates, locks client/source, and disallows duplicate override for linked creation. | Preserve the intent, not the SQL wholesale. An aggregate count proves no specific canonical video identity. Do not exempt all same-material tasks or leak foreign-task duplicate details. Remote helper does not explicitly reject trash in its source predicate; the adapted contract must. |
| `d80b665`: private completion in three steps | Missing `POST /tareas/resolver-finalizacion`, `POST /lotes/finalizacion/previsualizar`, `POST /lotes/finalizacion/confirmar`; missing CLI `resolve-finalization`, `preview-finalization`, `confirm-finalization` in `backend/scripts/mia_render_os_task.py`. | P1 functional loss for callers using these commands. Existing revision-batch routes are NOT completion aliases. |
| Remote completion semantics | Remote resolves pending/in-progress/in-review tasks, previews a batch, gives a 15-minute token, then writes task `publicada`, completion metadata/audit and calls `publishPieceLinkedToCompletedTask`. Membership checks use display names. | Incompatible verbatim. Local roles/approval, ID membership, current identity, task revisions and production readiness must prevail. Restoring the transport cannot silently restore bypass of approval or editorial publication side effects. |
| `433c2f3`: audited production count correction via WhatsApp | Missing Wilson `PATCH /tareas/:id/produccion/registros/:recordId` and CLI `correct-production`. Local web route of the same suffix and `correctProductionRecord` exist. | P2 transport gap; web is an alternative, not parity. Reuse canonical correction, actor ID, revision and mixed-registry boundaries if later ported. Explicitly disclose deferral. |
| `00aa528` / `c4bca25` / backfill history: leader editing audit | Missing Wilson `GET /auditoria-edicion`. Final remote version reads active `progreso_edicion_entregas`, specifically editor key `luciano`, by Argentina delivery month; returns `finalizadas_registradas`, `en_revision_actuales`, `total_operativo`, `entregas`, `revisiones`. | P2 gap. Local deployed-history recognition of 050–052 is not an implementation of this endpoint or proof of ledger availability. Do not replace it with current-task counts or conflate operational progress with paid deliveries. |

Remote symbols/locations are available directly through `git show 43f0270:backend/src/wilson-integration.js`: `validateWilsonProductionLink` near625; finalization routes near1231/1255/1333; editing audit near1602; production correction near1920. These are remote-blob references, not line numbers in the local file.

## New canonical behavior that must not regress

- Identity / ACL: `backend/src/wilson-integration.js` — `requireWilsonService`, `resolveWilsonUser`, `reviewTaskOwnedBy`, `lockTaskOperationActor`, `prepareWilsonTaskOperation`, review preview/confirm routes. External identities resolve to one active linked user; membership is by ID, not a historical name. Keep signature-v2 exact-target protection, current-role revalidation, receipts and replay authorization. A transport label or cached leader flag grants no privilege.
- Closed mutations: `backend/src/task-operation-receipts.js:15` — `canonicalTaskOperationIntent`; extra parent/notification fields currently fail closed. Any approved extension must bind its normalized business fields into preview, confirmation hash, selections and idempotency behavior; not only add an INSERT column.
- Task versus publication: `backend/src/workflow-contract.js:40` — `taskTransitionError`; non-production finalization requires approved work and admin/community authority; production has separate role/readiness rules. Historical task `publicada` is a task-read alias, never editorial publication evidence. `backend/src/piece-task-linking.js:31` intentionally makes completion-to-publication a no-op.
- Per-video editing: `backend/src/production-registry.js:319` — existing dispatch accepts `expected_revision`, explicit `editor_id` and `fecha_entrega`, with canonical lineage checks. A partial visit may provide a recorded video without declaring the whole visit completed. Do not create an aggregate sibling that competes with its video-linked editing task. `backend/src/production-editing-adoption.js` governs explicit historical adoption, not automatic reinterpretation of arbitrary `tarea_padre_id`.
- Production finalization: `backend/src/production-task-finalization.js:25` — `assertProductionTaskFinalization`; canonical visit ID/revision and recorded video readiness are distinct from legacy aggregate progress. Completion never confirms a visit, creates editing or publishes.
- `8710f7e` transaction intent is already represented by local Wilson `confirmar-grabacion`: callback receives the same transaction client (`wilson-integration.js:2004`). Do not overwrite this implementation with the remote file. Likewise `0038d08` separation of review and handoff must remain separated in the new per-video workflow.
- `35ba86d` recording regardless of visit state cannot be copied literally: local legacy recording rejects terminated visits, and canonical corrections/reopening have explicit authority and evidence rules.

Other remote dashboard, monthly-goal-link and September report-closure commits are not Wilson transport parity. Defer their old implementations explicitly; no wholesale replacement of newer canonical goal/report/home modules and no historical data replay. DB recovery code is also not safe to wholesale-port over fail-closed startup policy. This document is not acceptance evidence for every UI feature in those commits.

## Proposed temporary adapter: canonical web handoff, NOT false parity

**Proposal only; not implemented.** “CanonicalWebReview” below is a logical handoff to the existing authenticated task/review workflow, not a new endpoint, service or permission bypass.

1. Recognize private finalization intent. Resolve references only within the currently authorized ID-backed scope; reject ambiguity. Group requests continue privately without exposing task details. Do not convert `confirm-finalization` into `confirm-review`.
2. Return explicit status `requires_web_action` (proposed response vocabulary), stable task IDs and safe task links using the existing `/workspace/tareas?task=<positive-id>` route. Use the approved application origin, never a caller-supplied host. No token, credential or privileged bearer data in a link. Do not invent a batch-selection URL contract.
3. Tell the user: “No finalicé ninguna tarea. Abrí la tarea para revisar su estado y completar el paso permitido. Si necesita aprobación, debe revisarla una persona autorizada.” This is navigation assistance, not a successful mutation or a parity claim.
4. The browser authenticates independently. Existing task reads, current actor/role/session checks, ID membership, approval and production evidence govern all subsequent actions. A WhatsApp identity or preview is not a browser session or authority token. Login return must preserve only the supported destination; unauthorized users receive no extra access.
5. Pending / in-progress work may be submitted to review where permitted; review is not approval; approved work may be finalized only by canonical authorized roles. Editing/design staff must not acquire closure authority through the adapter. Show the exact next action instead of promising every requester can finish it personally.
6. The handoff does not mutate task state, editorial state, publication timestamps, production counters, assignments or batch-confirmation records. It must not silently consume an old completion token. Unsupported old tokens receive an explicit unsupported-operation response, never a fabricated completion receipt. Any future adapter logging must be separately specified and must not store credentials.

This preserves an **assisted route to the business outcome**, but loses in-chat resolve/preview/confirm completion and atomic multi-task completion. It also cannot preserve the old “finish my unapproved task immediately” behavior, which conflicts with the new approval contract. Calling this “no loss of capability” would be false. A web review link alone is not an adequate replacement for an authorized approved-task finalization path.

The same honesty applies to partial-visit editing: handoff to existing per-video Producciones can be offered, but does not implement the old WhatsApp linked-create payload or notification-suppression option.

## Human release choice — required, not selected by this document

1. **Preserve supported WhatsApp functions before release:** implement adapted three-step completion and linked editing on canonical contracts; obtain explicit agreement on changed approval semantics; pass the tests below. This best matches the stated preservation intent. No authority is inferred to implement now.
2. **Explicitly accept temporary web handoff:** authorize the adapter and record known losses (in-chat/batch completion, linked-create payload, and deferred correction/audit commands), owner and restoration milestone. Release notes and agent instructions must disclose them. Silence or acceptance of package fixes is not acceptance of this option.
3. **Hold release** until a choice is made if functional loss is not authorized. Main should request that authority; neither packaging nor migration success overrides this gate.

Severity: P1 for missing required operational capability or misleading success/parity; P1 for any ACL/approval/publication regression; P2 for expressly accepted transport/report deferrals. Severity does not mean the missing endpoints should be copied blindly.

## Verification performed and still required

Executed during the source audit: `node --test` with exactly these four files; **52 tests passed, 0 failed, 0 skipped**:

- `backend/test/workflow-contract.test.js`
- `backend/test/production-record-updates.test.js`
- `backend/test/wilson-web-production-authority.test.js`
- `backend/test/wilson-review-preview-authority.test.js`

Scope: pure contract/correction tests and actual registered callbacks with memory-only transaction/identity fixtures. No HTTP listener, configured DB, provider, browser or credentials. These demonstrate existing safeguards, NOT missing finalization/linked-create parity, physical locking behavior, deployment readiness or adapter acceptance. This documentation-only change does not renew a full test run. Main's five package tests are a separate reported result.

Before claiming an implemented adapter safe: test ambiguity/foreign-task privacy; private/group boundary; safe links and login return; revoked/ambiguous identity; ID reassignment/current-role changes; pending/in-review/approved/finalized states; authorized versus unauthorized web closure; production observed readiness; no state/publication/token mutation on handoff; no success wording; old CLI response handling; and notification/agent instructions that do not claim completion.

Before claiming restored mutation parity: test preview/confirm binding of actor, IDs, revisions and exact intent; role/membership revocation after preview; TTL checked after waits; replay/lost response and concurrent confirmation; deterministic lock order and rollback of all batch effects; no approval bypass; no editorial publication effects; partial visit with a recorded canonical video; one editing task per video; cross-client/material/trash rejection; source/counter preservation; duplicates beyond100 and concurrent creates; authorization-safe duplicate DTOs; explicit editor/date; and deliberate notification behavior. Run concurrency/upgrade tests only in a separately authorized disposable/restored fixture, never a configured production DB.

## Packaging / environment boundary

Baseline findings: deprecated `scripts/build-hosting.sh` replaces root outputs and assumes a separate API origin, incompatible with canonical same-origin browser sessions (`frontend/src/main.jsx:13`). Baseline `scripts/build-hostinger-output.mjs` removes its output and copies preexisting `frontend/dist`; presence/timestamp of dist proves no commit provenance. Keep `shared/`, which the older remote packager omits. Main reports a replacement package contract and static-script disablement; verify its final tests/artifact separately, without reopening product files here.

Required release evidence remains: isolated output, exact source commit/hash manifest, coordinated frontend/backend, no local-preview bundle, same-origin browser/session behavior, and declared public build-time configuration source. Vite consumes build-time public configuration; backend runtime configuration cannot repair a stale embedded frontend value. No `.env` values, secrets, process credentials, network accounts or target services were read for this audit. No production approval is granted by this document.
