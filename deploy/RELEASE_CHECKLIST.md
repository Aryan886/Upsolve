# Beta release evidence and remaining gates

## Local implementation

- Schema 3: hashed expiring/single-use invitations added without rewriting users, sessions, notes or ownership; transactional migration/acceptance rollback.
- Schema 4: one hashed shared beta link and a durable 30-signup counter, preserved across link replacements; account creation and counter increment share one immediate transaction.
- Authentication: async scrypt, login throttling/concurrency bound, cookie/bearer separation, origin checks, revocation, hidden-password operator commands.
- LeetCode canonical URLs/title capture with editable fallback; existing site regressions.
- Website invitation setup with in-memory fragment handling, explicit sign-out, uncertain-response recovery and normal sign-in; password change, stale-request cancellation, onboarding and feedback/version UI.
- Website shared beta setup with editable email, spot availability, malformed-link handling, normal sign-in and uncertain-response recovery. The published store link is configured for the next website build.
- Extension fixed production endpoint, trusted local credential storage, scoped serialized drafts, recovery on expiry, duplicate-save guard and ambiguous-save warning.
- Compiled startup, static website-only hosting, validated configuration, Caddy/systemd files, online backups/upload marker/retention and recovery runbook.

Actual test/build results are recorded below after running the release gate. Prepared configuration is not a verified live deployment.

## Initial Lightsail rollout evidence (2026-09-28)

The owner deployed the original beta on Amazon Linux 2023 at `https://upsolve-aryan.duckdns.org`, using Caddy, systemd and a fresh persistent database. External requests verified the HTTPS homepage, `/health`, and `googleae6bb7febf88fddb.html`; the owner reported the website working. The host reported about 419 MiB usable RAM with swap, rather than the planned 1 GB. Follow the [actual deployment and update runbook](LIGHTSAIL_RUNBOOK.md) for repeatable releases, invitation schema migration, backups, rollback and extension updates.

This initial rollout does not confirm the invitation release is live, that Google cleared its phishing warning, or that S3 backups, restoration, all browser/isolation checks, and store distribution are complete. The broad release gates below remain open where these additional checks are needed.

## Owner/release gates (pending)

- [ ] Confirm credits/eligibility/expiry, region, stable IP, hostname/DNS and budget alerts.
- [ ] Supply owner email, feedback form, Chrome account/stable extension ID and privacy contact.
- [ ] Benchmark hashing and memory on the actual 1 GB server under simultaneous logins.
- [ ] Provision/configure host, firewall, Caddy HTTPS and certificate renewal prerequisites.
- [ ] Initialize/migrate actual notes with an explicit owner and verified pre-migration backup.
- [ ] Before any schema-3 server/admin opens schema-2 production data, verify and retain a SQLite-aware backup independently. Test compatible rollback; schema-2 binaries cannot open schema 3.
- [x] Before schema-4 code opened schema-3 production data, independently restore a SQLite-aware backup with the matching schema-3 release and retain a copy off-server. Schema-3 binaries cannot open schema 4; restoring that backup loses later writes.
- [ ] Configure private encrypted S3, least-privilege uploader, lifecycle and daily timer.
- [ ] Verify a failed real upload is visible; restore an actual downloaded S3 backup independently.
- [ ] Test restart, reboot, second release deployment and compatible rollback on the host.
- [ ] Verify browser Secure/HttpOnly/SameSite cookie behavior over HTTPS and JSON API errors.
- [ ] Test extension capture on actual supported sites and manual corrections; confirm LeetCode title fallback.
- [ ] Test popup close/reopen for each note type; revoke a session and recover the same user's draft.
- [ ] Use two real accounts and direct API requests to verify isolation after deployment.
- [ ] Confirm the included icons; finish synthetic screenshots, privacy page, store listing/reviewer access and review.
- [ ] Have one additional technical tester follow onboarding in a fresh browser profile and submit feedback.
- [ ] Exercise private invitation setup, invalid/reissued/expired links, signed-in visits and an interrupted acceptance in a fresh browser profile; verify HTTPS headers and no automatic replay/login.
- [ ] Exercise the shared beta link in a fresh browser profile: email/password signup, ordinary website and published-extension login, saved note, usage status, expiry/reissue/revocation, and signed-in visit. Count real smoke-test users toward the 30 spots.
- [ ] Share the reviewed install link with invited testers and run a one-to-two-week trial.
- [ ] Issue and privately deliver real invitations only after release verification; review restored outstanding invitations before reopening access after recovery.

## Verification results

Verified on 2026-09-27:

| Check | Result |
| --- | --- |
| Windows `npm run check` (installed Node 24.13.1 / npm 11.8.0) | Passed: strict types, 68 tests, all workspace builds |
| Ubuntu WSL x64 clean `npm ci`, pinned Node 22.23.3 / npm 10.9.9 | Passed, including a native better-sqlite3 build |
| Linux `npm run check` | Passed: 68 tests across 17 files, all workspace builds |
| Linux production website/extension builds | Passed with isolated test-only HTTPS configuration and packaged icons |
| Linux install after `npm prune --omit=dev` | Compiled app started successfully from an unrelated working directory |
| Production smoke | Health, website/JS assets, JSON errors, private-file exclusion, auth, save/search, two-user isolation, restart persistence, backup restore and SIGTERM passed |
| Production extension manifest | Single configured HTTPS API host verified; no broad site permission |
| scrypt benchmark on development Linux machine | Approximately 324 ms; actual Lightsail memory/load benchmark remains pending |
| Backup tests | Consistent live WAL backup, integrity/foreign keys, failed-upload marker behavior, overlap prevention and three-copy retention passed |
| Diff review | `git diff --check` passed; no dependency additions; existing user notes database was not opened/migrated |
| Browser visual/store screenshots | Pending: no browser was connected to the available UI automation tool |

The 68 tests cover 20 shared, 26 backend, 8 website and 14 extension cases. These are the historical local results from September 27; test accounts/databases use temporary directories. The initial Lightsail rollout is recorded above. Real S3 upload/download and restoration, Chrome Web Store submission and a completed tester trial remain unverified here. Use the pinned Node 22 runtime for release despite the additional successful Windows check on Node 24.

The shared beta signup work was added on 2026-10-03; the September 27 counts above are historical. Windows `npm run check` passed 206 tests across all four workspaces. Ubuntu WSL verified a clean `npm ci` on pinned Node 22.23.3/npm 10.9.9, all 206 tests, production builds, dependency pruning, compiled beta/invitation commands, website and extension login, authenticated save/isolation, restart persistence, independent schema-4 backup restoration, and shutdown. The [public CP Notes listing](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko) is reachable. Production rollout evidence follows; a real tester browser flow and private S3 backup setup remain pending.

## Shared beta Lightsail rollout (2026-10-03)

- Deployed Git commit `5345f88bfe1f3e1edb1d8e51efcc5f6663f2ecd4` from `origin/beta` to `/opt/cp-notes/releases/20261003-152854-5345f88bfe1f` and activated it through `/opt/cp-notes/current`. The running service and Caddy were active after activation and another restart.
- Before migration, the old release restored the SQLite-aware schema-3 backup independently and verified integrity, foreign keys, and unchanged user/session/invitation/note rows. A matching copy was downloaded to `C:\Users\aryan\CP-Notes-private-backups\` with SHA-256 `997d1081aafe9d47be082fba2a9b9794e7ea3ae82105e25ad6263dd6f186c4e6`.
- A clean Linux `npm ci`, root `npm run check` (206 tests), production website/extension builds, and dependency pruning passed on Lightsail. Opening a copy of the backup with the staged release migrated schema 3 to 4 while preserving every existing row. Compiled release smoke tests passed on disposable data: signup, website and extension login, saved notes, two-account isolation, restart, backup restoration, revocation, and clean shutdown.
- Activation migrated the live database to schema 4. The live user's existing rows matched the verified backup. HTTPS health, assets, private-file exclusion, beta origin checks, published-extension CORS, and Google verification passed. The production browser showed the signup form with 30 available spots and the configured Chrome Web Store link was present in the served website build.
- Issued the shared link at `2026-10-03T15:46:30.975Z`, expiring `2026-10-10T15:46:30.975Z`. `beta-status` showed `0 / 30` both before and after a service restart. The token is deliberately omitted from this record.
- A post-release schema-4 backup containing the active link state restored independently with unchanged rows and 0 / 30 usage. Its downloaded off-server copy matched SHA-256 `37da1eb87c665163e67b7c2cdcdc240a26fd40224c850510e1e2bfc2bca26953`.
- The compiled operator CLI silently skips execution when its script argument goes through the `current` symlink. Operator instructions now resolve the actual release path. The backup unit template adds Node's `--preserve-symlinks-main` flag for when scheduled backups are configured; it has not been installed on Lightsail.

The first real tester must still sign up, sign in to the website and published extension, save a note, and verify the note and 1 / 30 usage. Automatic private S3 backups and an actual S3 restore remain open; the manual pre- and post-release copies above are local to the owner and separate from that setup.
