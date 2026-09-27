# Beta release evidence and remaining gates

## Local implementation

- Schema 2: users, hashed sessions, required ownership, private URLs, scoped queries, migration rollback.
- Authentication: async scrypt, login throttling/concurrency bound, cookie/bearer separation, origin checks, revocation, hidden-password operator commands.
- LeetCode canonical URLs/title capture with editable fallback; existing site regressions.
- Website sign-in/password change/sign-out, stale-request cancellation, onboarding and feedback/version UI.
- Extension fixed production endpoint, trusted local credential storage, scoped serialized drafts, recovery on expiry, duplicate-save guard and ambiguous-save warning.
- Compiled startup, static website-only hosting, validated configuration, Caddy/systemd files, online backups/upload marker/retention and recovery runbook.

Actual test/build results are recorded below after running the release gate. Prepared configuration is not a verified live deployment.

## Owner/release gates (pending)

- [ ] Confirm credits/eligibility/expiry, region, stable IP, hostname/DNS and budget alerts.
- [ ] Supply owner email, feedback form, Chrome account/stable extension ID and privacy contact.
- [ ] Benchmark hashing and memory on the actual 1 GB server under simultaneous logins.
- [ ] Provision/configure host, firewall, Caddy HTTPS and certificate renewal prerequisites.
- [ ] Initialize/migrate actual notes with an explicit owner and verified pre-migration backup.
- [ ] Configure private encrypted S3, least-privilege uploader, lifecycle and daily timer.
- [ ] Verify a failed real upload is visible; restore an actual downloaded S3 backup independently.
- [ ] Test restart, reboot, second release deployment and compatible rollback on the host.
- [ ] Verify browser Secure/HttpOnly/SameSite cookie behavior over HTTPS and JSON API errors.
- [ ] Test extension capture on actual supported sites and manual corrections; confirm LeetCode title fallback.
- [ ] Test popup close/reopen for each note type; revoke a session and recover the same user's draft.
- [ ] Use two real accounts and direct API requests to verify isolation after deployment.
- [ ] Confirm the included icons; finish synthetic screenshots, privacy page, store listing/reviewer access and review.
- [ ] Have one additional technical tester follow onboarding in a fresh browser profile and submit feedback.
- [ ] Share the reviewed install link with invited testers and run a one-to-two-week trial.

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

The 68 tests cover 20 shared, 26 backend, 8 website and 14 extension cases. Test accounts/databases use temporary directories. There is no verified AWS deployment, real S3 upload/download, Chrome Web Store submission or completed tester trial. Use the pinned Node 22 runtime for release despite the additional successful Windows check on Node 24.

