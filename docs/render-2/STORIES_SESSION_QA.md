# Integration 78 — stories session adoption and safe flyer conversion

## Scope and ownership

Coordinator: integration/compatibility, surgical story server fixes, new conversion helper and real HTTP/PostgreSQL checks. Carson: Historias.jsx and adjacent session tests. Hypatia: contract review and conversion unit tests. Beauvoir: independent frozen-source review. Existing user App20+/1-, Vite5+ and untracked reference files excluded. Global cookie activation stays off; objective remains active.

## Server corrections

Story PATCH accepts empty strings for idea/copy/material/notes so users can actually clear text; malformed text types rejected before UPDATE. Omitted/null fields retain existing COALESCE behavior. Existing role gates, evidence guards and date rules retained.

Old flyer conversion performed separate SELECT/INSERT/DELETE, potentially duplicating stories or cascading linked task deletion. New `convertUnlinkedFlyer` locks source FOR UPDATE and wraps all steps in one transaction. A publication with tasks/goals/production/dispatch/editorial events, historical published state or real publication date is rejected409 without writes. Only unlinked/unconfirmed flyers convert, retaining work state/common fields plus a full source snapshot in DB metadata. Conversion ACK uses closed selected operational fields, not snapshot/metadata. Existing employee story serialization omits unknown snapshot keys; admin projection unchanged. This is not historical linked-data migration.

## Initial physical evidence

Disposable actual principal HTTP/PostgreSQL proves stable responsible assignment in tarea_asignaciones, story/date/metadata persistence across users, clearing text, invalid body/employee write rejection, weekly planning/check independent from real publication evidence, one conversion under two simultaneous owners, linked/historical retention and rollback when a synthetic BEFORE DELETE trigger fails after INSERT. No configured database/provider/commercial rows touched. An initial test queried nonexistent tareas.asignado_a_id; corrected to real assignment relation rather than changing schema.

## Remaining boundaries

No new schema/dependency/environment, push or production deployment. Role permissions are not broadened. Generic piece-creation idempotency after uncertain transport, cross-device editorial cell concurrency, linked flyer reconciliation, complete draft/navigation recovery, native cookie/proxy/crash/provider acceptance and full design/unification remain gates. No automatic publication or historical proof reinterpretation.

## Final integration evidence

Historias uses the canonical parsed API client with captured real session/context observations; stale reads, queued writes and continuations cannot apply under a replacement context. Per-cell queues preserve A→B→A intent. Creation/duplication requires an explicit user ID from the server catalog. Partial metadata failure reports the created ID without retrying creation. Daily planning checks remain separate from publication evidence. The existing planilla is reachable through “Editar historias” and survives direct URL/reload.

Actual browser testing found and corrected two defects: unknown persisted responsible labels displayed the legacy first option; new-row autofocus reran on every copy edit, interrupting input. The final build preserves the actual label, consumes focus once per row/context, and cancels pending focus on cleanup. Beauvoir independently reviewed both fixes without new P1/P2 findings.

Final results: frontend 791 passed, zero failed/skipped; backend 1381 passed, 58 explicitly opt-in skips, zero failed; five sequential actual HTTP/PostgreSQL suites 47 passed, zero failed/skipped; production build passed. Logs: `/private/tmp/render2-stories78-frontend-final.log`, `/private/tmp/render2-stories78-backend-final.log`, `/private/tmp/render2-stories78-http-final.log`, `/private/tmp/render2-stories78-build-final.log`.

Final browser fixture: synthetic Franco login → Historias → Editar historias → choose Designer QA #91004 → create → type “Copy QA78 guardado desde la planilla.” → blur → reload. Actual date 2026-10-20, theme Producto QA78, time 10:30, full copy and Designer QA persisted; publication remains unconfirmed. At 390×844 the document clientWidth/scrollWidth are both390. This is bounded responsive evidence, not full mobile acceptance. Evidence screenshots: `/private/tmp/render2-stories78-final-desktop.jpg`, `/private/tmp/render2-stories78-final-mobile.jpg`.

Both owned browser fixtures were stopped through their original PTYs; owned tabs closed, viewport reset, generated roots checked absent. No production/configured database, provider or real user data used. Local implementation/tested only; deployment not approved or performed.
