# Integration143 — investigate mobile title and finish clear-filter QA

Local verification against accepted build `index-6JKbWIRt.js`, commit
`c6e7c33`. No application, schema, dependency or environment changes.

Main browser QA, Beauvoir independent shell CSS review, Poincare independent
manual drag handler review. Apple UI guidance applied as a verification
criterion, not a reason to add a new style layer.

## Mobile title: suspected defect not reproduced

At390x844, scrollY0, actual sidebar bottom64 and Tareas h1 top95, including
after reload. The fixed64px sidebar has a main padding compensation already.
The previous full-page screenshot is not proof of initial title overlap.
Do not add another padding offset based on that screenshot. Correct initial
viewport image: `/private/tmp/render2-mobile143-initial.jpg`.

## Clear-filter return now accepted

Owner cookie login, three synthetic tasks. Select responsible id91003:
only Video remains. Click actual Limpiar filtros and wait for Dirección:
all three Dirección, Diseño, Video return. URL removes responsible, retaining
sort=manual and view=list. Full reload and explicit visible-row wait preserve
all three rows. This closes the missing return-of-results observation in142.

## Native ordering still unresolved

Desktop1440x1000 manual board fully loaded, enabled order controls. Read-only
DOM measured Video card1 at y792..969, source handle x441..466/y804..829;
Dirección card3 at y425..602. Native drag453,817→376,480 did not yield a
confirmed order change. No injected events, fake DataTransfer or transport.
Source review cannot justify a product patch: same-column distinct-card
handler dispatches the expected callback under its guards. Dropping over the
Al final button is not a column-end target; dropping over self is consumed.
Neither is asserted to explain this attempt. Do not substitute JS-handler
tests or arrow success for native drag acceptance. Next investigation needs
bounded observation of the actual drag lifecycle, without the previously
stalled debugger-breakpoint approach.

## Safety and result

Fresh generated fixture uhhf8o, PostgreSQL55795/HTTP52781, API-seeded data
only. Final SQL: three tasks revision1/pendiente, original priorities and
assignments, no business mutations from browser. Exit0/cleanup marker and
root absence confirmed; tab122 closed and viewport reset. Only own disposable
database/data removed. Log `/private/tmp/render2-mobile143-native.log`.
No new automated suite/build run or broader acceptance claimed. No real
accounts, configured/commercial database, production writes, push or deploy.
Goal remains active; broader integration and release gates remain.
