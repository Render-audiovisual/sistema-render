# Personal Home shared visual foundation — QA403

## Product scope

QuickHome.css replaces its six private palette constants with existing render surface/soft/line/ink/muted/accent tokens. System font comes from render-font; canvas and white card surfaces now match the canonical shell. Controls/cards use shared8px/12px radii; overdue uses render-danger. Font sizes, paddings, grids, responsive breakpoints,44px targets, task ordering and all JSX/queries/permissions remain unchanged. No new typography download, business component or parallel preview.

The work serves Render agency staff's next-action dashboard, not a marketing hero. Apple UI/frontend-design guidance favors quiet hierarchy, system typography, existing light tokens and restraint; the wider desktop work layout is intentionally retained. Superpowers separates pure CSS contracts, native observations and database evidence.

Independent review also found that full-width Home links' outward focus could be clipped by overflow-hidden cards. Task/compact/section links now keep the existing3px outline but offset it inward by3px. Other controls keep their existing outward focus. Overflow clipping and layout are not removed as a workaround.

## Tests and native evidence

Hilbert owns homeVisualTokens.test.js. Before token patch:1PASS/4FAIL. After adoption:5PASS. Added focus guard before its patch:5PASS/1FAIL, final6PASS. Foundation/contrast focal11PASS (/private/tmp/render2-goal403-tokens-final.log); resolver checks actual shared colors for normal-text4.5:1 on white/soft surfaces, not every component/state. Read-only functional Home review found no P1/P2,51 pure checks pass: server Cordoba today, effective states and deadline/priority ordering already match UI. No functional policy was invented.

First guarded native fixture xKCnRx served index-gC5Ewmi9.js, matched in actual Chrome. qa_luciano login and post-login109-table baseline; task setup contains one overdue, two due today with different priorities, one future review, one undated, one own final task and one foreign task. Home's next-work list shows exactly IDs1..5 in that order, omitting6/7 from that list; activity correctly may include own finalized6. Summary5open/1overdue/2today/1upcoming/1undated/1review and monthly1/6 match setup. Desktop1280×900 computed canvas245/245/247, cardwhite, radius12, refresh44px/radius8 and shared system font. Mobile320×844 reload preserves list order and width320/scroll320.109 hashes remain unchanged; FINAL_OK/terminal0/cleanup ENOENT xKCnRx.

After focus fix, fresh fixture O6BZlE and DOM both matched final index-DvAcg2vt.js. Native Tab from Actualizar focuses task1 with solid3px shared blue, offset-3px. At320px, Tab to Ver todas mis tareas keeps offset-3px with no horizontal overflow. Final screenshots inspected: /private/tmp/render2-goal403-home-desktop-final.jpg and /private/tmp/render2-goal403-home-mobile-final.jpg.109 JSON/xmin/ctid hashes unchanged; FINAL_OK/terminal0/cleanup ENOENT O6BZlE. Both owned tabs closed and viewport reset. A synthetic editor viewport is not all roles, a physical phone, screen reader or global visual acceptance.

Frontend final3318PASS/1opt-inSKIP/0FAIL of3319, terminal0 (/private/tmp/render2-goal403-frontend-final.log), final build DvAcg2vt succeeds. No backend business implementation/schema/identity change or physical core renewal; previous401 core358 is historical, not rerun403.

## Independent QA-tool correction

Harvey identified a residual failure in the402 manual fixture tool: if final checkBlock throws, the child stop inside try was skipped, even though f.cleanup ran. That child is independent of the harness cluster's normal children. Main moved stop/exit validation into finally, before unconditional nested fixture cleanup; accepted remains false on any validation/stop/cleanup failure.

Two actual-finish tests inject checkBlock failure under connected/disconnected IPC: RED6PASS/2FAIL, final8PASS (/private/tmp/render2-goal403-cleanup-green.log). Actual negative smoke deliberately calls finish before any native baseline: expected assertion/terminal1, no FINAL_OK, cleanup ENOENT xxtGVO. Subsequent exact loopback probes: HTTP52903 connection refused and PostgreSQL55985 no response. No foreign process/cluster was addressed. This is successful cleanup of a deliberately rejected QA run, not a failed commercial journey or a second accepted402 recovery.

Backend final2690PASS/178opt-inSKIP/0FAIL of2868,20.27s terminal0 (/private/tmp/render2-goal403-backend-final.log). Main owns CSS/tool integration and native QA; Hilbert new Home contracts; Harvey independent focus/cleanup findings and cleanup tests. Existing nonversioned references preserved. No provider, real account, configured/commercial database, push or deployment. Master goal remains open.
