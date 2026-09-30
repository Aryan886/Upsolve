# Upsolve: Lightsail deployment and update runbook

Use this guide to update the existing server. It describes the deployment established on September 28, 2026, and includes invitation links in the application version you deploy next. A Git push does not update the running website: the server must build and activate that commit.

**Normal update:** test locally → commit and push → prepare a clean server checkout → stop the app and back up → keep a copy off the server → build and check the new release → switch releases → test the website and extension.

## 1. The setup we deployed

| Item | Current deployment |
| --- | --- |
| Website | <https://upsolve-aryan.duckdns.org> |
| AWS instance | Lightsail, named `upsolve-aryan` |
| Operating system / SSH user | Amazon Linux 2023 / `ec2-user` |
| Source repository / release branch | `https://github.com/Aryan886/Upsolve.git` / `beta` |
| Node / npm | Node `22.23.3`, npm `10.9.9`, installed under `/opt/node` |
| Public entry point | Caddy on TCP 80 and 443, proxying to `127.0.0.1:3000` |
| Application service | `cp-notes.service`, running as the `cp-notes` system user |
| Active release | `/opt/cp-notes/current`, a symlink to a directory under `/opt/cp-notes/releases/` |
| First release | `/opt/cp-notes/releases/beta-1` |
| Database | `/var/lib/cp-notes/cp-notes.db` |
| Database backups | `/var/lib/cp-notes/backups/` |
| Runtime configuration | `/etc/cp-notes/app.env`, owned by `root:cp-notes`, mode `0640` |
| Caddy configuration | `/etc/caddy/Caddyfile` |
| Original source checkout | `/home/ec2-user/cp-notes`; updates below use separate build directories |
| Feedback form | <https://forms.gle/gMguWCkcyMkANWFu9> |
| Original owner's unpacked extension ID | `fckglphbjgnekemeihehbelacnlagfme` |

The initial deployment used an empty production database and the owner account `aryankhade80@gmail.com`. Existing notes on the Windows computer were not imported. The first release used database schema 2; the invitation release upgrades it to schema 3 automatically when the new backend opens it.

The website, HTTPS certificate validation, `/health`, and the Google verification file were checked externally. The owner also reported the website working. S3 backup upload/restoration, automatic backup scheduling, extension store publication, and resolution of Google's phishing warning have **not been confirmed in this deployment record**. Check their actual status before inviting testers; a working website does not confirm them.

The server reported about **419 MiB usable RAM**, with swap enabled. The build plan originally assumed 1 GB. This guide deliberately uses a maintenance window for builds on the current small server. Expect the website to show a gateway error from the stop step until activation. If builds run out of memory, use a separate compatible Amazon Linux build environment of the same architecture; do not upload Windows `node_modules` or weaken password hashing to make a build fit.

### How requests reach the application

```text
Browser / extension
    → upsolve-aryan.duckdns.org (DuckDNS points to the Lightsail address)
    → Lightsail firewall: TCP 80 / 443
    → Caddy: HTTPS certificate and reverse proxy
    → Express: 127.0.0.1:3000
    → SQLite: /var/lib/cp-notes/cp-notes.db
```

Keep the database and configuration outside release folders. Replacing a release must preserve existing notes, accounts, and sessions. Never run `admin init` as an update step, remove the live database, or start a second application process against it.

## 2. One-time checks before using this runbook

Commands marked **Windows PowerShell** run on your computer. Commands marked **Lightsail SSH / Bash** run in the instance's SSH terminal. Do not paste Linux commands into PowerShell.

**Lightsail SSH / Bash:**

```bash
cat /etc/os-release
/opt/node/bin/node --version
/opt/node/bin/npm --version
readlink -f /opt/cp-notes/current
systemctl is-active cp-notes caddy
free -h
df -h / /var/lib/cp-notes
```

The OS should be Amazon Linux 2023. It uses [DNF](https://docs.aws.amazon.com/linux/al2023/ug/package-management.html). The older [general deployment guide](README.md) contains an Ubuntu bootstrap recipe; do not use its `apt`/`build-essential` instructions on this instance. Git, `gcc-c++`, `make`, `python3`, `tar`, and `xz` were installed with DNF. Caddy was installed as `/usr/bin/caddy` with the official systemd service; there is no need to reinstall it for an application update.

In Lightsail Networking, confirm DuckDNS points to an **attached static public IPv4 address**. Do not assume the original address is static just because DNS currently works. Allow TCP 80 and 443, and restrict SSH to your operator access path while retaining Lightsail browser SSH if used. Keep port 3000 closed publicly. If you publish an IPv6 DNS record, also configure and test IPv6 HTTPS access; the recorded 443 rule initially allowed IPv4 only.

The existing `/etc/cp-notes/app.env` should retain these values. Edit with `sudoedit /etc/cp-notes/app.env` only when a setting needs to change; do not overwrite additional settings already present.

```dotenv
NODE_ENV=production
LOCAL_DEVELOPMENT=false
PORT=3000
DATABASE_PATH=/var/lib/cp-notes/cp-notes.db
APP_ORIGIN=https://upsolve-aryan.duckdns.org
EXTENSION_ORIGINS=chrome-extension://fckglphbjgnekemeihehbelacnlagfme
SESSION_DAYS=30
INVITATION_HOURS=72
```

`INVITATION_HOURS` applies to newly issued invitations and accepts 1–168 hours. Keep `EXTENSION_ORIGINS` aligned with the **actual** installed extension IDs. Multiple allowed origins are comma-separated. A store release may have a different ID from the original unpacked build.

### Save the public build settings once

Create the following file once, then update it when the hostname, feedback URL, extension identity, or store link changes. It holds public build settings, never passwords, invitation tokens, or AWS credentials. The subshell stops on errors without closing your SSH session.

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  umask 077
  test ! -e "$HOME/cp-notes-release.env"
  cat > "$HOME/cp-notes-release.env" <<'ENV'
export VITE_BACKEND_URL=https://upsolve-aryan.duckdns.org/api
export VITE_FEEDBACK_URL=https://forms.gle/gMguWCkcyMkANWFu9
export VITE_EXTENSION_ID=fckglphbjgnekemeihehbelacnlagfme
# Add these when the public manifest key and store install link are available:
# export VITE_EXTENSION_KEY='PUBLIC_MANIFEST_KEY_ON_ONE_LINE'
# export VITE_EXTENSION_INSTALL_URL='https://chromewebstore.google.com/detail/ITEM'
ENV
)
```

If this file already exists, inspect/edit it with `nano "$HOME/cp-notes-release.env"` instead of rerunning creation. `VITE_EXTENSION_ID` validates a setting; it does **not** force Chrome to use that ID. A matching public manifest `key` is needed for consistent unpacked IDs across computers. Never include a private signing key in the package. See [Chrome's manifest key guide](https://developer.chrome.com/docs/extensions/reference/manifest/key).

## 3. Each update: test and push from Windows

Finish the intended changes first, including invitation work for the first invitation release. Keep the local development `.env` configured for localhost while running `npm run check`; production `VITE_BACKEND_URL` values can make the development build gate fail.

**Windows PowerShell, in `C:\Users\aryan\Desktop\CP_notes_mvp`:**

```powershell
Set-Location C:\Users\aryan\Desktop\CP_notes_mvp
git status --short
git diff --check
npm run check
if ($LASTEXITCODE -ne 0) { throw "Checks failed. Do not deploy." }
```

Use `npm ci` first if dependencies/lockfile changed or the checkout has not been installed. Review the changes and commit only files that belong to the finished update. In the commands below, replace `PATH_TO_CHANGED_FILE` and the commit message; repeat `git add` for other intended files. Never stage `.env`, database files, backups, or private keys.

```powershell
git add -- PATH_TO_CHANGED_FILE
git diff --cached --check
git diff --cached
git commit -m "Describe the completed update"
git push origin beta
if ($LASTEXITCODE -ne 0) { throw "Push failed. Stop here." }
git rev-parse HEAD
```

Copy the full 40-character commit hash from the last command. Deploy this specific tested commit, not whatever happens to be newest later. These instructions use the existing `beta` branch; if you intentionally change the release branch, update both the push and clone commands.

## 4. Prepare the new checkout on Lightsail

Replace `PASTE_FULL_COMMIT_HASH` below. Keep one update in progress at a time. This block creates a private deployment state file so later steps still work if SSH reconnects; it does not change the active release. Do not rerun it halfway through an update, because it replaces that state file.

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  umask 077
  RELEASE_COMMIT='PASTE_FULL_COMMIT_HASH'
  [[ "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
  test -f "$HOME/cp-notes-release.env"
  PREVIOUS_RELEASE=$(readlink -f /opt/cp-notes/current)
  [[ "$PREVIOUS_RELEASE" == /opt/cp-notes/releases/* ]]
  test -f "$PREVIOUS_RELEASE/backend/dist/index.js"
  RELEASE_NAME="$(date -u +%Y%m%d-%H%M%S)-${RELEASE_COMMIT:0:12}"
  SOURCE_DIRECTORY="$HOME/cp-notes-builds/$RELEASE_NAME"
  RELEASE_DIRECTORY="/opt/cp-notes/releases/$RELEASE_NAME"
  mkdir -p "$HOME/cp-notes-builds" "$HOME/cp-notes-deploy-history"
  test ! -e "$SOURCE_DIRECTORY"
  sudo test ! -e "$RELEASE_DIRECTORY"
  git clone --no-checkout --single-branch --branch beta \
    https://github.com/Aryan886/Upsolve.git "$SOURCE_DIRECTORY"
  git -C "$SOURCE_DIRECTORY" checkout --detach "$RELEASE_COMMIT"
  git -C "$SOURCE_DIRECTORY" merge-base --is-ancestor "$RELEASE_COMMIT" origin/beta
  printf 'RELEASE_COMMIT=%q\nRELEASE_NAME=%q\nSOURCE_DIRECTORY=%q\nRELEASE_DIRECTORY=%q\nPREVIOUS_RELEASE=%q\n' \
    "$RELEASE_COMMIT" "$RELEASE_NAME" "$SOURCE_DIRECTORY" \
    "$RELEASE_DIRECTORY" "$PREVIOUS_RELEASE" > "$HOME/cp-notes-deploy.env"
  printf 'Prepared commit %s\nNew release: %s\nCurrent release: %s\n' \
    "$RELEASE_COMMIT" "$RELEASE_DIRECTORY" "$PREVIOUS_RELEASE"
)
```

If the repository becomes private, configure authenticated Git access with your normal credential mechanism. Do not put a token into the repository URL or paste it into this document.

## 5. Start maintenance and make a verified backup

Tell active testers to finish saving first. **Downtime starts here.** Stop any configured backup timer, allow its running job to finish, then stop the app. The backup below uses the old release's SQLite-aware backup function, checks integrity and foreign keys, and never initializes/migrates the live database.

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  test "$(readlink -f /opt/cp-notes/current)" = "$PREVIOUS_RELEASE"
  BACKUP_TIMER_WAS_ACTIVE=false
  if systemctl is-active --quiet cp-notes-backup.timer; then
    BACKUP_TIMER_WAS_ACTIVE=true
    sudo systemctl stop cp-notes-backup.timer
  fi
  printf 'BACKUP_TIMER_WAS_ACTIVE=%q\n' "$BACKUP_TIMER_WAS_ACTIVE" >> "$HOME/cp-notes-deploy.env"
  if systemctl cat cp-notes-backup.service > /dev/null 2>&1; then
    while true; do
      backup_state=$(systemctl show cp-notes-backup.service --property=ActiveState --value)
      case "$backup_state" in
        activating|active|deactivating)
          printf 'Waiting for the existing backup job to finish...\n'
          sleep 5
          ;;
        *) break ;;
      esac
    done
  else
    printf 'Backup service is not installed; making the manual pre-release backup below.\n'
  fi
  sudo systemctl stop cp-notes
  if systemctl is-active --quiet cp-notes; then
    printf 'Application did not stop. Do not continue.\n' >&2
    exit 1
  fi
  BACKUP_FILE=$(sudo -u cp-notes env PREVIOUS_RELEASE="$PREVIOUS_RELEASE" \
    /opt/node/bin/node --input-type=module <<'NODE'
const { createBackup } = await import(`${process.env.PREVIOUS_RELEASE}/backend/dist/backup.js`);
const path = await createBackup("/var/lib/cp-notes/cp-notes.db", "/var/lib/cp-notes/backups", "pre-release");
console.log(path);
NODE
  )
  sudo test -s "$BACKUP_FILE"
  printf 'BACKUP_FILE=%q\n' "$BACKUP_FILE" >> "$HOME/cp-notes-deploy.env"
  install -d -m 700 "$HOME/cp-notes-private-backups"
  sudo install -o ec2-user -g ec2-user -m 600 "$BACKUP_FILE" \
    "$HOME/cp-notes-private-backups/$(basename "$BACKUP_FILE")"
  sha256sum "$HOME/cp-notes-private-backups/$(basename "$BACKUP_FILE")"
)
```

Keep the printed filename and checksum. `pre-release-*` files are intentionally not removed by the daily backup retention job. Do not copy the live `.db` directly: SQLite may have committed data in its WAL file.

### Keep this backup off the server before proceeding

If private S3 is already configured, upload this exact pre-release backup with an operator identity authorized for the chosen backup prefix and verify/download it. The restricted daily uploader in the general guide does not automatically have permission for a pre-release prefix. A `last-success.json` from an earlier daily run is not evidence that this pre-release backup was uploaded.

Until S3 is configured, download the consistent backup to your computer. This uses the instance's SSH private key; obtain the correct key for the instance/region from your Lightsail account if you only used browser SSH before. Keep the key private. Replace both example values below, using the exact backup basename printed above. Your computer must have SSH access through the instance firewall. Verify any first-connection host-key prompt against your instance; do not disable host-key checking.

**Windows PowerShell:**

```powershell
$sshKey = "C:\PATH\TO\YOUR_LIGHTSAIL_KEY.pem"
$backupName = "PASTE_THE_PRE_RELEASE_BACKUP_FILENAME.db"
$backupDirectory = Join-Path $env:USERPROFILE "CP-Notes-private-backups"
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
scp -i $sshKey "ec2-user@upsolve-aryan.duckdns.org:cp-notes-private-backups/$backupName" $backupDirectory
if ($LASTEXITCODE -ne 0) { throw "Backup download failed. Do not deploy." }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupDirectory $backupName)
```

The SHA-256 must match the server's value (letter case does not matter). Store backups outside Git and public/shared folders. This provides a pre-update recovery copy; it does not replace the [daily private S3 backup setup](README.md#private-s3-backups).

If you cannot secure a backup, stop the update and restart the old release using section 9. No new code has touched the live database yet.

## 6. Build, stage, and check the candidate release

The following block installs Linux dependencies in the separate checkout, runs checks, builds production assets, prunes development dependencies, and copies only the release files. It then opens a **copy** of the backup using the new database code. Migration failure stops here without touching the live database.

The public build settings are loaded **after** `npm run check`, because that gate produces development bundles. The final `npm run build:release` replaces them. Do not run the development build again afterward.

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  export PATH="/opt/node/bin:$PATH"
  test "$(readlink -f /opt/cp-notes/current)" = "$PREVIOUS_RELEASE"
  sudo test -s "$BACKUP_FILE"
  sudo test ! -e "$RELEASE_DIRECTORY"
  cd "$SOURCE_DIRECTORY"
  test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
  unset NODE_ENV DATABASE_PATH APP_ORIGIN EXTENSION_ORIGINS LOCAL_DEVELOPMENT
  unset VITE_BACKEND_URL VITE_FEEDBACK_URL VITE_EXTENSION_ID VITE_EXTENSION_KEY
  unset VITE_EXTENSION_INSTALL_URL VITE_API_BASE_URL
  npm ci
  npm run check
  source "$HOME/cp-notes-release.env"
  npm run build:release
  npm prune --omit=dev
  node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const manifest = JSON.parse(readFileSync("extension/dist/manifest.json", "utf8"));
assert.deepEqual(manifest.host_permissions, ["https://upsolve-aryan.duckdns.org/*"]);
console.log("Production extension API permission verified.");
NODE
  sudo install -d -o root -g root -m 755 "$RELEASE_DIRECTORY"
  sudo cp -a package.json package-lock.json node_modules deploy "$RELEASE_DIRECTORY/"
  for workspace in shared backend website extension; do
    sudo install -d -o root -g root -m 755 "$RELEASE_DIRECTORY/$workspace"
    sudo cp -a "$workspace/package.json" "$workspace/dist" "$RELEASE_DIRECTORY/$workspace/"
    if [ -d "$workspace/node_modules" ]; then
      sudo cp -a "$workspace/node_modules" "$RELEASE_DIRECTORY/$workspace/"
    fi
  done
  # This file was manually added to beta-1; retain Google ownership verification.
  sudo install -o root -g root -m 644 \
    "$PREVIOUS_RELEASE/website/dist/googleae6bb7febf88fddb.html" \
    "$RELEASE_DIRECTORY/website/dist/googleae6bb7febf88fddb.html"
  printf '%s\n' "$RELEASE_COMMIT" | sudo tee "$RELEASE_DIRECTORY/SOURCE_COMMIT" > /dev/null
  sudo chown -R root:root "$RELEASE_DIRECTORY"
  sudo chmod -R u=rwX,go=rX "$RELEASE_DIRECTORY"
  CHECK_DIRECTORY="/var/lib/cp-notes/deploy-checks/$RELEASE_NAME"
  sudo install -d -o cp-notes -g cp-notes -m 700 "$CHECK_DIRECTORY"
  sudo install -o cp-notes -g cp-notes -m 600 "$BACKUP_FILE" "$CHECK_DIRECTORY/copy.db"
  sudo -u cp-notes env RELEASE_DIRECTORY="$RELEASE_DIRECTORY" \
    CHECK_DATABASE="$CHECK_DIRECTORY/copy.db" \
    /opt/node/bin/node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const release = process.env.RELEASE_DIRECTORY;
const require = createRequire(`${release}/backend/package.json`);
const Database = require("better-sqlite3");
const tables = ["users", "problems", "patterns", "mistakes", "snippets", "editorial_takeaways"];
function inspect() {
  const database = new Database(process.env.CHECK_DATABASE, { readonly: true, fileMustExist: true });
  try {
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    return {
      schema: database.pragma("user_version", { simple: true }),
      counts: tables.map((table) => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    };
  } finally { database.close(); }
}
const before = inspect();
const { NotesDatabase } = await import(`${release}/backend/dist/database.js`);
const database = new NotesDatabase(process.env.CHECK_DATABASE, { existingOnly: true });
try { database.health(); } finally { database.close(); }
const after = inspect();
assert.deepEqual(after.counts, before.counts);
console.log(`Backup-copy migration passed: schema ${before.schema} -> ${after.schema}; account/note counts preserved.`);
NODE
  sudo touch "$RELEASE_DIRECTORY/READY"
  printf 'Candidate ready: %s\n' "$RELEASE_DIRECTORY"
)
```

Stop if any command fails. In particular, do not switch releases after `npm` reports failure or a migration check fails. If staging created a partial release, leave it for diagnosis and use a new release name/checkout for the retry; do not rebuild inside `current`.

This check tests database compatibility and native Linux SQLite loading. It does not prove every production behavior works; section 8 covers the live application. `deploy/verify-release.mjs` currently expects a test-only `notes.example.test` extension build, so do not run it against this production bundle and interpret its hostname assertion as a deployment failure. The isolated [Linux verification workflow](../README.md#build-and-verify) remains available for additional release testing.

## 7. Activate the new release

For the first invitation deployment, startup migrates schema 2 to 3. The original `beta-1` application rejects schema 3. After this step, use the schema-aware rollback instructions below rather than blindly switching back.

If the update adds a runtime setting, update `/etc/cp-notes/app.env` now using the new release's documented values. Keep a private copy of any configuration you change. Ordinary code updates do not require changing Caddy or reinstalling systemd units. A changed unit file requires a separate reviewed installation followed by `sudo systemctl daemon-reload`.

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  sudo test -f "$RELEASE_DIRECTORY/READY"
  test "$(readlink -f /opt/cp-notes/current)" = "$PREVIOUS_RELEASE"
  sudo systemctl stop cp-notes
  NEXT_LINK="/opt/cp-notes/next-$RELEASE_NAME"
  sudo test ! -e "$NEXT_LINK"
  sudo test ! -L "$NEXT_LINK"
  sudo ln -s "$RELEASE_DIRECTORY" "$NEXT_LINK"
  sudo mv -Tf "$NEXT_LINK" /opt/cp-notes/current
  sudo systemctl reset-failed cp-notes
  sudo systemctl start cp-notes
  curl --fail --show-error --retry 10 --retry-connrefused --retry-delay 1 \
    --max-time 10 http://127.0.0.1:3000/health
  curl --fail --show-error --max-time 20 https://upsolve-aryan.duckdns.org/health
  curl --fail --show-error --max-time 20 \
    https://upsolve-aryan.duckdns.org/googleae6bb7febf88fddb.html
  cp "$HOME/cp-notes-deploy.env" "$HOME/cp-notes-deploy-history/$RELEASE_NAME.env"
)
```

Health must return `{"data":{"status":"ok"}}`; the verification URL must return `google-site-verification: googleae6bb7febf88fddb.html`. An initial connection refusal followed by successful retry is normal during startup. A repeated failure is not: inspect the logs and section 9. The first public requests can reach the new release as soon as the service starts, so a later database restore may lose new writes.

## 8. Verify behavior and finish the update

**Lightsail SSH / Bash:**

```bash
readlink -f /opt/cp-notes/current
cat /opt/cp-notes/current/SOURCE_COMMIT
sudo systemctl status cp-notes caddy --no-pager
sudo journalctl -u cp-notes -n 60 --no-pager
free -h
df -h /var/lib/cp-notes
```

Verify in the browser before telling testers the update is complete:

1. Reload the website. Confirm the intended change appears, then sign in and find a note saved before deployment.
2. Save a new note through the production extension, find it on the website, and edit it. Avoid repeatedly retrying a save whose result is unknown.
3. For invitation changes, use the operator flow in section 10 with a dedicated tester address. Open the link in a separate browser profile, choose a password, and sign in on the website and extension. Reusing the accepted link should fail.
4. With two separate accounts, check that each sees only its own notes. For authentication/data changes, also run the relevant direct API isolation checks from the release tests.
5. On the first invitation release, confirm the existing owner's login and old notes still work. Verify password reset/logout behavior when those features change.
6. Resolve any continuing Chrome phishing warning through Search Console; a healthy API and valid HTTPS certificate do not clear that warning.

Restart once to verify persistence, then recheck health and the saved note:

```bash
sudo systemctl restart cp-notes
curl --fail --show-error --retry 10 --retry-connrefused --retry-delay 1 \
  --max-time 10 http://127.0.0.1:3000/health
```

Restore the backup timer only if it was active before this update:

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  if [ "$BACKUP_TIMER_WAS_ACTIVE" = true ]; then
    sudo systemctl start cp-notes-backup.timer
  fi
)
```

If S3 backups are configured, run `sudo systemctl start cp-notes-backup.service` and inspect the service result and `/var/lib/cp-notes/backups/last-success.json` for a **new** successful upload. Keep the previous release, pre-release backup, checksum, and deployment state until the new release and its recovery path are proven. Record commit, date, before/after schema, backup location, verification results, and any remaining issue in your private operating notes.

Do not delete release directories or private backup/check copies casually to free disk space. Check their exact paths and which release `current` points to first. Backup copies contain private notes even when created only for migration checking. No cleanup command is part of the update procedure.

## 9. When an update fails

### Failure before switching `current`

If installation, build, or copy-migration checking failed, the old release and live database are unchanged. This block refuses to run if activation has already changed `current`.

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  test "$(readlink -f /opt/cp-notes/current)" = "$PREVIOUS_RELEASE"
  sudo systemctl start cp-notes
  curl --fail --show-error --retry 10 --retry-connrefused --retry-delay 1 \
    --max-time 10 http://127.0.0.1:3000/health
  if [ "${BACKUP_TIMER_WAS_ACTIVE:-false}" = true ]; then
    sudo systemctl start cp-notes-backup.timer
  fi
)
```

### Failure after switching: code-only rollback

First inspect `sudo journalctl -u cp-notes -n 100 --no-pager`. Confirm the previous release supports the current database and any changed environment settings. Matching schema numbers are necessary for the conservative rollback below, but also review any release-specific data/behavior changes. Restore compatible runtime settings if you changed them.

This block checks schema numbers using read-only SQLite access; it does not open the live database through the old application constructor or try to downgrade it. It refuses rollback across a schema change.

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  test "$(readlink -f /opt/cp-notes/current)" = "$RELEASE_DIRECTORY"
  sudo -u cp-notes env RELEASE_DIRECTORY="$RELEASE_DIRECTORY" BACKUP_FILE="$BACKUP_FILE" \
    /opt/node/bin/node --input-type=module <<'NODE'
import { createRequire } from "node:module";
const require = createRequire(`${process.env.RELEASE_DIRECTORY}/backend/package.json`);
const Database = require("better-sqlite3");
function schema(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try { return database.pragma("user_version", { simple: true }); }
  finally { database.close(); }
}
const before = schema(process.env.BACKUP_FILE);
const current = schema("/var/lib/cp-notes/cp-notes.db");
if (before !== current) throw new Error(`Schema changed ${before} -> ${current}. Stop: use the restore procedure, not a code-only rollback.`);
console.log(`Schema ${current} matches the pre-release backup.`);
NODE
  sudo systemctl stop cp-notes
  ROLLBACK_LINK="/opt/cp-notes/rollback-$RELEASE_NAME"
  sudo test ! -e "$ROLLBACK_LINK"
  sudo test ! -L "$ROLLBACK_LINK"
  sudo ln -s "$PREVIOUS_RELEASE" "$ROLLBACK_LINK"
  sudo mv -Tf "$ROLLBACK_LINK" /opt/cp-notes/current
  sudo systemctl reset-failed cp-notes
  sudo systemctl start cp-notes
  curl --fail --show-error --retry 10 --retry-connrefused --retry-delay 1 \
    --max-time 10 http://127.0.0.1:3000/health
  if [ "$BACKUP_TIMER_WAS_ACTIVE" = true ]; then
    sudo systemctl start cp-notes-backup.timer
  fi
)
```

Recheck public HTTPS, login, and notes after rollback. Website/backend rollback does not roll back extension packages already installed on testers' computers.

### Schema changed, including the first invitation release

Schema 3 cannot be opened by the original schema-2 beta. Prefer fixing the new release forward when practical. If restoring is necessary, explicitly choose the acceptable recovery point: restoring the pre-release backup discards notes/accounts/invitations created or changed afterward and can restore old sessions/passwords.

Follow [production restore](README.md#restore-exercise-and-production-restore): stop the app and backup timer, wait for active backup jobs, preserve the current database **together with its WAL/SHM files** in a private quarantine directory, verify the backup, and restore with `cp-notes:cp-notes` ownership and mode `0600`. Switch to the matching old release before starting. Never overlay a restored `.db` while leaving unrelated old `-wal`/`-shm` files beside it. Verify login, notes, isolation, and a new backup before reopening tester access. Do not run `init` or manually lower `PRAGMA user_version` to bypass compatibility checks.

## 10. Invite testers after deploying the invitation release

Run compiled operator commands from the active release. Supplying `--env-file` loads the same settings that systemd supplies to the website, including the HTTPS origin and invitation lifetime. No password is needed to create an invitation.

**Lightsail SSH / Bash; replace the example email:**

```bash
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env \
  /opt/cp-notes/current/backend/dist/admin.js invite tester@example.com
```

Privately send the printed setup link to that tester. They choose their password, then sign in to the website and extension. Links expire after 72 hours by default, are single-use, and issuing another for the same email replaces the old invitation. Creating an invitation does not send an email automatically. Treat the entire `#invite=...` link as a credential; do not put it in Git, screenshots, public feedback forms, or logs.

Other operator actions:

```bash
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env \
  /opt/cp-notes/current/backend/dist/admin.js revoke-invite tester@example.com

sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env \
  /opt/cp-notes/current/backend/dist/admin.js reset tester@example.com

sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env \
  /opt/cp-notes/current/backend/dist/admin.js disable tester@example.com
```

`reset` prompts for a hidden password; it and `disable` revoke sessions. An existing account uses reset rather than an invitation; resetting does not re-enable a disabled account. If the active CLI reports that `invite` is unknown, the server still runs an older release: deploy the invitation commit first. Running a new admin CLI against the old live database can itself trigger migration, so only use the active deployed version.

## 11. Extension releases are separate from website updates

| Change | Deployment action |
| --- | --- |
| Website/backend only, compatible API | Run sections 3–8; existing extensions keep working |
| Extension UI, capture, permissions, or API client | Build and distribute a new extension package as well |
| Shared request/response contract | Keep the server compatible with installed extensions during rollout; release the compatible server before clients |
| Hostname or extension identity | Update build settings and server allowed origins, test, rebuild, and redistribute |
| Runtime environment only | Edit `/etc/cp-notes/app.env`, restart `cp-notes`, verify; no Vite rebuild unless public build values change |
| Caddy configuration only | Validate the real Caddyfile, then reload Caddy |

Before distributing an extension update, increment `version` in `extension/public/manifest.json` and keep the extension package version consistent through the normal npm lockfile workflow. Commit that change before the release build. Confirm the package uses the hosted API and the intended stable ID. Keeping only the original owner's unpacked ID in the server config will not grant access to differently identified tester installations.

The server build in section 6 already produces the production extension. After checking its identity, package the **contents** of `extension/dist`, with `manifest.json` at the ZIP root:

**Lightsail SSH / Bash:**

```bash
(
  set -euo pipefail
  source "$HOME/cp-notes-deploy.env"
  test "$(readlink -f /opt/cp-notes/current)" = "$RELEASE_DIRECTORY"
  python3 - "$RELEASE_DIRECTORY/extension/dist" "$HOME/cp-notes-extension-$RELEASE_NAME.zip" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
assert (source / "manifest.json").is_file(), "Missing built manifest"
with ZipFile(destination, "x", ZIP_DEFLATED) as archive:
    for file in sorted(source.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(source).as_posix())
print(destination)
PY
)
```

Download the printed ZIP with `scp` using the same SSH key as section 5; it contains only public extension assets. For example, replacing the filename:

**Windows PowerShell:**

```powershell
$sshKey = "C:\PATH\TO\YOUR_LIGHTSAIL_KEY.pem"
$zipName = "cp-notes-extension-PASTE_RELEASE_NAME.zip"
scp -i $sshKey "ec2-user@upsolve-aryan.duckdns.org:$zipName" (Join-Path $env:USERPROFILE "Downloads")
if ($LASTEXITCODE -ne 0) { throw "Extension download failed." }
```

- **Trusted unpacked testers:** extract into their existing extension folder and click **Reload** at `chrome://extensions`. First installation uses Developer mode → Load unpacked → the folder containing `manifest.json`. Keep the folder and public key stable; removing/reinstalling the extension can lose its locally stored drafts/session. Finish or preserve drafts before an update. Updates are manual.
- **Chrome Web Store:** upload the new ZIP to the **existing** store item, update disclosures/screenshots as needed, submit for review, and publish after approval. Do not create a new store item for each update. See [Chrome's update instructions](https://developer.chrome.com/docs/webstore/update) and [our store checklist](STORE_LISTING.md). A website deployment alone does not update installed extensions.

When a store install link is available, add it as `VITE_EXTENSION_INSTALL_URL` in the public build settings and rebuild/redeploy the website. It will appear in the existing onboarding UI. Store review and the website's Safe Browsing review are separate processes.

## 12. Quick troubleshooting

| Symptom | Check / next action |
| --- | --- |
| Website shows old code after Git push | Check `readlink -f /opt/cp-notes/current` and `SOURCE_COMMIT`; push alone does not deploy. Reload the browser after activation. |
| Caddy returns 502 | Check `systemctl status cp-notes`, app logs, and loopback `/health`; maintenance intentionally stops the backend. |
| HTTP works but HTTPS times out | Check Lightsail TCP 443 and DNS/IPv6 routing. Do not expose port 3000. |
| Chrome reports phishing but the certificate is valid | Inspect Search Console Security issues and request a review after investigating. Reinstalling Caddy does not fix a phishing classification. |
| Extension tries localhost | It is a development bundle; rebuild with the production settings and reload/distribute that package. |
| Extension origin/configuration error | Compare its actual ID in `chrome://extensions` with `EXTENSION_ORIGINS`; restart the backend after an intentional config update. |
| `invite` is unknown | Activate the release containing invitation support before using its CLI. |
| Database is missing / schema is too new | Check the persistent path and release compatibility. Restore a verified backup if needed; do not initialize an empty database. |
| Build exits with `Killed` | Inspect memory/swap and kernel OOM messages; restore service using section 9, then build on a compatible Linux environment with enough memory. |
| Google ownership verification disappears | Restore `googleae6bb7febf88fddb.html` into the current `website/dist`; retain it in every future release. |
| Backup timer is absent or last-success is old | Complete the private S3 setup, run a backup, verify its upload and restoration; keep pre-release copies off-server meanwhile. |

Useful read-only diagnostics on Lightsail:

```bash
sudo journalctl -u cp-notes -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
sudo journalctl -k --since today --no-pager
sudo ss -ltnp
systemctl list-timers cp-notes-backup.timer
```

For an intentional Caddy configuration change:

```bash
sudo -u caddy /usr/bin/caddy validate --config /etc/caddy/Caddyfile
# Run reload only after validation succeeds.
sudo systemctl reload caddy
```

For ordinary application updates, leave DNS, the Caddy certificate storage, and firewall rules in place. Schedule OS/runtime upgrades separately, with a backup and compatibility checks. [Caddy renews managed certificates automatically](https://caddyserver.com/docs/automatic-https) while its storage, DNS, and network prerequisites remain available.
