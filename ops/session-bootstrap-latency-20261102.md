# Initial session validation latency

## Objective and scope

Reduce duplicated database reads in browser bootstrap without caching identities, bypassing initial authentication or changing tasks, business data, permissions, credentials or automation configuration.

## Implementation

For configured owners only, readBootstrap reads persisted user/photo and validated owner-profile metadata from the same fresh readUsers statement after authentication middleware. Existing root/actor active, administrator, mapping, expiry and epoch checks are reused unchanged. The normal employee/unmapped path and legacy bearer path are unchanged. Response fields are explicitly allowlisted. A failed owner bootstrap never falls back to stale identity or metadata.

## Verification

55 focused session/authority/security tests passed. 20 actual HTTP/PostgreSQL integration tests passed in two freshly created local fixtures. Tests cover revoked epochs, deactivation, downgraded targets, original expiry, cross-session context/CSRF, logout CAS, no employee finance grant and preserved Leader assignments. No production writes or migrations were used for testing.

## Baseline and limitations

375px direct-link measurements before release: session responses for Bendita/Lavalle/Moketa 930/748/528ms; document-to-report-data 2403/2272/2028ms. Connection and initial database/host load vary, so compare repeated samples rather than claiming all users improve equally. Ordinary employees retain their existing two-step validation. The optimization removes one owner bootstrap database round trip, not an authentication check.
