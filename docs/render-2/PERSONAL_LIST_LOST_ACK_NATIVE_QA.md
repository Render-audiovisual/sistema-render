# Mi lista: native recovery after committed creation response is lost — QA402

## Actual journey

Current product build index-QiAl1qiE.js matched startup and Chrome script. Main logged in as synthetic qa_luciano through the real form, then froze a post-login baseline of109 PostgreSQL public tables. A private page/block sentinel belonged to a different fixture user. No real identities, configured database, provider or production data were used.

Native creation of Página vacía sent exactly one POST /api/listas-personales. The fixture HTTP wrapper captured the original URL before Express routing and destroyed the socket in res.end only after the canonical201 path completed. SQL confirmed page2/version1, one creation receipt and mandatory Pendientes section; no block yet. Server counters: pagePosts1/page2011/dropped1/recoveryGets0. UI showed No sabemos si la página se creó and disabled template creation. This is an actual discarded HTTP response after commit, not a UI-only fabricated timeout.

Clicking Verificar creación issued one GET /api/listas-personales/creaciones/:requestId. The same page and receipt returned unchanged; counter pagePosts stayed1, recoveryGets became1. UI opened the recovered page, with the same list ID in /lista?lista=2. Main changed its title to QA402 Página recuperada, added one text block through normal UI and saved QA402 Texto después de recuperar el guardado.

SQL confirmed one page/creation receipt, one block/block receipt and required default section only.104 tables outside those five Mi lista tables retained JSON/xmin/ctid hashes, and all other users' private rows within the allowed tables were physically identical. After390×844 reload, title/text/URL persisted and document scrollWidth390. Screenshots /private/tmp/render2-goal402-uncertain.jpg and /private/tmp/render2-goal402-mobile-recovered.jpg inspected. Counters remained exactly one creation POST, one201 drop and one recovery GET through finish.

Native runner reported FINAL_OK, parent terminal0 and cleanup ENOENT /private/tmp/render2-local-KcQE7T. Owned tab closed and viewport reset. No second browser/device or lost attempt across reload before recovery was tested; the existing in-memory creation attempt is not claimed durable across unmount.

## Reproducible local tool and QA safety correction

Archived as backend/scripts/render2-personal-list-native-qa.js with repository-relative imports/root. Build frontend first. From backend: RENDER2_RUN_LOCAL_INTEGRATION=true node scripts/render2-personal-list-native-qa.js. It accepts no target/database overrides. Use only its own READY URL and fixture account. Commands: baseline after native login; checkdropped after first lost201; checkverified after clicking verification; checkblock after title/block save and reload; finish. abort discards the own fixture without acceptance. Static build hashes must stay unchanged during QA. Fixed own ports55985/52903;15minute abort timer.

Harvey's independent review found a bug in the temporary runner's cleanup: a synchronous stop-message error could skip f.cleanup, and FINAL_OK preceded child-exit validation. This did not occur in the native run: its fixture actually disappeared with ENOENT. Main's archived version always enters nested cleanup, handles disconnected IPC via owned-child SIGTERM, bounds stop with SIGKILL fallback, requires clean child exit for acceptance and prints success only after cleanup. Persistent child error handling prevents unhandled IPC error events. No foreign process/segment is addressed. No product cleanup behavior changed.

Five extracted-real-finish callback tests went RED1PASS/4FAIL to GREEN5PASS with synthetic child/filesystem doubles. The tracked test additionally checks CLI missing opt-in and target-argument denial before fixture startup:6PASS (/private/tmp/render2-goal402-tracked-cleanup-final2.log). These are safety unit tests, not actual process-failure injection. Archived tool startup/abort smoke confirmed terminal0 and cleanup ENOENT /private/tmp/render2-local-Axkqpc; it deliberately printed ABORTED_NO_ACCEPTANCE. That smoke is not a second successful business journey. The final added error-event handler is unit/source-reviewed, not an actual IPC-failure smoke.

Final backend regression2688PASS/178opt-inSKIP/0FAIL of2866,14.19s terminal0 (/private/tmp/render2-goal402-backend-final.log). No new frontend build/suite or full physical cohort is claimed in402; unchanged product build is the one observed natively above. PostgreSQL transaction guidance preserves committed writes while transport fails outside the transaction.

## Coordination and limits

Main owns fixture implementation, native browser and integration; Hilbert verified routes and receipt contract before Main took over implementation; Harvey independently reviewed cleanup and wrote its regressions. Superpowers kept commit evidence, UI uncertainty and recovery separate. No commercial code/schema/dependency/frontend build changes in402, no deployment or external messages. Native upload, reviewer policy371, real roster/provisioning, authorized migration rehearsal and global visual/device/role acceptance remain open. No global completion claim.
