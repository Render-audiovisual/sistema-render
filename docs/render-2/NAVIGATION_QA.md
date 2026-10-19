# Principal navigation integration — 2026-10-19

## Scope and contract

One presentation model, `frontend/src/components/navigation.js`, drives the principal Sidebar. Groups: Mi espacio, Operación, Contenido, Recursos y seguimiento, Cuenta. Existing real destinations only; Feedback is restored to navigation, Calendario exposes the existing admin alias, and finance/user administration remains exact-admin only. This model is not an authorization mechanism; no App or API permissions were expanded. Employees continue to use calendar functions within the existing content modules. Unknown roles never receive administrative links.

`isNavigationActive` is exact, not prefix-based. Historical notes and story-structure aliases highlight their canonical destination. Real anchors preserve modifier-clicks and browser navigation. Each group is labelled; the current destination uses aria-current. Closed mobile drawers are inert/aria-hidden at the actual legacy 980px breakpoint; open-menu keyboard navigation cycles within navigation controls, Escape closes and returns focus. Viewport and path changes close the drawer. Long menus scroll without visible scrollbar, while account controls remain outside that scrolling region.

Scoped Sidebar.css establishes soft gray, white, blue selection and system typography without changing legacy module tokens or copying preview logic. It does not complete the overall design-system migration or remove duplicated historical CSS. No business data or session persistence was added.

## Ownership and execution evidence

- Coordinator: navigation model, Sidebar, scoped styles, integration and actual browser verification.
- Herschel: twelve independent model/source tests and updates to three existing backend source-contract tests, now asserting real model destinations/role restrictions rather than the old inline object layout. Other business assertions retained.
- Darwin: read-only route/permission/discoverability review. Confirmed missing Feedback; identified client-management discovery and calendar-alias inconsistencies as follow-up items.
- Superpowers guided bounded scope and verification; Frontend Design guided the explicit quiet palette, grouping and scannable labels. No additional design application or local operational store introduced.

Coordinator ran backend pure suite: 976 tests, **955 pass / 21 opt-in skip / 0 fail**. Frontend pages plus navigation: **164 pass / 0 fail**. Production-mode frontend build passed with111 modules. Diff-check passed. No new backend implementation or schema changes; fourteen-suite HTTP regression from the preceding project block is historical evidence, not rerun/certified for this navigation block.

Actual built principal browser: first fresh guarded PostgreSQL fixture `UDgYoG`, synthetic admin login, grouped navigation/current link, project route and direct reload, 1200px document without horizontal overflow. After the mobile fix/build, restarted a new fixture `CcZQsx` (server snapshots index HTML at startup, so reload alone does not select the new build). Synthetic employee login at390px: no finance/users/calendar alias links, closed drawer has inert and aria-hidden=true, open menu loops Tab from last control to first, Escape returns focus to menu button. Feedback link loads the actual connected page, closes drawer; Back returns Inicio. Document width390px. Desktop viewport reset before final screenshot/cleanup.

Screenshots: `/private/tmp/render2-navigation-desktop.png` and `/private/tmp/render2-navigation-mobile.png`. Browser tab closed. Both owned fixtures stopped and removed; initial sandbox-denied initdb attempt `LNadpE` also cleaned automatically. Exact root absence verified for all three. Only disposable synthetic data removed; no real DB/account, production environment, migration target, external Drive flow or deployment used.

## Remaining gates

This is local implemented/verified navigation progress, not full master or phase completion. Desktop collapse, route/query-aware shared context (notably `/clientes?gestion=1`), admin client-management discoverability, employee calendar alias normalization, global shared controls/module palettes, modal/screen-reader accessibility beyond the tested keyboard behavior, and comprehensive all-route/role browser coverage remain. Old preview/sandbox and preexisting App/Vite edits remain untouched. Deployment still requires the earlier schema/identity/staging gates and explicit authorization.
