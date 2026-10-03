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
- [ ] Before any schema-4 server/admin opens schema-3 production data, verify and retain a SQLite-aware backup independently. Test compatible rollback; schema-3 binaries cannot open schema 4.
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

The shared beta signup work was added on 2026-10-03; the September 27 counts above are historical. Windows `npm run check` passed 206 tests across all four workspaces. Ubuntu WSL verified a clean `npm ci` on pinned Node 22.23.3/npm 10.9.9, all 206 tests, production builds, dependency pruning, compiled beta/invitation commands, website and extension login, authenticated save/isolation, restart persistence, independent schema-4 backup restoration, and shutdown. The owner reports the extension published, and the [public CP Notes listing](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko) is reachable. Production schema-4 migration, an actual downloaded S3 restore, and a real tester browser flow remain pending.
