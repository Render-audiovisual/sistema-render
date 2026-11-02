# Instagram: authenticated team read access

## 1. Objective

The owner explicitly confirmed that all signed-in Render users may consult Instagram. This is not anonymous/public-internet access.

## 2. Scope

All active users with a current server-verified session may read the monthly overview, individual client reports and stored Instagram reports. Client-facing report allowlists remain unchanged; no financial data or provider credentials are added.

## 3. Permission matrix

| Operation | Active authenticated team | Leader | Anonymous/inactive/revoked |
| --- | --- | --- | --- |
| Monthly overview / client report | Read | Read | Denied |
| Saved report list / saved report | Read | Read | Denied |
| Account administration / piece-linking detail | Denied | Read | Denied |
| Account-to-client and media-to-piece mutations | Denied | Write | Denied |
| Finance | Unchanged: denied | Existing permissions | Denied |

## 4. Controls and risks

The backend revalidates active status and session version from PostgreSQL, including existing owner-profile authority checks. Administrative reads and writes keep their admin-role checks. The frontend hides Accounts and linking controls from the team, including direct administrative URLs; it is not the authorization boundary.

## 5. Acceptance

Instagram is visible in team navigation; direct client report URLs work. No anonymous access, finance grant, configuration grant, schema change or operational data mutation is introduced. Existing report speed improvements and response allowlists are retained.

## 6. Validation

85 focused tests passed. Eight integration tests passed on freshly generated local PostgreSQL fixtures, including actual password/cookie HTTP logins for Design, Editing, Production, Community and Development. They verify read access, 403 for both mutation endpoints and financial access, admin account access, 401 without a session or after revocation, and unchanged test tasks. Production frontend build passed (277 modules). No production employee impersonation was used.

## 7. Integration

Prepared on `codex/instagram-team-read-access`. No migrations required. Publish only over the verified current release tree; compare operational fingerprints before/after and verify anonymous requests remain 401. Production role behavior is covered by the exact-code local real-HTTP test; do not claim to have logged in as an actual employee in production.
