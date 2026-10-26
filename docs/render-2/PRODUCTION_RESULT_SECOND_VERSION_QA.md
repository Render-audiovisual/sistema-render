# Production result lifecycle — local QA400

## Native journey

Started the inspected QA399 runner with explicit integration opt-in, fresh PostgreSQL55983/HTTP52902. Startup and actual Chrome script matched index-DsQhcakF.js. Synthetic qa_franco logged in through the real login form, then a post-login baseline froze109 public-table hashes. No configured database, external material link, Google login or provider was used.

Seeded a task-backed visit with2 videos (1grabado,1pendiente) and2 photo types (Producto realizada, Equipo repetir). The native Registrar resultado button created the first immutable journal at visit revision5→6. Browser showed Resultado parcial/Vigente. SQL recorded result a30ce70a-114b-4f96-ac80-60922bcab0c1 and preserved107 unrelated tables, source task, media and photo IDs.

An explicitly authenticated second fixture actor91002 used the cookie API to change only the pending video's state to grabado, revision6→7. This is a real second-actor server authorization path, not native account switching or two-device acceptance. Actualizar in the native page then showed the video grabbed and the old journal marked Versión anterior. A second explicit native Registrar resultado created journal537cad41-714d-42fa-af75-f85e19e87094, revision7→8, with a distinct request ID. It remains partial because Equipo photos still require repeating.

After reload, both results remained visible as Vigente and Versión anterior; repeat registration was disabled for the current revision. Mobile390×844 document scrollWidth390. Screenshot /private/tmp/render2-goal400-results-mobile.jpg inspected; it belongs to the pre-presentation-fix build. SQL verified original journal JSON/xmin/ctid unchanged, both versions preserve the same media UUIDs, pending script and photo observations, and106 tables outside visit/video/journal physically unchanged. No task finalization, publication or quota change. FINAL_OK, terminal0, cleanup ENOENT for /private/tmp/render2-local-rCXvd4. Owned Chrome tab closed and viewport reset.

## Finding and correction

The native update exposed misleading local success text: status confirmed still displayed Resultado registrado after the visit advanced beyond the acknowledged revision. Admission was correct: a new revision could be explicitly registered and the history labelled the old result correctly. Fix is presentation-only: distinguish current confirmation, older acknowledgement and acknowledgement ahead of the visible visit; keep write model/receipt and existing guards intact. Independent agent reviews and regression results are recorded below when complete. Native confirmation of the revised wording is separate from the successful persistence journey above.

## Final presentation fix and renewal

Product change is confined to ProductionResultRegister.jsx message projection. Equality of accepted revision and visible revision shows current success; an older ACK explicitly says the visit changed; an ahead ACK requests refresh. Verified current registered evidence remains visible even with an old local ACK. The existing greater-or-equal duplicate guard, receipt, model, callbacks and backend are unchanged.

Hilbert's5 actual-component JSX/callback tests produced RED2PASS/3FAIL before Main patch; final5PASS. They do not mount React. Focal30PASS (/private/tmp/render2-goal400-focal.log); full frontend3312PASS/1opt-inSKIP/0FAIL of3313, terminal0 (/private/tmp/render2-goal400-frontend.log); build index-QiAl1qiE.js succeeds (/private/tmp/render2-goal400-build.log). Harvey independently reviewed the delta and found no concrete P1/P2.

Fresh cluster JoIH10 used the corrected build, confirmed in actual Chrome script src. Repeat native first registration produced8ccacda5-b0f2-4cbf-a9c2-d5904a2d761a, revision6. After actor91002 API edit/Actualizar, native text was El resultado anterior quedó registrado. La visita cambió desde ese registro; new registration was enabled, not automatic. Second click created6900974b-7b46-426d-8315-8bd1543f2869 at revision8. After reload history2/current-version registration disabled persisted, document390px/scroll390px. Screenshot /private/tmp/render2-goal400-results-final.jpg inspected. All journal/media/106-table invariants passed again, FINAL_OK/terminal0, cleanup ENOENT /private/tmp/render2-local-JoIH10. Chrome viewport reset and owned tab closed. No claim that state persists between distinct disposable fixtures.

## Remaining acceptance

Main owns native interactions/product integration; Harvey prepared and independently reviewed the frozen runner; Hilbert reviews the confirmation projection and owns regressions. Superpowers separates actual UI/API/database evidence from preparation and assumptions. No deliberate ACK loss, native switching to another account, Reports journey, physical phone or provider acceptance was performed in400. This closes only the second-version persistence journey, not the full master goal.
