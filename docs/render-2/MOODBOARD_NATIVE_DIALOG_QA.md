# Moodboard dialog integration — local QA398

## Scope

Coordinator owns MoodboardPreview.jsx/CSS; Harvey owns moodboardDialog.test.js; Hilbert supplied the disposable observation harness. Shared Modal, backend authorization and business persistence were not changed. Superpowers and Web Design Guidelines guided keyboard/focus and mobile checks.

Composer, category editor and reference detail now use the existing shared native Modal kernel, named close controls, guarded Escape and explicit return-focus refs. Cards support Space and Enter. Existing dirty/recovery guards remain authoritative. Native overlay offsets are scoped to the viewport; content scroll is contained.

## Evidence and corrections

- Initial build Cs1K7kjd: native desktop Composer Escape returned focus to its launcher; category Shift+Tab wrapped to Save; Space opened reference. At 390×844, reference and Composer fit the viewport. Native opening exposed a real bug: hydration disabled the initial close button, leaving focus on the hidden backdrop.
- Corrected reference initial focus to its always-focusable aside. Restarted fixture because the running server retained its startup HTML; a reload alone still loaded the prior bundle. Second fixture DOM matched UZz1SxEP. Space then focused moodboard-detail-panel; Escape returned to its card. Category Escape returned to its launcher; its initial focus exposed the same hydration problem.
- Final category correction focuses its always-focusable section, without weakening close locks. Final build DsQhcakF succeeds. This last category variant still needs a native browser rerun; do not call the entire final build browser-accepted.
- New AST test initially failed because its evaluation scope omitted writeState; corrected test setup, not product guards. Automated checks are not substitutes for native focus proof.
- Observation fixture checked JSON/xmin/ctid invariance across all 109 public tables three times after native login. No save, external Pinterest navigation, upload or provider request occurred. Both disposable roots iHW96w and HczKIQ were cleaned with ENOENT confirmation. Chrome viewport reset and owned tab closed.

## Follow-up QA399 — final build native confirmation

Reused the same inspected disposable harness with a new cluster, not the prior dataset. Startup and actual Chrome script both matched index-DsQhcakF.js. At desktop1280×900, opening Categories focused moodboard-category-modal; Shift+Tab from Close wrapped to Save and Tab returned to Close. Escape removed the dialog and restored Editar categorías. At320×740 the panel bounds were x8..312/y83..721, document scrollWidth320; focus remained the panel. Screenshot /private/tmp/render2-goal399-categories-mobile.jpg inspected visually. Following a reload, Enter opened reference with focus on moodboard-detail-panel; Composer focused Cerrar referencia and fit x8..312/y72..732. Both clean Escape paths restored their invokers.

Three post-login physical checks preserved all109 table hashes including xmin/ctid. Runner printed FINAL_OK and cleanup ENOENT for /private/tmp/render2-local-Fm5qmn, terminal0. Chrome temporary viewport reset and owned tab closed. This closes the final Categories native-focus gap only, not dirty-confirm/upload/all-role/screen-reader acceptance. No new product changes or build in399.

## Limits

Native upload/FileReader acceptance remains pending due the previously documented browser permission limitation. Real dirty confirm, screen reader, zoom and all-role acceptance were not performed here. No production changes or deployment; the broader Render 2 rescue remains incomplete.

Evidence logs: /private/tmp/render2-goal398-focal-initial.log (125 pass); /private/tmp/render2-goal398-dialog-green-final.log; /private/tmp/render2-goal398-frontend-final3.log; /private/tmp/render2-goal398-build-final2.log. Earlier failed runs are retained separately. Mobile screenshot /private/tmp/render2-goal398-mobile.jpg shows the second build, not the final category correction.
