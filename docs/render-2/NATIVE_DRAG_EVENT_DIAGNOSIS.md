# Integration144 — locate native drag cancellation before application drop

## Scope and approach

Continue143 pending native order acceptance. Main instrumented the actual
TaskCard start/over/end and TasksView before/column drop callbacks temporarily.
Poincare independently reviewed the effect/handler contract. No debugger
breakpoints, injected browser events, synthetic DataTransfer, mocked browser
transport, production service or configured database used.

Local generated fixtures and API-seeded three-task dataset only; owner cookie
login. Desktop1440x1000, actual compiled app, loaded manual-order controls.
All temporary diagnostic statements and the unsuccessful candidate were
removed using precise patches; final tracked application diff is empty.

## New authoritative evidence

1. Source2 dragstart: canDrag=true, moveBlocked=false, pointer blocked=false.
2. Target3 receives dragover. Actual transported types are
   `["chromium/x-drag-id","text/task-id"]`; dropEffect reads move.
   The original handler therefore executes preventDefault.
3. No TaskCard before-drop or column-drop callback is delivered. Dragend
   reports dropEffect=none. The application order model is never reached.
4. Controlled candidate explicitly sets dropEffect=move in card dragover:
   same target over and cancelled end, still no drop. Candidate removed;
   it is not a validated fix.
5. Cross-column control from card2 to the empty En proceso lane ALSO ends
   none with no column-drop callback in this session. Consequently current
   evidence does not isolate a same-column-only product defect. Earlier138
   cross-column success remains historical evidence, not repeated acceptance.

Events with timestamps and exact diagnostic bundle names:
`/private/tmp/render2-drag144-events.json`. Native viewport image:
`/private/tmp/render2-drag144-control.jpg`.

## Interpretation and next gate

The failure is localized before application drop delivery, not a demonstrated
database/model rejection. Cancellation could still involve the browser,
gesture provider or application/browser interaction; its root cause is not
proven. Do not claim it is definitively a tool defect or definitively solved.
Do not repeat coordinate guesses or the stalled debugger approach. Further
native acceptance needs an input path with confirmed complete drop delivery
and the same start/over/drop/end evidence; then verify reload and SQL order.
Until that is available, proceed with independent master-plan modules rather
than changing the order algorithm or weakening authorization checks.

## Restoration and safety

Four own fixtures nN8sFN, EJWxXA, QMUwPn, Re2diM exited0 and printed cleanup
markers. Every final snapshot preserves all three original tasks at revision1,
pending, original priorities/assignment IDs. No task mutation was dispatched.
Logs `/private/tmp/render2-drag144-debug{,2,3,4}-native.log`.
Tab123 closed, viewport reset, only own disposable clusters/data removed.

Final application source restored exactly to HEAD and normal build restored
to `index-6JKbWIRt.js`, with no diagnostic strings retained in source. Focused
actual-handler/model and manual-order contracts: 22 passed, zero failed or
skipped (`/private/tmp/render2-drag144-contract.log`); they do not prove
native acceptance. No schema/env/dependency change, real account use, external
provider operation, production write, push or deployment. Full Render2 goal
and native drag gate remain open.
