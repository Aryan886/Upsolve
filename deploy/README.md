# AWS beta deployment and operations

**Routine website/backend updates use the [GitHub deployment pipeline](AUTOMATIC_DEPLOYMENT.md) from `main`.** Use the [Lightsail runbook](LIGHTSAIL_RUNBOOK.md) for the actual Amazon Linux 2023 server layout, maintenance, account operations, manual recovery and extension distribution. The Ubuntu setup below is the original bootstrap reference. First-time database initialization applies only to a new database.

## Release dependencies

No paid resources are provisioned by these files. Before provisioning, record the AWS plan, remaining credit balance, Lightsail eligibility, account-plan end date, credit expiry, chosen region, DNS hostname, owner email, feedback form URL and stable extension ID. Check current [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) and [credit terms](https://aws.amazon.com/free/terms/) in the actual account. Billing alerts are not a spending cap. Do not upgrade the account or select a larger instance implicitly.

Use one supported Ubuntu LTS Lightsail host (the plan targets 1 GB RAM with public IPv4), a stable IP, Caddy, one Node process and SQLite on persistent disk. Start in the region closest to testers, subject to account availability. Build away from the live 1 GB instance if installation/building puts memory pressure on it.

## Server setup

1. Attach a stable public IP and point the chosen hostname to it. Allow public TCP 80 and 443; restrict SSH to the operator's source IP/access path. Port 3000 must remain closed publicly, in both Lightsail and the OS firewall.
2. Install security updates, Caddy from its official repository, AWS CLI v2, Python 3 and `build-essential`. Enable unattended security updates. Verify the OS is a supported Ubuntu LTS before using it.
3. Install the official Node 22.23.3 Linux build matching the host architecture, verify its published checksum, and expose its directory as `/opt/node` (`/opt/node/bin/node`, bundled npm 10.9.9). Do not upload Windows dependencies. The verification script currently targets Linux x64; use the appropriate archive and rerun the gate for ARM.
4. Create the service user and persistent directories:

```bash
sudo useradd --system --home /var/lib/cp-notes --shell /usr/sbin/nologin cp-notes
sudo install -d -o root -g root -m 755 /opt/cp-notes/releases
sudo install -d -o cp-notes -g cp-notes -m 700 /var/lib/cp-notes /var/lib/cp-notes/backups
sudo install -d -o root -g cp-notes -m 750 /etc/cp-notes
```

Keep releases owned by the operator/root and readable by the app user. Only `/var/lib/cp-notes` is writable by the app. The systemd unit supplies restrictive permissions, loopback binding, read-only system paths and automatic restart. Avoid multiple app processes against this deployment.

Create `/etc/cp-notes/app.env` as root, mode `0640`, group `cp-notes`:

```dotenv
NODE_ENV=production
LOCAL_DEVELOPMENT=false
PORT=3000
DATABASE_PATH=/var/lib/cp-notes/cp-notes.db
APP_ORIGIN=https://YOUR_HOSTNAME
EXTENSION_ORIGINS=chrome-extension://YOUR_32_LETTER_ID
SESSION_DAYS=30
# Optional operator setting for newly issued invitations (1–168 hours):
# INVITATION_HOURS=72
```

`APP_ORIGIN` has no path or trailing slash. Configure each technical tester's unpacked ID explicitly if no common manifest key exists. CORS and IDs are not authentication. Production Node reads the environment supplied by systemd, not a repository `.env`.

Edit `deploy/Caddyfile` with the real hostname/operator email, copy it to `/etc/caddy/Caddyfile`, run `sudo caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy. Caddy handles [automatic HTTPS](https://caddyserver.com/docs/automatic-https); DNS must resolve and inbound 80/443 must work for certificate issuance/renewal. Express trusts only loopback proxies; keep direct application access unavailable.

Install `cp-notes.service`, `cp-notes-backup.service` and `cp-notes-backup.timer` in `/etc/systemd/system/`, then run `sudo systemctl daemon-reload`. Before enabling them, complete initialization and backup configuration below. Bound journald with a drop-in such as `/etc/systemd/journald.conf.d/cp-notes.conf` containing `[Journal]`, `SystemMaxUse=100M`, `MaxRetentionSec=14day`; restart journald. Review this host-wide setting if the machine runs other services. Avoid request-body/header logging.

## Build and initialize a release

Use the same Linux architecture and compatible OS as the server. In an isolated source checkout, with `/opt/node/bin` first on PATH:

```bash
npm ci
npm run check
export VITE_BACKEND_URL=https://YOUR_HOSTNAME/api
export VITE_FEEDBACK_URL=https://YOUR_FEEDBACK_FORM
export VITE_EXTENSION_ID=YOUR_32_LETTER_ID
# Optional public store key and install URL:
# export VITE_EXTENSION_KEY=PUBLIC_MANIFEST_KEY
# export VITE_EXTENSION_INSTALL_URL=https://chromewebstore.google.com/detail/ITEM
npm run build:release
npm prune --omit=dev
```

`npm run check` uses development settings; unset production VITE values when running that gate. The release build rejects insecure/missing endpoints, feedback configuration and extension ID. If a public manifest key is supplied, ensure it produces the chosen ID. Inspect `extension/dist/manifest.json`: its only API host permission must be the configured HTTPS origin. Do not ship the localhost development build.

Transfer the built release to `/opt/cp-notes/releases/<version>`. Include root/workspace package files, the Linux `node_modules`, `shared/dist`, `backend/dist`, `website/dist`, `extension/dist`, and deployment instructions. Exclude `.env*`, real database files, backups, `.git`, source maps from public directories, and test account credentials. Only `website/dist` is served; repository/configuration/data directories are never static roots.

Before the **first** startup, initialize the database using the compiled operator command in an interactive terminal:

```bash
sudo -u cp-notes env DATABASE_PATH=/var/lib/cp-notes/cp-notes.db /opt/node/bin/node /opt/cp-notes/releases/VERSION/backend/dist/admin.js init owner@example.com
```

For existing schema-1 notes, transfer a **consistent** backup into the persistent path with owner `cp-notes`, then run the same `init` command. Stop all old processes that can write this file. It prompts for a hidden password, backs up under `/var/lib/cp-notes/backups/pre-migration-*`, and performs the sequential ownership/invitation/beta migrations preserving IDs, links and contents. It refuses an already initialized schema-2, schema-3, or schema-4 database. Upload that pre-migration backup separately under `pre-migration/<release>/`; keep it until the beta's retention decision is recorded.

For a schema-2 upgrade, **before the new server or any new admin CLI opens the real file**, stop the old app and create a SQLite-aware pre-migration backup using the previous release's backup workflow. Verify integrity/foreign keys and restore it independently with the matching release, retain it deliberately, and confirm its private off-server copy. Opening with `existingOnly` still applies the schema-3 migration. Do not use `invite` as the first upgrade step. Schema-2-to-3 DDL/version changes are transactional and preserve existing tables; this does not replace the backup requirement.

For accounts after initialization, substitute `create`, `reset`, or `disable` for `init`. Passwords never belong in arguments, environment files, shell history or Vite values. `disable` retains data and revokes sessions; resetting a disabled account does not enable it. The operator handles password reset requests manually. Run `admin.js benchmark` on the actual 1 GB host and record time/RSS under two simultaneous logins. The configured scrypt profile is N=32768, r=8, p=3, with 64 MiB max per job and at most two jobs. It follows an [OWASP scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) using [Node's asynchronous crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback). Do not lower the cost to conceal memory pressure.

Create `/opt/cp-notes/current` pointing to the verified release and start `cp-notes.service`. Check `curl --fail http://127.0.0.1:3000/health`, HTTPS login, extension save and website read/edit. Then enable the service at boot. The shared beta release reads/writes **schema 4**; the preceding invitation release supports at most schema 3. Before any schema-4 server or admin command opens live schema-3 data, take and independently verify a SQLite-aware backup using the [Lightsail runbook](LIGHTSAIL_RUNBOOK.md#10a-shared-beta-signup-after-the-schema-4-release). A code-only rollback to schema 3 is incompatible.

## Invitation operations

After migration/startup verification, issue a private invitation through the compiled CLI. The interactive CLI does not inherit systemd's environment; explicitly load the protected runtime file:

```bash
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env "$(readlink -f /opt/cp-notes/current)/backend/dist/admin.js" invite tester@example.com
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env "$(readlink -f /opt/cp-notes/current)/backend/dist/admin.js" revoke-invite tester@example.com
```

Neither command prompts for a password or accepts an additional password/token argument. The database must already exist and be initialized. `invite` validates and normalizes the email, validates `APP_ORIGIN` and optional `INVITATION_HOURS`, then stores only a SHA-256 hash of a random 32-byte token. The output contains the fixed email, authoritative expiry and `https://YOUR_HOSTNAME/#invite=<random-token>` once, after commit. Keep that output out of persistent logs, tickets, screenshots and source control. Deliver it privately to the intended person: possession permits account setup and is not proof of mailbox ownership.

Default expiry is 72 hours; `INVITATION_HOURS` permits 1–168 integer hours and applies only to new invitations. `APP_ORIGIN` is the link base and production requires HTTPS. Explicit local development permits loopback HTTP only. Reissuing for the same email immediately invalidates the old link; use replacement after output failure. Revoke reports whether an invitation existed, without touching accounts, notes, passwords or sessions. Existing users, including disabled ones, are rejected; handle their password resets with the existing `reset` command and do not reactivate them through invitations.

The tester opens the link, chooses and confirms a 12–128 character password, signs in to the website, follows “Start here” to install the extension, and signs in there with the same credentials. Opening/inspecting a link never consumes it. The fragment is removed immediately and retained only in page memory; refresh requires reopening the original link. A signed-in tester must explicitly sign out or return to the current diary. Public website registration is implemented locally; optional invitation acceptance still does not send email or log in automatically.

If acceptance is interrupted, the account may already exist. Tell the tester to sign in with the password just chosen before requesting another link; do not automatically replay acceptance. Invalid or used links provide the same recovery guidance. If sign-in fails, provide a replacement or the manual reset procedure as appropriate. Invitations cannot access notes or serve as login/reset credentials.

## Public signup and legacy beta operations

The public signup implementation uses `/signup` and `POST /api/auth/signup` without a token or lifetime cap. Backend/website rollout and extension publication are separate, pending steps; see [cutover](LIGHTSAIL_RUNBOOK.md#10b-public-website-signup-cutover). No migration or new runtime settings are required; schema stays 4 and `beta_signup` is historical data. The extension package is prepared as 0.1.2 with the same identity and permissions. The old published extension can still sign in to public accounts even before its signup link is updated.

`admin.js beta-link` returns retirement guidance and never changes the database. `admin.js beta-status` reports historical usage without a token, and `admin.js revoke-beta-link` is retained for authorized cleanup. Run them with the existing `sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env "$(readlink -f /opt/cp-notes/current)/backend/dist/admin.js"` prefix. Old beta bookmarks route to public signup; both beta APIs return website-origin-protected `410 beta_signup_retired` with the public URL. A stale website should refresh and use signup or ordinary login.

At authorized cutover, take the normal SQLite-aware verified backup and revoke the stored beta token without resetting its count or deleting users. Older schema-4 binaries/backups can otherwise revive capped enrollment. Keep public access closed during recovery until restored legacy tokens have been revoked. Rollback should retain current accounts/notes and `/signup`; do not restore old data just to reverse UI changes.

Signup requires the configured website Origin even when credentials are supplied. The process-local throttle allows 20 attempts per IP and 5 per normalized email per 15 minutes, separate from login budgets; two concurrent password jobs are shared with login. Origin headers can be forged by scripts, addresses are unverified, availability remains observable, and distributed account farming is possible. Monitor hash contention, disk growth, backup age/failures and service errors before wider promotion. Email verification, CAPTCHA and automated recovery remain future work. Reset/reassignment requires reliable account ownership evidence; email knowledge alone is insufficient.

## Repeatable updates and rollback

The existing server has a verified GitHub deploy/status/compatible-rollback workflow. The steps below describe manual maintenance and recovery; reconcile active GitHub/worker operations before changing the live release.

1. Build a new immutable release and pass the gate before touching `current`.
2. Run a backup and verify its upload marker. Before schema changes, take an additional pre-migration copy with deliberate retention.
3. Stop the app if migrating or replacing the database. Never hold an async operation inside a SQLite transaction. Only the explicit initialization command can assign legacy ownership.
4. Record the old link target. Create a new symlink next to `current`, then atomically replace `current` with `mv -Tf` on Linux. Restart the systemd service.
5. Verify health, login and a real create/read/edit flow. Confirm an existing note remains. Keep the previous release and its schema number. Test reboot and a second release before inviting all testers.
6. A code-only rollback is allowed only if the previous version supports the current schema. Schema-2 binaries reject schema 3, and schema-3 binaries reject schema 4: stop writes, restore the matching pre-migration backup using the procedure below, and switch to its matching app version. **Restoring loses writes after the backup**, including newly accepted accounts. Obtain the owner's decision for that production data loss and reconcile the shared signup count before reopening registration.

Never use an absent database as a reason to initialize an empty replacement. Production deliberately fails on missing/uninitialized database paths.

## Private S3 backups

The existing server's private Mumbai bucket, scoped upload credentials, 14-day daily lifecycle and enabled backup timer were verified on October 7, including an independent downloaded-backup restore and a visible rejected-upload failure. See [release evidence](RELEASE_CHECKLIST.md#automatic-deployment-rollout-2026-10-07). The setup instructions below apply when configuring another environment.

Create a private bucket in the chosen region with all four Block Public Access settings enabled, bucket-owner-enforced object ownership and default SSE-S3 encryption. Keep versioning disabled for this small beta unless its noncurrent-version retention is also configured. Apply `s3-lifecycle.json` to expire the `daily/` prefix after 14 days. The `pre-migration/` prefix has separate, deliberate retention.

Create a dedicated uploader principal with `backup-policy.json` after replacing `REPLACE_BUCKET`. It can upload only `daily/*` and cannot read/delete/list unrelated objects. Keep recovery and pre-migration upload permissions with the operator. If moving to EC2, use an instance role instead of access keys.

Store uploader credentials outside the repo in `/etc/cp-notes/backup.env`, root-owned `0600`, loaded only by the backup systemd service:

```dotenv
BACKUP_DIRECTORY=/var/lib/cp-notes/backups
BACKUP_S3_URI=s3://YOUR_PRIVATE_BUCKET/daily
AWS_DEFAULT_REGION=YOUR_REGION
AWS_ACCESS_KEY_ID=UPLOADER_KEY
AWS_SECRET_ACCESS_KEY=UPLOADER_SECRET
AWS_EC2_METADATA_DISABLED=true
```

Never put these values into Vite settings. The CLI uses `aws s3 cp --sse AES256`; failures return nonzero. The backup source is opened read-only with `fileMustExist`, copied with SQLite's [online backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise), and finalized only after integrity and foreign-key checks. `backup.lock` prevents overlapping runs, including manual ones. systemd also serializes the oneshot unit. A crash can leave the lock: check that no backup process is running before removing only that stale lock.

```bash
sudo systemctl start cp-notes-backup.service
sudo systemctl status cp-notes-backup.service
sudo cat /var/lib/cp-notes/backups/last-success.json
sudo systemctl enable --now cp-notes-backup.timer
systemctl list-timers cp-notes-backup.timer
```

`last-success.json` advances only after successful upload. The latest three **successfully uploaded** local copies are retained; failed uploads and incomplete files remain visible for operator investigation and disk monitoring. Upload or deliberately dispose of failed copies after diagnosis. The service logs failures; an operator must check the timer/marker daily. Daily backups permit approximately 24 hours of data loss after total server loss.

## Restore exercise and production restore

First download an uploaded backup with operator credentials into a **separate** restore directory. Do not start the app against the live database during the exercise. Use the matching release and verify both SQLite integrity and foreign keys, login, notes, search, and two-account isolation. The local `verify-release.mjs` exercise verifies these behaviors on a generated backup; an actual S3 download/restore is still a release gate.

For production recovery:

1. Schedule downtime and explain loss of post-backup writes. Keep this site's public ingress blocked or in maintenance mode until credential cleanup and local verification finish. Stop **both** app and backup timer; wait for any active backup service to finish. Confirm no process has the database open.
2. Preserve the current database **and adjacent `-wal`/`-shm` files together** in a timestamped quarantine directory. Never leave old WAL files beside a restored database. Do not delete your only recoverable copy.
3. Verify the downloaded file in isolation with `PRAGMA integrity_check` (`ok`) and `PRAGMA foreign_key_check` (no rows), then place it at `/var/lib/cp-notes/cp-notes.db`, owned by `cp-notes:cp-notes`, mode `0600`. Use an atomic rename from a temporary file on the same filesystem after verification.
4. Select a release compatible with the restored schema. While public access remains closed, use its operator commands to revoke or reissue affected invitations and reset affected accounts if recovery followed a credential incident. Old backups can restore old passwords, sessions and outstanding invitations, including links consumed or revoked after the backup. Restoring an invitation does not extend its original expiry.
5. Start the app with public ingress still closed, inspect logs, and check loopback health/login/search, restored note counts and ownership. Reopen public access only after these checks and credential cleanup pass. Re-enable the backup timer and verify a new successful upload.

## Monitoring and beta support

Check `journalctl -u cp-notes --since today`, `journalctl -u cp-notes-backup --since yesterday`, `df -h /var/lib/cp-notes`, the last-success timestamp, server memory, account credits and billing alerts. Inspect certificate renewal and OS security-update status periodically. Logs contain error categories and operation context, not note bodies or credentials. Failed saves and backup failures take priority over new features.

Use one external feedback form with: what you tried, what happened, expected behavior, optional contact, release version and optional page context. Do not automatically attach notes/code. Prepare a private tester sheet with first capture, find/edit success, repeat use, installation/login friction and data-loss reports; collect only information needed for this beta. The operator owns deletion requests and must explain the 14-day daily-backup retention plus any deliberately retained migration copies.

See [store listing preparation](STORE_LISTING.md) and [release checklist](RELEASE_CHECKLIST.md). Store review, actual HTTPS, off-server backup upload/restore, reboot/redeploy and the one-to-two-week tester trial are external release steps, not claimed complete by a successful local test run.
