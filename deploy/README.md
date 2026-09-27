# AWS beta deployment and operations

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

For existing schema-1 notes, transfer a **consistent** backup into the persistent path with owner `cp-notes`, then run the same `init` command. Stop all old processes that can write this file. It prompts for a hidden password, backs up under `/var/lib/cp-notes/backups/pre-migration-*`, and performs a transactional migration preserving IDs, links and contents. It refuses an already initialized schema-2 database. Upload that pre-migration backup separately under `pre-migration/<release>/`; keep it until the beta's retention decision is recorded.

For accounts after initialization, substitute `create`, `reset`, or `disable` for `init`. Passwords never belong in arguments, environment files, shell history or Vite values. `disable` retains data and revokes sessions; resetting a disabled account does not enable it. The operator handles password reset requests manually. Run `admin.js benchmark` on the actual 1 GB host and record time/RSS under two simultaneous logins. The configured scrypt profile is N=32768, r=8, p=3, with 64 MiB max per job and at most two jobs. It follows an [OWASP scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) using [Node's asynchronous crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback). Do not lower the cost to conceal memory pressure.

Create `/opt/cp-notes/current` pointing to the verified release and start `cp-notes.service`. Check `curl --fail http://127.0.0.1:3000/health`, HTTPS login, extension save and website read/edit. Then enable the service at boot. Record schema compatibility: this release reads/writes **schema 2**; the original app only supports schema 1.

## Repeatable updates and rollback

1. Build a new immutable release and pass the gate before touching `current`.
2. Run a backup and verify its upload marker. Before schema changes, take an additional pre-migration copy with deliberate retention.
3. Stop the app if migrating or replacing the database. Never hold an async operation inside a SQLite transaction. Only the explicit initialization command can assign legacy ownership.
4. Record the old link target. Create a new symlink next to `current`, then atomically replace `current` with `mv -Tf` on Linux. Restart the systemd service.
5. Verify health, login and a real create/read/edit flow. Confirm an existing note remains. Keep the previous release and its schema number. Test reboot and a second release before inviting all testers.
6. A code-only rollback is allowed only if the previous version supports the current schema. Otherwise stop writes, restore a matching backup using the procedure below, and switch to its matching app version. **Restoring loses writes after the backup.** Obtain the owner's decision for that production data loss.

Never use an absent database as a reason to initialize an empty replacement. Production deliberately fails on missing/uninitialized database paths.

## Private S3 backups

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

1. Schedule downtime and explain loss of post-backup writes. Stop **both** app and backup timer; wait for any active backup service to finish. Confirm no process has the database open.
2. Preserve the current database **and adjacent `-wal`/`-shm` files together** in a timestamped quarantine directory. Never leave old WAL files beside a restored database. Do not delete your only recoverable copy.
3. Verify the downloaded file in isolation with `PRAGMA integrity_check` (`ok`) and `PRAGMA foreign_key_check` (no rows), then place it at `/var/lib/cp-notes/cp-notes.db`, owned by `cp-notes:cp-notes`, mode `0600`. Use an atomic rename from a temporary file on the same filesystem after verification.
4. Select a release compatible with the restored schema, start the app, inspect logs, and check health/login/search and the restored note counts and ownership.
5. Old backups can restore old passwords and sessions. Reset affected accounts before reopening access if recovery followed a credential incident. Re-enable the backup timer and verify a new successful upload.

## Monitoring and beta support

Check `journalctl -u cp-notes --since today`, `journalctl -u cp-notes-backup --since yesterday`, `df -h /var/lib/cp-notes`, the last-success timestamp, server memory, account credits and billing alerts. Inspect certificate renewal and OS security-update status periodically. Logs contain error categories and operation context, not note bodies or credentials. Failed saves and backup failures take priority over new features.

Use one external feedback form with: what you tried, what happened, expected behavior, optional contact, release version and optional page context. Do not automatically attach notes/code. Prepare a private tester sheet with first capture, find/edit success, repeat use, installation/login friction and data-loss reports; collect only information needed for this beta. The operator owns deletion requests and must explain the 14-day daily-backup retention plus any deliberately retained migration copies.

See [store listing preparation](STORE_LISTING.md) and [release checklist](RELEASE_CHECKLIST.md). Store review, actual HTTPS, off-server backup upload/restore, reboot/redeploy and the one-to-two-week tester trial are external release steps, not claimed complete by a successful local test run.
