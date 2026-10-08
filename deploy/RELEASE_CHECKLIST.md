# Beta release evidence and remaining gates

## Local implementation

- Schema 3: hashed expiring/single-use invitations added without rewriting users, sessions, notes or ownership; transactional migration/acceptance rollback.
- Schema 4: one hashed shared beta link and a durable 30-signup counter, preserved across link replacements; account creation and counter increment share one immediate transaction.
- Authentication: async scrypt, login throttling/concurrency bound, cookie/bearer separation, origin checks, revocation, hidden-password operator commands.
- LeetCode canonical URLs/title capture with editable fallback; existing site regressions.
- Website invitation setup with in-memory fragment handling, explicit sign-out, uncertain-response recovery and normal sign-in; password change, stale-request cancellation, onboarding and feedback/version UI.
- Public website `/signup` with strict website-origin registration independent of beta history, normal sign-in, session discovery, sensitive-state cleanup and uncertain-response recovery. Old beta fragments lead to public signup; beta APIs/issuance retire. The historical shared beta rollout is retained below.
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
- [x] Configure private encrypted S3, least-privilege uploader, lifecycle and daily timer.
- [x] Verify a failed real upload is visible; restore an actual downloaded S3 backup independently.
- [ ] Test restart, reboot, second release deployment and compatible rollback on the host.
- [ ] Verify browser Secure/HttpOnly/SameSite cookie behavior over HTTPS and JSON API errors.
- [ ] Test extension capture on actual supported sites and manual corrections; confirm LeetCode title fallback.
- [ ] Test popup close/reopen for each note type; revoke a session and recover the same user's draft.
- [ ] Use two real accounts and direct API requests to verify isolation after deployment.
- [ ] Confirm the included icons; finish synthetic screenshots, privacy page, store listing/reviewer access and review.
- [ ] Have one additional technical tester follow onboarding in a fresh browser profile and submit feedback.
- [ ] Exercise private invitation setup, invalid/reissued/expired links, signed-in visits and an interrupted acceptance in a fresh browser profile; verify HTTPS headers and no automatic replay/login.
- [ ] Exercise public `/signup` in a fresh browser profile: no token/cap/extension requirement, normal website and extension login, saved note, signed-in visit, refresh, Back/Forward, ambiguous response and cross-tab changes. Verify old beta bookmarks and retired API guidance; revoke the legacy token after the authorized backup without resetting history.
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

## Automatic deployment preparation (2026-10-06)

The repository now contains the GitHub build/deploy and firewall-cleanup workflows, server worker source, release packaging, safe extraction, database-copy preflight, S3-verified pre-release backup, compatible code recovery, and operator setup instructions. `AUTO_DEPLOY_ENABLED` has not been enabled. No GitHub environment, IAM role, server worker, or S3 bucket was configured during this local implementation.

Local evidence: Ubuntu WSL with pinned Node 22.23.3/npm 10.9.9 passed `npm run check` (206 application tests), production smoke, and the disposable package/extract exercise. Five Node deployment tests passed on Linux, including rejection of a symlinked upload and schema-only rollback mismatch; ten Python archive/firewall tests passed on Linux. Both workflows passed actionlint v1.7.12, and shell/Node syntax and `git diff --check` passed. The locked production dependency audit found no advisories after patch-version updates. The full audit still flags the existing development-only `concurrently`/`shell-quote` advisory; that tool is not used in CI or shipped after production pruning. The Amazon Linux 2023 container and real systemd/AWS interactions remain untested until GitHub and the server are configured.

Read-only HTTPS checks still returned `200` for `/health` and the Google verification file. `/release.json` returned `404`, as expected from the older live release. This confirms the new release was not deployed. The remaining gates are the private S3 restore, least-privilege GitHub/AWS access, a supervised deploy and compatible rollback, firewall cleanup, and a subsequent push-to-live run. Record their run URLs, commit IDs, backup hashes, and observed data persistence here before describing automatic deployment as active.

Early on October 7, the packaged Linux exercise passed again with all 206 application tests, seven Node deployment cases and twelve Python cases. Rollback checks use a SQLite-aware backup including live WAL data and reject row changes by the previous binary. Compatible rollback reuses the existing readiness marker. The live setup and subsequent checks follow below.

## Automatic deployment rollout (2026-10-07)

- Production follows `main`, as requested by the owner. The GitHub production environment restricts that branch; the dedicated SSH account cannot read the production database or modify the worker/configuration. Deployment uses a pinned host key and temporary OIDC firewall access to the one Mumbai Lightsail instance.
- Private bucket `cp-notes-backups-643962960552-ap-south-1` has public access blocked, bucket-owner-enforced ownership, AES256 encryption, TLS enforcement and a 14-day `daily/` lifecycle. Separate server-only credentials permit daily uploads and pre-release upload/download verification. The daily timer is enabled and active.
- The first S3 daily backup completed at `2026-10-07T10:05:29.606Z`. Its independently downloaded 131072-byte copy matched SHA-256 `de74cf2ad18e78e6e414efe1272375fd257ac37c910023e430ccf5aa811cf250`. Integrity and foreign keys passed, then an isolated restored database on Linux passed website cookie/extension bearer login, save/search and two-user isolation. Production data was not changed by this restore exercise.
- A real daily-credential upload to an unauthorized S3 prefix failed with service result `exit-code`, status 1, and a sanitized journal message. The last-success marker, active app/timer and lock cleanup were verified; the temporary test unit was removed.
- [First supervised deployment](https://github.com/Aryan886/Upsolve/actions/runs/37607377200) built and activated `a03a051e179c0e669b775cb26df4cf6d2393f85b`. Amazon Linux/Node 22.23.3 ran the full 206-test application gate, deployment tests and compiled production smoke. The stopped-app pre-release backup completed a private S3 download/hash round trip. Journal timestamps show approximately four seconds between service stop and listening. HTTPS health, exact public release identity, homepage/assets, privacy, Google verification and signed-out private-API rejection passed.
- The owner reported successful live website login, published-extension capture, and website find/edit. The captured note was kept for the subsequent persistence check.
- [Controlled startup failure](https://github.com/Aryan886/Upsolve/actions/runs/37608379814) built commit `6c6cd3050a8244ebc89ff901ef4b88422075fbad`, then a temporary guard rejected only that candidate's startup. The worker recorded `failed` and `previous compatible code restored`; the original release and backup timer were active. GitHub stayed failed and removed its SSH rule. The guard was removed. Recovery now waits for the restarted process to become healthy; nine Linux Node deployment cases and twelve Python cases passed in this build.
- [Cancellation exercise](https://github.com/Aryan886/Upsolve/actions/runs/37608797186) was cancelled after the independently running worker entered preflight. Durable server status recorded successful activation of `6c6cd3050a8244ebc89ff901ef4b88422075fbad` at `2026-10-07T10:41:26.120Z`, with SHA-256-verified pre-release backup `c6482bcdc0706e336bc759b1b4bb680216be984735133680a0304b3157cf271e`. The app/timer were active and temporary runner access was closed. SSH retained only the operator `/32` and Lightsail browser-connect alias; ports 80/443 remained available and port 3000 stayed private.

- [Manual status reconciliation](https://github.com/Aryan886/Upsolve/actions/runs/37609758272) succeeded after the cancellation and reported the completed release through Actions. Its runner rule was removed.
- [Compatible rollback](https://github.com/Aryan886/Upsolve/actions/runs/37609863693) restored the first installed release, then [forward selection](https://github.com/Aryan886/Upsolve/actions/runs/37610157108) restored the newer installed release. [Repeated rollback to the first release](https://github.com/Aryan886/Upsolve/actions/runs/37610633158) succeeded with its own status record, backup, current-link change and public checks. The verified pre-release backups matched `c6482bcdc0706e336bc759b1b4bb680216be984735133680a0304b3157cf271e`. Direct read-only comparison after the exercises confirmed every table's rows, account/session state and schema matched the post-capture baseline; integrity/foreign keys passed and the app/timer stayed active.
- [Final implementation build](https://github.com/Aryan886/Upsolve/actions/runs/37609697132) passed the full 206-test application gate, eleven Node deployment cases, twelve Python cases, production packaging and compiled Linux smoke. Local Node checks, Bash syntax, Python cases and `git diff --check` also passed for the rollback update. Status/rollback now write sanitized Actions summaries; operation times are included.

- [PR check](https://github.com/Aryan886/Upsolve/actions/runs/37611529236) passed for [PR #2](https://github.com/Aryan886/Upsolve/pull/2); deployment/build/operate jobs were skipped for the PR. The required `check` context passed, the PR was mergeable with branch protection, and it was merged into `main`.
- `AUTO_DEPLOY_ENABLED=true` was set only after the supervised gates and PR check passed. [The resulting ordinary main push](https://github.com/Aryan886/Upsolve/actions/runs/37611944810) built and automatically activated `9398050449eb31ba890da4bb2cca2c16bc2d1964` at `2026-10-07T11:09:24.756Z` without an SSH/console deployment command. GitHub reported success; public `/release.json` matched the commit/run/attempt. Its private S3 round trip matched `c6482bcdc0706e336bc759b1b4bb680216be984735133680a0304b3157cf271e`. All stored rows/session state and schema again matched the baseline, integrity/foreign keys passed, and the app/timer were active. The runner's SSH rule was removed, leaving operator/browser access intact.

Automatic website/backend deployment from `main` is active. Broader tester-trial gates above remain separate. The nightly reconciliation schedule is installed; its first scheduled invocation remains a future observation distinct from manual cleanup and cancellation checks.

## Public website signup preparation (2026-10-08)

Implemented on `codex/public-website-signup`, starting from `main` at `78ae0fa`. The user-supplied plan was the only initial untracked file. No main push/merge, deployment, real database access, live signup, real token revocation or store publication was performed.

- Added strict `{ email, password }` signup with normalized-email-only acknowledgment, exact website Origin, bounded IP/email throttling and the existing two-job scrypt cost/capacity. A short immediate transaction rechecks email and commits an ordinary user; only the expected email uniqueness conflict maps to `409 signup_unavailable`. No schema/index/session/beta-counter changes.
- Renamed the beta form to `SignupForm`; removed inspection/expiry/spots/token requirements. Direct `/signup` and `/signup/`, history navigation, signed-in identity/explicit logout, initial-session ordering, StrictMode, cross-tab cancellation, duplicate-submit protection and uncertain-response sign-in guidance have automated coverage. Credentials remain only in current-page memory.
- Old beta fragments are removed immediately and reach public signup, including empty/invalid/expired/full tokens. Mixed/duplicate setup parameters offer neutral public guidance; single valid invitations still work. Beta APIs return `410 beta_signup_retired`; issuance stops while status/revocation and historical schema/migration data remain supported. Removed unused beta contracts/configuration and current lifetime-setting examples.
- Extension signup is a new-tab website anchor initialized after settings and before metadata/session lookup. Dev/prod URLs, restricted/blank/unsupported tabs, failures/expiry and retained login/capture/drafts are covered. Manifest and workspace/lock metadata are prepared as **0.1.2**, preserving the same item identity/permissions.
- Updated README, privacy/onboarding, operator/tester/store copy, build-plan pointers and release smoke expectations. Historical deployment evidence remains dated and unchanged. Email verification and automated recovery remain deferred; reset/transfer needs reliable ownership proof.

Verification so far: focused shared/backend/website/extension tests passed; Windows `npm run check` on Node 24.13.1/npm 11.8.0 passed **260 tests** (42 shared, 99 backend, 97 website, 22 extension), strict types and all workspace builds. Node deployment checks passed 10 with one platform skip; Python deployment checks passed 11 with one platform skip. The first broad run identified five obsolete beta hashing tests; those now assert retirement without hashing/lookup/writes while retaining invitation race coverage. Ubuntu WSL `deploy/verify-linux.sh` passed with a clean locked install on pinned Node 22.23.3/npm 10.9.9, all 260 tests, release builds, production dependency pruning, and compiled production smoke: token-free public signup with a full historical beta, retirement guidance, optional invitations, both logins, private capture/search, public-user/session restart persistence, independent schema-4 restoration and legacy revocation on disposable data. The local scrypt benchmark was 262 ms; this is not a new live-server load benchmark.

Release gates remain open: authorized backend/website deployment plus verified backup; legacy beta-token revocation; live `/release.json` and direct/refreshed signup, old login/notes/isolation and optional invitations; actual browser link/signup/login/capture/read/edit/interrupt flow; live restart/redeploy and independent restore; separate same-item extension upload/review/installed-package verification. Account creation on the live service writes real data. Main auto-deploys and Chrome publication is separate; no new infrastructure/settings/migration are required. See [cutover and rollback](LIGHTSAIL_RUNBOOK.md#10b-public-website-signup-cutover).

Dependency audit: production dependencies after pruning had zero advisories. The unchanged development-only `concurrently`/`shell-quote` path still reports two critical entries for the existing shell-quote command-injection advisory; no dependency version changes or audit-fix commands were introduced by signup.

The isolated Ubuntu `deploy/test-build-release.sh` exercise also passed the full 260-test gate, release build/pruning/smoke, archive creation, extraction and a second compiled smoke. All 11 Node deployment tests passed on Linux without the Windows platform skip. It used the script's disposable dirty-checkout/Ubuntu overrides; the actual reviewed commit must still be built by the Amazon Linux 2023 pipeline at release. Final `git diff --check`, new-file whitespace and local document-target checks passed; generated tracked TypeScript build metadata was restored. No lint script exists.
