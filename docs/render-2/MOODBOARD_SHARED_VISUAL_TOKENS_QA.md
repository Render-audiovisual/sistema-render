# Moodboards shared visual foundation — QA404

## Scope and ownership

Main updates the canonical MoodboardPreview.css in place: shared system font, neutral surfaces, text, borders, radii, shadows and blue actions. Existing brand/Pinterest colors and semantic backgrounds remain. Gallery geometry, media behavior, permissions, API, drafts and native dialog contracts are unchanged. The filename does not indicate a new parallel application: this is the existing canonical /moodboards route.

Harvey independently found low-contrast status counters and outward rail focus clipped by its scroll container. Counters now use render-muted (4.70:1 on muted, 5.36:1 on white); primary action is 5.34:1. Rail buttons keep a 2px outline inset by 2px. Fields retain 44px minimum height; mobile editing fields use 16px. Reduced-motion stops existing spinner animations. Apple UI/frontend-design guidance favors the shared quiet identity, not a new layout.

The proposed sidebar-collapse defect was rejected: existing higher-specificity sidebar CSS already handles the 72px collapsed rail. Root geometry now consumes the shared width variable for consistency, not as evidence of a previously broken collapse.

## Automated evidence

Hilbert owns moodboardVisualTokens.test.js: RED1PASS/5FAIL before patch, final6PASS. Main updates one legacy test's literal border/radius expectation to shared tokens without changing business assertions. Initial focal48PASS/1FAIL is retained; final49PASS/0FAIL/0SKIP in /private/tmp/render2-goal404-focal-final.log. Frontend3324PASS/1opt-inSKIP/0FAIL of3325, terminal0 (/private/tmp/render2-goal404-frontend.log). Build index-BfN1lEwj.js succeeds, terminal0 (/private/tmp/render2-goal404-build.log). No fresh backend/core suite is claimed for this CSS-only integration.

## Native observations and explicit acceptance limit

Disposable fixture iUnIA5, local PostgreSQL55982/HTTP52901, Chrome synthetic qa_franco and actual bundle BfN1lEwj. Desktop1280x900 has shared canvas, blue action, muted counters, width1280 without horizontal overflow. Real sidebar collapse yields width72/root-left72. Keyboard focus on the brand rail is solid2px blue, offset-2px. Inspected screenshot: /private/tmp/render2-goal404-moodboard-desktop.jpg.

At390x844 the clean composer opens as a native dialog focused on Cerrar referencia. Editing fonts16px, input/select44px, textarea98px, document width390. Clean Escape restores focus to Nueva referencia. Inspected screenshot: /private/tmp/render2-goal404-composer-mobile.jpg. First physical check confirms all109 public-table hashes unchanged after login baseline.

The final320px categories/detail tool output was truncated and is NOT accepted evidence. The fixture then expired before its required second/final check: authoritative terminal1 QA398_ABORTED_NO_ACCEPTANCE and QA398_CLEANUP_ENOENT /private/tmp/render2-local-iUnIA5. Thus no FINAL_OK, final database invariance or completed native journey is claimed. Browser inventory is empty and temporary viewport reset. Repeat final native acceptance with a fresh guarded fixture before treating this slice as fully validated.

No upload/FileReader acceptance, dirty-confirm check, real phone/screen reader, external provider, configured/commercial database, real identity provisioning or deployment. Inherited untracked reference files remain untouched. Master consolidation goal remains open.
