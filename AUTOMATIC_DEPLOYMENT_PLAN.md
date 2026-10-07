# Automatic deployment from GitHub

Status: the Amazon Linux build, one-time GitHub/AWS setup, independent S3 restore, supervised deployment, real startup-failure recovery, cancellation cleanup and repeated compatible rollback passed. The final PR and automatic push-to-live gates remain pending. Production follows `main`, as requested on October 7. Live evidence is recorded in [the release checklist](deploy/RELEASE_CHECKLIST.md#automatic-deployment-rollout-2026-10-07).

Prepared October 3, 2026. This extends [AWS_BUILD_PLAN.md](AWS_BUILD_PLAN.md) and the [Lightsail runbook](deploy/LIGHTSAIL_RUNBOOK.md). Existing privacy, backup, and release requirements still apply.

## 1. Outcome and scope

After setup, the normal operator workflow is: change code, commit, push to `main`, then check the GitHub Actions deployment result. Successful, compatible website/backend changes deploy without opening the Lightsail console.

GitHub runs checks and builds a release away from the small production server. A controlled server script backs up SQLite, activates the release, and verifies it. Failed checks never reach production. Failed activation restores the previous code only when compatibility has been established.

Keep the existing Lightsail instance, Caddy, systemd, Express process, and SQLite database. No application data-model change is required. Database migrations and changes to server configuration use an explicitly triggered release path. Chrome Web Store submission, operating-system maintenance, account administration, and disaster recovery remain separate operations.

Implementation order: local scripts and tests; GitHub CI; one-time access and backup setup; supervised deployment exercise; enable deployment on push. Preparing the files does not count as verifying the live pipeline.

## 2. Repository baseline and prerequisites

Verified from source and repository documentation, not a new inspection of the live instance:

| Item | Baseline |
| --- | --- |
| Repository / branch | `Aryan886/Upsolve`, `main` |
| Workflows at planning time | No existing `.github/workflows` files; the implementation now adds deployment and cleanup workflows |
| Production OS | Runbook records Amazon Linux 2023; confirm architecture before building |
| Runtime | `.nvmrc` pins Node 22.23.3; root package pins npm 10.9.9 |
| Capacity | Runbook records approximately 419 MiB usable RAM with swap |
| Application | `cp-notes.service`, `/opt/cp-notes/current`, versioned releases under `/opt/cp-notes/releases` |
| Persistent data | `/var/lib/cp-notes/cp-notes.db`; protected environment at `/etc/cp-notes/app.env` |
| Schema | Current source supports schema 4 and migrates automatically on database open, including `existingOnly` |
| Checks | `npm run check`, `npm run build:release`, `deploy/verify-release.mjs` |
| Backups | SQLite-aware helpers and S3 timer templates exist; documentation records manual restore verification but S3/scheduling still pending |
| Extension | Published store ID `gdfdnapanhndofblljbgfppndhdlioko`; distribution remains separate |
| Extra static asset | The Google verification HTML is now tracked in `website/public` and included in release builds |

Before live enablement, confirm the actual server architecture, Node version, static IP, AWS region and instance ARN, current release/schema, available disk, SSH host key, repository visibility, GitHub environment features, and Actions allowance. Do not assume the historical AWS checklist describes the current server: its original Ubuntu target differs from the recorded Amazon Linux deployment.

## 3. Architecture and key decisions

```text
Pull request -------------------------> checks only
Push to main -> checks -> Linux build -> immutable release + checksum
                                                |
                                      temporary secure SSH access
                                                |
                                  stage and validate on Lightsail
                                                |
                              backup + private off-server upload
                                                |
                                activate -> restart -> health checks
                                                |
                                 GitHub result and release summary
```

| Decision | Choice and reason | Alternative |
| --- | --- | --- |
| Build location | GitHub-hosted runner with a pinned Amazon Linux 2023 build container matching production architecture; install and verify native SQLite there | Building on Lightsail is simpler initially but consumes scarce RAM and extends downtime |
| Runtime deployment | Upload complete, tested files and production dependencies to a new release directory | `git pull` and `npm install` in the active directory can leave a partially updated application |
| Server access | SSH with a dedicated deployment key; use GitHub OIDC to temporarily allow only the runner's IPv4 `/32` in Lightsail | A private overlay network adds another provider; a server polling agent adds recurring state and credentials |
| Automatic scope | Compatible releases on `main`; migrations require an explicit GitHub run | Unconditionally migrating on every push makes recovery much harder |
| Recovery | Restore compatible application code, preserving the live database | Automatic database restoration could discard recent notes and revive old credentials |

The build container is an isolated CI tool, not a change to the production runtime. Use the repository's Node pin and an explicitly recorded container digest, architecture, and compiler prerequisites; do not ship generic Ubuntu or Windows native dependencies without compatibility verification.

Deployment authority is a meaningful trust decision: a writer able to change the trusted deployment branch can deploy code that accesses production data. Protect `main` as far as the repository's GitHub plan allows, keep deployment credentials out of PR jobs, and document who can merge and change workflows. Do not add a new application framework or deployment service.

## 4. Work packages and files

Create files only as each step needs them; keep the workflow declarative and the reusable operations in scripts.

| File | Planned responsibility |
| --- | --- |
| `.github/workflows/deploy.yml` | PR checks, `main` builds, protected deployment, manual deployment/status/recovery entry points |
| `.github/workflows/deploy-cleanup.yml` | Scheduled/manual reconciliation of deployment firewall rules left by interrupted GitHub runs |
| `deploy/build-release.sh` | Reproducible production build, dependency pruning, release metadata, packaging and checksum |
| `deploy/deploy-release.mjs` | Installed server worker: preflight, lock, backup, activation, verification and compatible recovery |
| `deploy/check-release.mjs` | Focused archive/metadata/database-copy checks using existing Node and SQLite tools |
| `deploy/extract-release.py`, `deploy/test_deployment.py` | Safe archive extraction and isolated edge tests |
| `deploy/test-build-release.sh`, `deploy/check-release.test.mjs`, `deploy/deploy-release.test.mjs` | Linux package smoke, database-copy/rollback, and protected-upload tests |
| `deploy/remote-operation.sh`, `deploy/firewall_access.py`, `deploy/reconcile-firewall.py` | SSH transfer/status, temporary access, and abandoned-rule cleanup |
| `deploy/cp-notes-deploy@.service` | Bounded deployment worker that survives an SSH disconnect; fixed installed entry point |
| `deploy/cp-notes-start-deploy`, `deploy/cp-notes-deploy.sudoers` | Validated privilege boundary for the SSH upload account |
| `deploy/verify-release.mjs` | Parameterize expected public build values so the exact production bundle can be exercised against temporary accounts/data |
| `deploy/verify-linux.sh` | Reuse the packaging/verification steps where practical; retain its local isolated verification purpose |
| `deploy/github-*-trust.json`, `deploy/github-*-policy.json`, `deploy/pre-release-backup-policy.json` | Narrow OIDC and private backup permission templates |
| `deploy/AUTOMATIC_DEPLOYMENT.md` | One-time setup and everyday GitHub operations, recovery, credential rotation, and troubleshooting |
| `website/public/googleae6bb7febf88fddb.html` | Version the existing public ownership-verification content so clean builds preserve it |
| `README.md`, `deploy/LIGHTSAIL_RUNBOOK.md`, `deploy/RELEASE_CHECKLIST.md` | Explain the new routine, retain manual recovery, and record actual verification evidence |

Adjust this split if a small check clearly belongs in an existing script. Do not introduce a general deployment framework. Changes to backup helpers are limited to what is needed to reuse upload verification and avoid overlapping backup/deployment operations.

## 5. Phase 1: reproducible release building

- [ ] In a clean checkout at the triggering full commit SHA, install with `npm ci` and run `npm run check`. Keep production `VITE_*` settings out of the development build gate.
- [ ] Build in the matching Amazon Linux environment. Check Node/npm versions, CPU architecture, and that `better-sqlite3` loads with the target runtime.
- [ ] Supply validated public settings for `npm run build:release`: backend HTTPS URL, feedback URL, published extension ID and install URL, and optional public manifest key. The website retains same-origin `/api`.
- [ ] Parameterize `verify-release.mjs` without weakening its origin/permission assertions. Keep all databases, passwords, accounts, ports, and HTTP requests local to the verification environment, even when checking a bundle containing the real public hostname. Never make its test writes against the live site.
- [ ] Run `npm prune --omit=dev`, package the required workspace manifests, compiled outputs and dependency trees, then extract the archive elsewhere and run compiled-release verification there. Preserve npm workspace symlinks whose targets are included in the archive.
- [ ] Include `SOURCE_COMMIT`, a release manifest with the full SHA, build run/attempt, runtime/architecture, schema information and compatibility declaration, plus a generated public `website/dist/release.json` containing only the commit/build identity. Validate schema metadata against a temporary database produced by the compiled candidate; do not derive it by grepping source text.
- [ ] Add the Google verification file with its exact existing public content. Verify it survives a clean Vite build.
- [ ] Package from an explicit allowlist. Exclude `.git`, `.env*`, private configuration, databases, backups, test credentials and verification output. Produce a SHA-256 checksum; retain the archive as a GitHub Actions artifact with a bounded retention period, initially seven days.

Artifacts must identify the tested SHA and run, never an ambiguous `latest` name. A checksum verifies transfer integrity; trust also depends on the protected workflow and authenticated transfer. Do not rebuild the release during activation.

## 6. Phase 2: controlled server deployment

The installed worker and its privileged entry point are root-owned and cannot be replaced by an uploaded release. Accept a strictly validated release identifier and an allowlisted operation, not arbitrary commands or filesystem paths. Run candidate application checks as the existing unprivileged app user, never as root. Give the deployment account only its private upload directory and narrowly defined worker/status permissions.

1. Acquire a server-side `flock` for the entire deployment. Record durable state: candidate SHA/checksum, previous release, operation, stage, backup location and final result. Refuse another activation or rollback while one is running.
2. Validate the upload, manifest, runtime/architecture, available disk and fixed directory boundaries. Reject absolute/archive traversal paths, special files, escaping symlinks and attempts to overwrite existing releases. Allow necessary internal npm workspace links only. Copy validated input into worker-controlled staging before using it so the uploader cannot change it midway.
3. Stage a new immutable release; retain the old one. Read the live database's schema with read-only SQLite access, without constructing `NotesDatabase`. Missing data/configuration is a failure, never permission to initialize a new diary.
4. While the old app is running, create a consistent local backup for candidate preflight. On a private copy, exercise native dependency loading, candidate migrations, integrity/foreign-key checks and preservation of existing IDs, relationships and data. Keep copies on the server with restricted permissions; do not upload production data to GitHub.
5. Reject an unattended release if the copy's schema changes, a configuration/runtime change is required, or rollback compatibility is not established. Compare the declared metadata with observed behavior. Matching schema numbers alone are insufficient: review semantic changes, and test the previous binary against a disposable candidate-upgraded copy. Do not rely solely on a manually asserted `rollbackSafe` flag.
6. Remember the backup timer's original state, pause it, and wait with a timeout for any running backup to finish. Stop the app gracefully. Create the final pre-release SQLite-aware backup using the active release, verify integrity and foreign keys, upload it to the private pre-release S3 prefix, and verify remote integrity. This stopped-app backup is the recovery point; the earlier online copy is only preflight evidence.
7. For an explicitly authorized migration, also restore the final backup into a private isolated copy, verify it with the matching old release, and validate the candidate migration before opening the live database with new code. Do not start a second process against the real database.
8. Atomically switch `current` to the prepared release, reset the service's failed state if necessary, and start `cp-notes.service`. Keep secrets and persistent data outside release directories throughout.
9. With bounded retries, check loopback health and exact JSON shape, public HTTPS health, the release identity, homepage and referenced assets, `/privacy`, Google verification content, and an unauthenticated private API request returning the expected authorization error. A stale homepage returning HTTP 200 is insufficient evidence.
10. Restore the backup timer to its previous enabled/running state, finalize status and provide sanitized results to GitHub. Keep the previous release and its recovery metadata. The implementation retains release directories during this beta and checks free space before staging. Removing old releases automatically would make recovery across schema changes harder to audit; add a separate, reviewed retention step after real release history and disk usage are known. Database-backup retention remains separate.

The worker runs under systemd with a bounded runtime so closing SSH or cancelling GitHub does not kill it halfway through activation. GitHub polls status with timeouts. A disconnected job must say the outcome is unknown until status is reconciled; a rerun checks the existing operation instead of blindly deploying again. An interrupted/rebooted worker leaves an incomplete record that blocks a new activation until status/recovery is resolved.

There is a maintenance window between stopping and verifying the app. Building and uploading happen before it; the final backup upload and restart still take time. Measure actual downtime during rollout rather than promising zero downtime or a fixed number of seconds.

### Failure behavior

| Failure | Required result |
| --- | --- |
| Tests, build, upload or preflight fails | Current app keeps running; candidate never activates |
| Final backup or S3 verification fails | Abort activation; restart the unchanged old app and restore timer state |
| Candidate fails; database/configuration remain compatible | Stop candidate, switch to previous code, restart and verify; report failed deployment even if recovery succeeds |
| Migration occurred or compatibility is uncertain | Stop unsafe activation/recovery, preserve database and backups, report action required; never automatically restore old data |
| Public check fails but loopback succeeds | Record both results; apply the same compatibility rules before recovery, and surface possible DNS/Caddy/network cause |
| SSH/GitHub connection ends | Server worker finishes or records failure; next status operation reconciles its result |
| Server reboots or recovery fails | Detect incomplete operation, preserve evidence, report action required; no blind retry or database initialization |

## 7. Phase 3: GitHub workflow and access

- [ ] Run checks for pull requests targeting `main`; grant no production secrets or AWS credentials to PR code. Avoid `pull_request_target` for executing contributions.
- [ ] Run trusted build and deployment jobs on `push` to `main`. Use `needs` so deployment cannot run when verification fails. Keep automatic deployment disabled behind a variable until the supervised rollout passes.
- [ ] Add `workflow_dispatch` for deploy, status and compatible code rollback. A migration run requires an explicit migration option and exact SHA. Rollback selects an already verified installed release; it does not mean running a workflow from an arbitrary old branch.
- [ ] Keep the workflow available on the repository's default branch for manual dispatch, while enforcing `main` as the only deployment source. Confirm the default branch before enabling this UI path. Require selected candidate SHAs to belong to `main` and have the required successful checks.
- [ ] Serialize deployment, recovery and temporary firewall changes using one production concurrency group with `cancel-in-progress: false`. Immediately before deployment, skip a superseded automatic push if it is no longer the current `main` head. Keep the server lock as protection against manual commands too. GitHub concurrency does not guarantee FIFO ordering.
- [ ] Use a `production` environment restricted to `main` when supported. Routine releases need no approval after rollout. Manual migration selection remains explicit; use a reviewer gate where available without making everyday deploys require clicks.
- [ ] Use minimal job permissions, normally `contents: read`; only the trusted access job receives `id-token: write`. Pin external actions to reviewed full commit SHAs. Pass inputs through validated environment values/arguments rather than injecting expressions into shell programs. [GitHub security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
- [ ] Report SHA, previous release, backup verification, timing, activation and recovery status in the Actions summary. Do not print environment files, private keys, private links, database contents or raw private application logs. Use GitHub's existing workflow notification settings; do not add email/Slack infrastructure.

GitHub provides environments and deployment concurrency controls, but available protection features depend on repository visibility and plan; verify them during setup. [GitHub deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)

### Secure connectivity

Standard GitHub runners have changing address ranges; broad GitHub IP allowlisting is unsuitable here. [GitHub runner networking](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

Use a short-lived AWS session obtained through OIDC to read the target instance's firewall state, temporarily add TCP 22 for the validated runner IPv4 `/32`, transfer the release with SSH/SFTP, and remove only that run's added rule. Preserve the existing operator/browser SSH rules, IPv6 rules, and HTTP/HTTPS access. Do not replace the entire firewall ruleset or expose port 3000. Verify OS firewall behavior as well as Lightsail rules.

Scope the role to the exact instance and required firewall actions. Check the actual GitHub OIDC subject format for this repository and production environment; do not blindly copy a branch subject when the job uses an environment. Match audience and repository/environment identity, with deployment branch restrictions. This avoids storing a long-lived AWS access key in GitHub. [GitHub AWS OIDC setup](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)

Lightsail supports instance-scoped open/close-port permissions. The role still grants meaningful firewall authority on that instance; fixed TCP 22 and `/32` behavior must be enforced by the reviewed workflow, not assumed to follow from an instance ARN alone. [Lightsail IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html)

Use cleanup on success/failure/cancellation and a small scheduled reconciliation job for rules left by abrupt runner failure. Record the prior rules and deployment-added CIDR in a run-specific GitHub artifact before opening access; include no credentials and retain it long enough for reconciliation. The cleanup job uses the same concurrency group and may close only a positively identified deployment rule after confirming no active deployment owns it. If existing rules have changed in a way that makes ownership ambiguous, report the conflict instead of removing operator access. Failure to clean up must produce a failed status/actionable result. A temporary firewall rule has no automatic expiry.

Scheduled workflows run from the default branch. If that is not `main`, give the cleanup workflow its own narrowly trusted OIDC identity/role with only the necessary firewall read/close permissions, scoped to the same instance, and `actions: read` for the recorded run metadata. It needs no SSH secret or permission to open ports or deploy code. Do not relax the production environment's `main` restriction to make scheduled cleanup work. Confirm the schedule actually executes, including repository inactivity behavior, and document manual reconciliation from Actions.

Store a dedicated SSH private key in GitHub environment secrets; restrict its server account, disable forwarding/PTY features that are unnecessary, and document rotation/revocation. Pin the server host key from a separately verified operator session. Do not disable host-key checking or trust an unverified `ssh-keyscan` result. No permanent GitHub runner is installed on the production server.

## 8. Phase 4: one-time setup and backup gate

Complete local implementation while account-specific details are pending. Enabling this phase requires the user's authorization for the concrete external changes; this planning request does not provision anything.

| Location | One-time configuration |
| --- | --- |
| GitHub | Workflow/environment, branch restrictions, Actions budget/retention, public build variables, server host/user and pinned host key, deployment SSH secret, AWS region and role ARN |
| AWS IAM | GitHub OIDC provider/trust and narrowly scoped Lightsail firewall role |
| Lightsail | Dedicated upload account, installed worker/unit and restricted privileges, status/lock directories, disk thresholds, verified SSH access |
| Backups | Private encrypted S3 bucket/prefix, scoped server credentials, pre-release retention, daily timer, independent download/restore verification |

Reuse `backend/src/backup.ts`, the existing backup policy/lifecycle templates and timer units. Keep backup credentials on the server, separate from GitHub's firewall role. The pipeline must not receive permission to read the notes backup bucket. For remote verification, check stored size and an explicit SHA-256 checksum, or download to a private server-side check directory and compare; do not assume an S3 ETag is a SHA-256 checksum.

Before enabling unattended deployment, prove an off-server backup can be downloaded and restored independently with its matching release, including login and ownership checks. An S3 upload exit code alone is not a restore exercise. Pre-release backups use a separate prefix and deliberate retention; do not accidentally apply the daily 14-day expiry policy to migration recovery copies.

Check current S3 charges, Actions usage allowance and artifact storage before provisioning/enablement. Keep this within the existing small-server architecture; do not assume CI or storage is unlimited/free. If backup/access setup is unavailable, CI may still validate and build, but deployment remains visibly disabled.

## 9. Verification and acceptance

Use existing Vitest/Supertest tests for app behavior, Node assertions for release checks, and a focused Bash harness for orchestration. Test with temporary directories/databases, fake service/upload commands and no real credentials. Production paths must never be the default target of a test.

| Test | Expected evidence |
| --- | --- |
| Successful compatible update | Exact tested SHA becomes active; existing accounts/notes/session behavior persists |
| Test/build failure | No SSH activation and no production mutation |
| Production archive verification | Extracted artifact starts with production dependencies; native SQLite loads; all required static assets exist |
| Malformed archive or metadata | Traversal, escaping links, wrong architecture/SHA/checksum and missing files rejected before activation |
| Backup/upload failure | No candidate activation; unchanged old app recovers; no false success marker |
| Candidate startup/health failure | Compatible previous release restored and verified; GitHub stays failed |
| Migration | Automatic run refuses before live migration; explicit run tests backup restoration and candidate migration on copies |
| Incompatible rollback | Previous binary never opens the live database; no automatic restore or loss of newer writes |
| Duplicate/concurrent/out-of-order runs | One worker; completed SHA rerun is harmless; old queued pushes do not replace newer releases |
| SSH disconnect, cancellation, timeout/reboot | Durable status, bounded worker, recovery path and firewall cleanup/reconciliation exercised |
| Missing database, bad config or low disk | Clear failure with original release/data retained; no database initialization |
| Timer already disabled or backup in progress | Original timer state preserved; active backup respected |
| Security boundaries | PR cannot obtain deploy access; upload account cannot modify worker/runtime config; host-key mismatch fails closed |
| Public checks | HTTPS health and identity match candidate; `/privacy`, assets and Google verification work; private API remains protected |

Run `bash -n` on new shell scripts, validate workflow syntax with an appropriate workflow checker, run the deployment harness, `npm run check`, and the compiled Linux release exercise in the target build environment. Review the resulting archive, new files and `git diff --check`. Do not claim linting without an actual configured tool.

For the initial real rollout, run manually through GitHub with automation disabled, then verify website login, a published-extension capture, read/edit, two-user isolation, restart persistence, off-server restore and a compatible rollback. Record release SHA, backup verification, actual downtime, GitHub run URL and observed outcomes in the release checklist. Use agreed tester accounts; do not put production login credentials into CI or write into an existing tester's notes automatically.

- [x] Local workflow/worker files, release packaging, and isolated failure tests pass.
- [x] Trusted CI builds and verifies the exact production archive.
- [x] One-time access, credentials and off-server backup gate pass.
- [x] Supervised deployment, compatible recovery, disconnect cleanup and real service failure tests pass.
- [ ] Automatic deployment is enabled for `main`.
- [ ] A subsequent push updates the live site without Lightsail console commands.

## 10. Everyday operation after enablement

**Ordinary update:** push to `main`, open Actions, check the deployment result and active commit. No routine Lightsail terminal work.

**Failed update:** read the summary. It must distinguish never activated, previous release restored, still running, and manual recovery required. Fix and push again only after the previous operation has a known result.

**Migration:** use the explicit GitHub deployment action after reviewing migration/recovery evidence. Normal schema-compatible updates remain automatic. OS, Node, systemd, Caddy and secret changes stay separate reviewed maintenance operations.

**Code rollback:** select a verified compatible installed release in GitHub. Database restoration remains a deliberate recovery operation with an explicit recovery point and potential data loss.

**Extension update:** use the built package through the existing Chrome Web Store process. A successful website/backend deployment does not imply a new store version was submitted or installed.

The final handoff must identify what is implemented locally, what is configured remotely, the last verified live run, and remaining dependencies. Routine updates are complete only when the final push-to-live acceptance check has passed.
