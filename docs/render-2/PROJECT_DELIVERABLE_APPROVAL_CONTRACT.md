# Project deliverable approval — integration103

Local canonical React/Express/PostgreSQL implementation. No production migration, configured database, real provider or external file mutation is authorized by this document.

## Business invariant

An approval belongs to the observed title, URL and notes of one saved deliverable at one revision. It is not proof of immutable bytes at an external URL. Editing an approved delivery's content returns it to review and preserves the original approval evidence. Restoring the original text or URL does not restore the old approval. Deliverable approval never finalizes tasks/projects or publishes editorial content.

The existing current project responsible ID or an active administrator may approve; project membership or a matching name grants no approval right. Current database role, active identity/session epoch, project responsibility and archive state are revalidated in the transaction. Existing shared operational project reads remain unchanged.

## Additive database transition

079 adds `contenido_revision`, `entregable_revision` and `aprobacion_actual_id` to `proyecto_entregables`, plus immutable `proyecto_entregable_aprobaciones` receipts. Existing approval actor/time/state remain unchanged and have no new approval pointer: the DTO labels them unversioned historical approvals rather than certifying them retroactively.

The database trigger increments content revision for actual title/URL/notes changes and delivery revision for actual content/state/approval changes. It clears current approval on content changes or leaving approved state. Content edits to an approved delivery become `en_revision`; no-op content does not invalidate evidence. A new approved insert or a new approval without an exact matching receipt fails. The restrictive current-pointer tuple FK binds project, delivery and receipt; old receipt snapshots cannot be updated or deleted. No business rows are backfilled or reassigned.

Generic deliverable POST/PATCH can no longer set `estado:aprobado`. A separate explicit action is required. The server records the actual state returned by the trigger in project activity, including approval invalidation, not the old requested/assumed state.

## Closed API

`POST /api/proyectos/:id/entregables/:child/aprobaciones` accepts exactly:

```
request_id: UUID
expected_revision: positive project revision
expected_entregable_revision: positive observed delivery revision
expected_content_revision: positive observed content revision
expected_content_hash: lowercase SHA-256 of observed title/URL/notes
```

The existing detail DTO adds `contenido_revision`, `entregable_revision`, `contenido_hash`, `aprobacion_actual_id` and `aprobacion_versionada` per deliverable. These are closed operational fields; financial bags and all historical content snapshots are not appended to every project response.

The approval response is `{proyecto,aprobacion,replayed}`. Its bounded receipt contains ID, deliverable ID, content/delivery revisions, content hash, actor ID and approval timestamp. First acceptance returns201. Same current actor/request/body returns200 with the original receipt and CURRENT authorized project detail, without any DML or reapproval. A changed intent using the same request ID returns409. A historical receipt returned after content/state changes is not a claim that its approval is still effective.

The current actor SHARE lock precedes the receipt mutex, project structural domain, project lock and exact child lock. Approval compares project and delivery/content observations after locks, inserts immutable evidence, updates its pointer, increments the parent once and writes activity inside one transaction. Any stale observation or late SQL/audit failure rolls everything back. No external call occurs under these locks.

## Canonical UI and recovery

Projects uses its existing page, forms, routes, light design and task links. The deliverable editor has no selectable approval state. “Revisar y aprobar” opens a separate immutable observation with a required acknowledgment; the form cannot silently adopt a newer version after409. Users close it, inspect the current delivery and open a new review explicitly.

Version/hash/ID validation precedes success. An uncertain approval retains the original UUID and serialized mutation; verification is explicit and identical, never a new automatic intent. Session/source lifetime is captured before asynchronous work, with genuine cookie observations rather than a reconstructed profile.403 purges the denied detail/form and does not offer approval verification. Controlled navigation honors dirty/busy/uncertain state. Forced escapes can still discard memory-only recovery; persisted backend receipts remain.

The read/write response-order regression is separately guarded: an old detail GET must not overwrite a newer mutation ACK. Existing general project create/edit/stage/hito/task-link workflows are retained and regression-tested; no parallel task or approval frontend is introduced.

## Evidence and release limits

The guarded55736 populated-upgrade test proves unchanged historical rows before explicit approval, observes a real child-row lock wait followed by409 after a concurrent URL edit, and proves role/session revocation wins before a waiting actor authority check. Replay cannot reactivate an invalidated approval. The independent55735 principal HTTP/PostgreSQL suite covers content/state ABA, concurrency, exact receipts, late-failure rollback, identity and unchanged task/editorial tables.

See STATUS integration103 for final terminal totals and native desktop/mobile evidence. Fresh-schema fixtures and successful builds are not a populated production upgrade rehearsal. Deployment requires approved database identity/backup/restore/migration and rollout plans, real-account acceptance and explicit authorization. The full Render2 master goal remains open.
