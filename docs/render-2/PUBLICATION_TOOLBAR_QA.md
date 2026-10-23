# Integration146 — contained editorial calendar toolbar

Local development only, previous accepted145 commit5e81e8a. Main owns JSX,
one shared-token selector exclusion, integration/native QA. Poincare owns
existing styles.css rules. Hypatia owns five new AST/SSR/CSS regressions.
Beauvoir reviews selector leakage and Historias separation read-only.

## Implementation and design

145 screenshot showed the calendar refresh button outside the toolbar edge
at1280px. Old grid required fixed minimum widths that exceeded content width.
Existing toolbar/filter rules now wrap; context month stays a coherent group.
Filters have640px preferred basis so the whole group moves beneath month
at1280 instead of leaving refresh isolated below the other controls. Mobile
uses explicit two-column and one-column zero-minimum grids at760/440.

Type now uses the existing FilterSelect, keeping FILTROS, value and original
onChange. Label/ARIA name are explicit. Legacy selector/label/chevron paint
excludes shared classes in place; no extra stylesheet, important layer or
hidden action added. One existing design-system group similarly excludes
the shared type select. Apple/frontend skills guided reuse of shared system
font, blue/white tokens, inward arrow and native control, not a new theme.

Historias has a separate h-toolbar/stories-context structure and its selectors
are unchanged. Source review found no new Historias layout rule; this is not
native visual acceptance or completed shared-control adoption for Historias.

## Verification

- Full frontend2051passed/0failed/0skipped, including five new actual JSX,
  handler, real-component SSR and scoped responsive CSS regressions.
  `/private/tmp/render2-toolbar146-frontend-final.log`.
- Build `index-DAedeNfP.js` passed; `render2-toolbar146-build-final.log`.
  Backend unchanged; no new backend suite acceptance claimed.
- Fresh actual cookie owner app at1280: all seven toolbar button/select
  rectangles inside toolbar. Document width=scrollwidth1280. Type14px/44px.
- Native selection Reels retains145 correct3/1/0/2 summary. Week button opens
  week view, Month restores month; Next opensNovember2026; Today restores
  October2026. Refresh busy/handler contract retained by tests; refresh was
  not clicked, because it can generate scheduled pieces.
- At1024x900 and390x844 every toolbar control rectangle is contained; document
  width equals scrollwidth. MobileType16px/44px, arrow12px inward, label
  ::after content none. Real keyboard ShiftTab from refresh focuses Type
  with2px blue outline/3px offset. Not physical iOS or all-role certification.
- Images `/private/tmp/render2-toolbar146-desktop.jpg`, mobile.jpg. Existing
  Mes/Semana segment targets measure40px; full44px target cleanup for all
  legacy controls remains a separate design gate, not claimed here.

## Safety and remaining work

Initial fixtureu6gDp9 exposed an awkward isolated refresh row. It was cleaned
before final640px-basis build; final fixturesaveDQ confirms improved grouping.
Both own generated PostgreSQL55796/HTTP52782 fixtures exited0, printed cleanup
markers and roots absent. Four pending pieces retain original dates, actual
date null and zero publication events; browser actions did not write content.
Logs `render2-toolbar146-native.log`, `render2-toolbar146-final-native.log`.
Tab125 closed, viewport reset. Only own disposable data removed.

No real account, configured/commercial DB, external provider, production write,
push or deploy. Broader design convergence, native drag gate144, complete
workflow/role/concurrency/device coverage and release audit remain. Goal active.
