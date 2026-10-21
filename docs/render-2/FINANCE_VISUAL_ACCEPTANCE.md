# Finance visual acceptance — integration112

## Scope and implementation

Canonical `/sueldos`, existing React/Express/PostgreSQL application. Not DesignPreview or sandbox. Existing Finance rules in `styles.css` are replaced in place; no appended theme, global `!important`, new design token, font dependency or parallel implementation. Metric inline presentation in `Sueldos.jsx` becomes scoped semantic classes. Calculations, conditions, API requests, identity checks, editor state and payment records are unchanged.

White/soft-gray surfaces, dark readable text, existing blue accent/focus and semantic success/warning/error colors replace the old dark/neon hero, chart and financial controls. Hero amount is44px desktop and28–32px mobile; body14px, supporting labels12px. Full numbers remain available; no ellipsis or clipped value is introduced.

## Native geometry

Final production build `index-XUu_TaUb.js`, served by a fresh owned local fixture using synthetic `qa_franco`. The previously observed1280px overflow was real: the income card had client223px/scroll234px. It is corrected by two columns through1400px and value wrapping/min-width handling; the700px single-column breakpoint remains.

| Viewport | Actual metric columns | Card widths | Horizontal result |
| --- | --- | --- | --- |
| 1440px | 4 | 261.703px | document1440px; all cards scrollWidth≤clientWidth |
| 1280px | 2 | 463.805px | document1280px; all cards client/scroll462px |
| 390px | 1 | 342px | document390px; no overflowing cards |
| 320px | 1 | 272px | document320px; no overflowing cards or controls beyond viewport |

Actual values retained: projected result7,365,700.00; expected income10,100,000.00; calculated salaries2,335,000.00; planned fixed expenses399,300.00. These are migration-seeded fixture projections, not newly verified bank movements or a live production balance.

## Computed contrast

Measurements resolve actual computed foreground and opaque ancestor background, not token names alone. Final mobile colors match the measured desktop pairs exactly; gradients are `none` for the measured elements. This is a bounded sample, not a site-wide accessibility certification.

| Element | Contrast ratio |
| --- | --- |
| Hero blue label / white | 5.34:1 |
| Hero muted date/body / white | 5.36:1 |
| Hero amount / white | 16.83:1 |
| Hero badge / soft surface | 7.20:1 |
| Positive metric / soft surface | 5.73:1 |
| Negative metric / white | 6.57:1 |
| Expected-income metric / white | 5.24:1 |
| Normal chart bar / white | 4.51:1 |
| Current chart bar / white | 5.34:1 |
| Disabled contract primary label / its surface | 4.70:1 |

Native keyboard Tab reaches the amount input with `:focus-visible`, blue2px outline and existing3px focus shadow. Actual height44px; cent step remains0.01. No input value was changed and no POST was submitted in this visual fixture. Unrendered legacy footer and error/loading variants have source/render regression coverage, not invented native computed measurements. Hover is not claimed as natively exercised.

## Unsaved-navigation investigation

A temporary local-only diagnostic captured **only** aggregate dirty/busy/guard count and the confirmation result. In the real mounted payment editor it observed:

```json
{"phase":"confirmed","dirty":true,"busy":false,"result":true,"guards":2}
```

Thus the guard was registered, detected the draft, called `window.confirm`, and the runtime returned true before navigation. This contradicts the hypothesis that no guard was installed. It does **not** prove that a person saw the dialog or chose a button. A separate visible-tab attempt also exposed no controllable JS dialog. Automatic handling by the browser bridge remains a hypothesis, not a confirmed platform diagnosis.

Temporary diagnostic source was removed exactly; `unsaved.js` has no delta against111. The normal final bundle contains neither its data attribute nor build flag. No diagnostic bypass or new confirmation protocol ships. Unit/actual-getter protocol tests prove confirm=false cancellation and pending blocking; mounted native **Cancel preservation remains unverified**, as do the stated limits of noncancelable traversals/unload. Do not substitute those tests for a native Cancel journey.

## Evidence and safety

- New `frontend/src/pages/finance-light-theme.test.js`: six focused source/actual-JSX-render tests; not screenshot tests.
- Final full backend1730 pass/97 opt-in skips/0 fail; frontend1558 pass/1 opt-in skip/0 fail. Paths in STATUS.md identify exact logs.
- `/private/tmp/render2-finance112-desktop-final.png`
- `/private/tmp/render2-finance112-mobile-final.png`
- `/private/tmp/render2-finance112-focus-final.png`
- `/private/tmp/render2-navigation112-confirm-observation.json` — diagnostic observation, not Cancel acceptance.

All three owned fixtures were cleaned and their temporary tabs closed; viewport and visibility restored. Fixture inspection showed zero payment rows/events/receipts, tasks or publications. No migration112, configured database writes, actual payments, provider writes or deployment. Cumulative migrations through081 still require an approved target/plan and backup/restore before any rollout. Other sectors and full role/cross-device/drag acceptance remain outside this bounded visual certification.
