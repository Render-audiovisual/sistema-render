# Manual production backup and isolated restore — 2026-10-26

## Authority, identity and privacy

User explicitly authorized a manual backup to this computer and restoration in an isolated environment, with no production data/schema changes or deployment. The Hostinger DATABASE_URL project reference was matched against the logged-in Render account: Render paginas, RENDER - AGUS, fehsetsugaoncjmmfvek. No account, project, role or subscription was created. No password reset, TLS enforcement toggle, seed, migration, cleanup or application startup was performed in production.

Archives and restored data are outside Git in the private directory:

`/Users/agustinobregon/Documents/Render-Backups/2026-10-26-render-sKtlEV`

Parent/directory mode0700 and archive/report mode0600. These are sensitive local files, not a remotely replicated or independently encrypted backup. No claim about FileVault is made. Raw data, credentials and private logs are not committed. Connection was transferred in memory via an origin/host/token-checked single-use loopback form; it was not printed, persisted as a connection string or passed in command arguments. Hostinger value was hidden again. Table contents may themselves contain private records/secrets inside the archive.

## Capture

Initial attempts did not read business data: the first connection was rejected by strict TLS (SELF_SIGNED_CERT_IN_CHAIN). The official CA linked in the project's Database Settings was downloaded over HTTPS; no global trust store was modified and rejectUnauthorized/verify-full remained active. Public CA SHA256 fingerprint:807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa. Source PostgreSQL17.6, dump/restore tools18.4.

Source connection confirmed TLS and transaction_read_only=on; BEGIN REPEATABLE READ READ ONLY exported a snapshot used by both pg_dump archives and operational table fingerprints. No DML/DDL was sent to production. The snapshot was committed read-only and connection closed before local verification. Existing production work was not paused; this is a point-in-time backup, not continuous recovery.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| database-full.dump | 1407520 | 163529718e81597456bc1acc0255e93b87c7be901b8a366a55a02a339cbca79f |
| database-public.dump | 1048195 | 05f84330cccf71faf2a325ef2171a283033c7236c289c1e99bfb2801d0b33d6f |

Full custom archive is readable:102 table-data entries,48 sequence-state entries,14 schema entries. Both checksums were recomputed after restoration. Full archive captures the logical database; no full Supabase service stack restore is claimed.

## Restore verification

Actual pg_restore of the public archive into newly initialized PostgreSQL18.4 completed under --single-transaction/--exit-on-error, excluding ownership/ACL/publications/subscriptions. Roles were local NOLOGIN placeholders; selected locally available extension dependencies were prepared only inside this cluster. Positive data_directory/listener/user guards preceded dropping the empty local public schema. Production was never a restore target.

Server used a private Unix socket, listen_addresses empty, and a macOS sandbox denying outbound networking and writes outside its own data/socket/log paths. Synthetic negative probes confirmed EPERM for outbound connection and outside-file write. Initial synthetic restore found the preexisting-public-schema issue; fixed before capture. Positive synthetic restore passed; SIGTERM during startup also passed with both owned source/restore clusters stopped and no acceptance artifact.

Actual source snapshot vs restored copy:

-64 public operational tables,7566 rows: all per-table counts and sorted row-content hashes match.
-244 original PK/FK/check/other constraints: definitions and validation flags match exactly, no missing/changed original constraint.
-46 sequence last_value/is_called states match the public archive, extracted without executing its setval commands.
-409 additional local NOT NULL catalog entries are validated/enforced and correspond to attnotnull columns. PostgreSQL18 newly stores these in pg_constraint, unlike17. The initial strict equality failure is retained; it was explained, not silently ignored. See [PostgreSQL18 release notes](https://www.postgresql.org/docs/18/release-18.html).

Final offline verification2026-10-26T18:06:09.517Z (15:06 Argentina/Cordoba) returned terminal0 after stopping the local cluster and confirming postmaster.pid absent. Acceptance file is restore-verification.json in the private backup directory. No new production connection was needed to resolve the catalog difference. Failed TLS/form attempts and the initial strict-comparator failure were not counted as successful backups.

## Scope limits and next release gate

Verified restore scope is the operational public schema, not managed auth/storage/realtime services. Owner/ACL equality, real authentication/provider behavior and full application startup were not tested by this restoration. External Storage/Drive object bytes, hosting environment secrets and global role passwords are not separately backed up. Do not call this a complete provider disaster-recovery exercise or production readiness.

Main owns temporary helpers/capture/verification; Harvey and Hilbert independently review safety and bounded acceptance. Production remains at its previously observed deployed commit; the current release's divergent migration histories and newer remote fixes still require reconciliation and rehearsal on a separate disposable copy. Never run historical cleanup migrations merely because this backup exists. Preserve this verified restored cluster stopped; use a separate clone for future migration rehearsal.

Final independent review: Hilbert reviewed the verifier and acceptance/checksum metadata (did not reread raw dumps or recompute their hashes); no new blocker for the bounded operational copy. Harvey passively confirmed absent postmaster.pid and no matching restore/helper process, listener55996 or restore socket. Main separately recomputed archive hashes and confirmed the cluster remains stopped. The temporary aggregate-only result viewer was closed after its screenshot, /private/tmp/render-manual-backup-verified.png.
