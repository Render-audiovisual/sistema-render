# Navigation recovery and client-only reporting

## 1. Objective

Navigate between sections without manual full-page reloads; remove person/team
report screens and retain client reports, existing tasks and business data.

## 2. Findings

The live Node SPA returned HTTP 200 text/html for a nonexistent hashed JS asset.
React.lazy retains an import rejection even after remounting its boundary.
Hostinger retained only the active UUID build, so old open documents could lose
their not-yet-downloaded sections after deployment. A fresh authenticated tab
did navigate normally; this is not proof that every possible page issue is fixed.
Employee return-link policy also rejected Instagram links already allowed by App.

## 3. Coordination and implementation

Three parallel agents handled reporting/navigation policy, independent asset HTTP
tests, and section recovery/Apache fallback. Main coordinated App, explicit retry,
public code preservation and the live/local browser checks. Disjoint write scopes.

- Single Reportes de clientes entry; /reportes-historias and /equipo redirect
  inside the application to /instagram without person filters.
- Person-report module no longer loads; team tab and attribution UI removed.
  Stored history and authorized weekly client automation are not deleted.
- Explicit guarded section retry creates a fresh lazy wrapper and boundary;
  it never reloads the document or automatically replays a business mutation.
- Current hashed JS/CSS remain primary. Old public bundles are preserved in
  hbuilds/public-assets across builds and resolved by exact immutable filename.
  A bounded archive fallback is also available. No HTML, maps, private files,
  uploads, credentials, API responses or business rows enter this cache.
- Missing assets return 404, not SPA HTML. Entry HTML is no-store under Node.
- The runtime also archives its own code at boot: actual Hostinger uses a
  custom build command, so the package build hook alone is not a guarantee.
- Shared client report return links align with existing role permissions;
  financial and administrative destinations remain protected.

## 4. Risks and boundaries

The retry helper cannot evict a browser's native failed-module cache. Public
asset retention prevents the demonstrated deployment-related failure going
forward; tabs whose old assets were already deleted cannot be repaired from
missing bytes. Previously open old UI may require reopening once to adopt new
navigation. No recurring hard reload workaround is introduced.
Public code cache deliberately retains immutable bundles; disk usage should be
reviewed separately. No automatic deletion of old commercial data or backups.

## 5. Acceptance evidence

Local real browser: Inicio -> Tareas -> Calendario -> Producciones -> Clientes
-> Feedback -> client reports -> Finanzas; back/forward work. CDP loaderId stayed
20D7E4EDF870CE8570FA43E4AEC4C32A throughout: same document, not hard reloads.
Fresh real-site tab also navigated between existing sections before publication.
Production checks after release remain a separate gate.

## 6. Tests

Full selected frontend suite: 3125 passed, one opt-in skipped; agent's expanded
suite: 3358 passed. Full backend: 3613 passed, 209 opt-in skipped. Focused public
asset/retirement HTTP suite: 23 passed, including removal of a synthetic old
version while its chunk still loads. Subsequent focused changes are retested.
Vite production build passed. Synthetic PostgreSQL/browser fixture was removed.

## 7. Release controls

Parent eede58d8, isolated branch codex/navigation-client-reports-20261103.
Pre-release production read-only fingerprints: tasks345, clients18,
publications520, monthlyGoals13; zero pending/unknown migrations. Preserved
49 current public assets before deployment so existing open tabs have code.
No migrations, identity changes, task writes or environment/automation changes.
Normal non-forced release-branch fast-forward; verify deployed file hashes,
old/current/missing assets, live sidebar navigation and business fingerprints.
