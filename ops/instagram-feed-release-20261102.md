# Instagram carousel feed and monthly client controls

## 1. Objective

Apply the supplied carousel git-mail patch on the actual
codex/render-2-release-20261029 production head and publish it with the already
requested, locally verified monthly client editor.

## 2. Source and assumptions

Published parent: c09f4501e113f5c4e5c3b9fef42dce470f51f014. The supplied Saturday
schedule is already present; reverse-apply checks passed for its business logic,
worker and UI. Existing enhanced regression tests and worker security remain.
No duplicate Saturday commit or unrelated compiled Python file is introduced.

## 3. Integration

Isolated branch codex/render-feed-release-20261102. Applied
instagram-carruseles-feed.patch using git am (fd44390a); included the previously
verified client editor (cba61922). Deployment targets the existing release branch
with a normal non-forced fast-forward, not a replacement database or restore.

## 4. Boundaries

Carousel cards use genuine cover URLs, complete escaped captions and real metrics;
unknown is still a dash, not zero. Reels retain their existing design. No external
dependencies, environment updates, migration or new scheduler invocation.
Monthly edits remain owner-ID-only, including legacy edit routes. Actual counts
are audited corrections, not fabricated publications; quota-only saves do not
change fees. See docs/client-monthly-control.md for contracts and limitations.

## 5. Acceptance

Preserve tasks, clients, publications, objectives and automatic Instagram refresh.
Verify current build on Hostinger and compare operational fingerprints after
deployment. Visual verification must not save counts for real clients.

## 6. Tests

Full frontend selected page/component/session suite: 2916 passed, zero failures.
Full backend suite: 3591 passed, 209 explicitly opt-in skipped, zero failures.
14 actual PostgreSQL/cookie integration tests separately enabled and passed,
including shared quotas, owner roles, CSRF, concurrency and automatic weekly sync.
Frontend Vite build passed. The initial restricted-run HTTP bind failures were
rerun with local-listening permission and all passed; no product failure hidden.

## 7. Publication evidence

Pre-deploy read-only production snapshot: 345 tasks, 18 clients, 520 publications,
13 monthly goals; zero pending or unknown migrations. Fingerprints captured by
the existing private read-only verification procedure. Production activation and
post-deploy parity must be checked independently from this local test evidence.
