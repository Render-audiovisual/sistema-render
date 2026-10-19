# Render2 authorization and account-split contract

Target policy for approval/implementation; not an assertion that principal endpoints already enforce it. Sources: `backend/src/auth.js`, `server.js`, `task-access.js`, `task-workflow.js`, `report-access.js`, migration 012 and sandbox reference. No real account roster or credentials inspected.

Baseline findings below were captured before rescue patches. See `STATUS.md` for the current implemented subset and `LOCAL_TESTING.md` for isolated HTTP results; this target matrix must not be mistaken for a completed permission rollout.

Latest login identity integration: see `LOGIN_IDENTITY_CONTRACT.md` and `LOGIN_IDENTITY_QA.md`. Principal password candidate lookup now uses only canonical `usuario` and admin-configured `google_email`, never notification routing. Google first binding uses stable-ID/email/session-version/activity/subject conditional UPDATE and current RETURNING; provider verification remains mandatory. No real account roster, aliases or shared historical identities were created, merged or reinterpreted. Independent production onboarding remains unverified. Read the integration QA status before treating these implementation notes as runtime evidence.

## Current gaps and explicit policy decisions

- Principal `auth.js` calls `jwt.verify(token, secret)` and `requireRole` trusts the signed `rol`; principal login currently signs 30-day name/role claims. Target: explicit algorithm/issuer/audience/expiry and typed identity validation; database-resolved active user/current capabilities and revocation. Missing auth configuration must fail closed; unavailable auth storage must not fall back to token roles.
- `task-access.js` authorizes via display-name aliases/JSON names; `report-access.js` also contains person/client-name rules. Renaming or splitting accounts must not change ownership or historical payroll attribution.
- `task-workflow.js` and tests encode special leader/finalizer behavior for names and Community. Sandbox policy has no Community right to close another person's work. Do not silently choose one: owners must approve explicit review/publication capabilities; no privilege from a name, local profile or job title.
- Migration 012 has unique non-null Google subject and case-insensitive Google email indexes. Login verifies Google token/audience and `email_verified`, then finds subject or links by configured email. Strengthen first-link atomicity and collision handling rather than claiming Google verification is absent.

## Target matrix

Authenticated team roles include `diseno`, `edicion`, `produccion`, `community`, `programacion`; arbitrary normalized role labels (`user-roles.js`) must not automatically acquire capabilities. Admin below means approved server-resolved admin, not a client-selected role.

| Resource/action | Anonymous | Team member | Admin | Additional condition |
| --- | --- | --- | --- | --- |
| Login | Allowed, throttled | Allowed | Allowed | Generic credential failures; no automatic user provisioning |
| Shared Render OS board | Deny | Read safe DTO | Read safe DTO | Private workspaces/lists excluded |
| Private task/list/report | Deny | Own or explicit grant only | Approved administrative scope only | Server-side scope before serialization; no accidental blanket private-list access |
| Update own/collaborating task | Deny | Scoped fields | Approved scope | Stable user IDs; active relation; expected version; transition validation |
| Create/reassign/archive tasks | Deny | Deny by default | Allow | Proposed phase baseline; any principal compatibility exception requires explicit capability approval |
| Review/approve/publish/reopen | Deny | Explicit capability AND resource scope | Explicit capability | Never implied by production completion, Community role or name; reopening published work needs approved policy |
| Financial contracts/payroll/amounts | Deny | Deny, including nested report fields | Allow | Separate operational-client DTO; protect all equivalent routes and exports |
| Manage identity/role/activity | Deny | Deny | Allow | Audit; revoke affected sessions; prevent last-admin lockout |
| Own login/password change | Deny | Allow with reauthentication | Same self-service rule | ID and assignments unchanged; revoke sessions as policy requires |
| Google linking/unlinking | Deny | Reauthenticated approved self-link | Approved invitation/link workflow | Verified provider identity, unique subject and atomic binding; audit/revoke |
| Drive/resource download | Deny | Explicit resource grant | Explicit resource grant | Render admin is not Google ACL bypass; verify real integration separately |
| Audit | Deny | No general read/write access | Approved read | Application emits append-only records; secrets/tokens excluded |

401 = missing/invalid/revoked identity; 403 = authenticated but forbidden; 409 = authorized stale write or linkage conflict. Check authorization before exposing conflicting record details. Use 404 where existence itself is private. No successful response before transaction commit. Browser hiding is not access enforcement.

## Individual accounts without rewriting history

1. Preserve each existing `usuarios.id`. Add new individual rows only after an approved per-person roster and invitation flow; do **not** run `seed-usuarios` or bulk upsert named existing users. Local preview profiles are not evidence that production accounts exist or belong to those people.
2. Identify shared logins explicitly. A shared historical ID remains a disabled/legacy principal with retained references; it must not be renamed into one person and granted all historical work. Create separate new person IDs only where needed; revoke shared credentials/sessions at planned cutover. Keep one approved recovery-capable admin during transition.
3. Move future/current assignments using approved ID mappings and effective dates. Preserve original actor/payee/name snapshots on historical records; unresolved shared authorship stays unknown/shared. Alias examples such as Milton/Luciano in `employeeKey` are financial compatibility rules, not proof of identity and not permission to merge accounts.
4. Maintain explicit unique login identifiers separately from notification email. Notification routing changes cannot grant login rights implicitly. Preserve legacy login compatibility only through a documented unambiguous alias map with collision rejection.
5. Google identity key is `(provider, subject)` bound uniquely to the stable internal ID; email/name/photo are attributes. Validate provider token through the library, intended audience/issuer, expiration, nonempty subject and strictly verified email. Match subject first; changed email must not reassign an already linked subject.
6. First link requires an approved pending invitation/existing account with unique verified configured email and no prior subject, or an explicitly reauthenticated self-link. Bind transactionally with a conditional empty-subject update and uniqueness constraints; concurrent duplicate/conflicting links fail closed. Never link by display name, role, notification email or an arbitrary email submitted by the browser. Unlink/relink requires reauthentication/admin-approved recovery, audit and session revocation, not silent email overwrite.

## Acceptance tests and readiness

Test direct HTTP, not just component visibility: employee denied every finance mutation/read/export and nested amount field; same display name cannot access another ID's task; rename preserves permissions; collaborator removal/role downgrade/deactivation takes effect on next request; invalid algorithm/issuer/audience/expiry/claim types rejected; stale JWT role cannot grant admin; malformed bearer rejected; revoked session rejected. Add parallel Google first-link collision, existing subject with changed email, unverified email, unknown account and duplicate-login alias tests using a stub verifier (no network).

Principal Google linking and JWT tests need implementation-agent updates; existing `auth.test.js` expects a minimal signed identity and is not sufficient for the target. Sandbox session tests exercise a different schema. Run new database tests only in the third disposable principal harness described in `ARCHITECTURE.md`.

Production approval separately requires real individual linkage verification, approved roster/capabilities, recovery and revocation rehearsal, HTTPS cookie/CSRF decisions if cookies are adopted, login abuse controls, audited grants and staging privacy tests. No real Google, Drive ACL, notification delivery or production identity was verified in this review.
