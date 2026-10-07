# CP Notes

A private competitive programming diary for invited testers. The Chrome extension captures patterns, mistakes, snippets, and editorial takeaways from LeetCode, Codeforces, CodeChef, AtCoder, or manually entered problems. The website provides search, a timeline, mistake statistics, editing, and deletion.

The website is running on an Amazon Linux 2023 Lightsail instance at <https://upsolve-aryan.duckdns.org>, and the [extension is published in the Chrome Web Store](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko). Use the [Lightsail runbook](deploy/LIGHTSAIL_RUNBOOK.md) for server maintenance, recovery, invitations, and extension releases. Private encrypted S3 backups and the daily timer are configured; an actual downloaded backup restored independently on October 7. See [deployment and recovery](deploy/README.md), [release checklist](deploy/RELEASE_CHECKLIST.md), and [build plan](AWS_BUILD_PLAN.md).

Website/backend deployment is automatic: commit and push to `main` (or merge a PR), then check [Actions](https://github.com/Aryan886/Upsolve/actions/workflows/deploy.yml). GitHub checks and builds the release, and the server verifies a private backup before activation. The [first automatic main release](https://github.com/Aryan886/Upsolve/actions/runs/37611944810) passed on October 7. Failed-start recovery, cancellation cleanup and repeated compatible rollback passed with stored data unchanged. The live [`/release.json`](https://upsolve-aryan.duckdns.org/release.json) reports the active commit. See the [deployment guide](deploy/AUTOMATIC_DEPLOYMENT.md) and [implementation plan](AUTOMATIC_DEPLOYMENT_PLAN.md) for setup and evidence. Schema migrations use the explicit GitHub action; server maintenance and Chrome Web Store publication remain separate operations.

Invitation-only account setup follows the [invitation links implementation plan](INVITATION_LINKS_PLAN.md). Operators issue private, expiring links; testers choose their own passwords and then use ordinary sign-in. There is no public signup or email delivery service.

The [shared beta signup flow](SHARED_BETA_SIGNUP_PLAN.md) is deployed: one reusable link admits up to 30 new accounts, with the used count preserved across link replacements. The October 3 rollout verified schema 4, backups, restart persistence, and the live signup page with 30 available spots. The first real tester's signup and extension capture remain to be exercised; see the [release evidence](deploy/RELEASE_CHECKLIST.md#shared-beta-lightsail-rollout-2026-10-03).

The website includes a public `/privacy` page, linked from the footer and available without an account or authentication request. Its source is `website/src/pages/PrivacyPage.tsx`. Deploy both the backend route and website build, then verify `/privacy` in a signed-out browser before entering `https://upsolve-aryan.duckdns.org/privacy` in the Chrome Web Store. Local implementation does not make that URL live. Review the policy whenever contact details, providers, data handling, or backup retention change.

## Local setup

Use the pinned Node **22.23.3** and bundled npm **10.9.9** (`.nvmrc`). Linux installations also need Python 3, make, and a C++ compiler for better-sqlite3. Do not copy `node_modules` between Windows and Linux.

```powershell
npm ci
Copy-Item .env.example .env
npm run admin -- init owner@example.com
npm run dev
```

The `init`, `create`, and `reset` commands prompt invisibly for a 12–128 character password. Never pass a password as a command argument. If a populated schema-1 database exists, `init` first creates a consistent pre-migration backup, then assigns its existing records to this explicitly named owner in a transaction. Stop the old backend before running it. The real database is never used by tests.

The API listens on `127.0.0.1:3000`; use the website at `http://localhost:5173`. Vite proxies `/api` to the backend so cookies remain on the website origin. Development also requires authentication. The default database is `backend/data/cp-notes.db`, independent of the current directory. The backend dev/admin scripts explicitly load the root `.env`; production systemd loads its own environment file.

`LOCAL_DEVELOPMENT=true` permits a non-Secure local cookie. It is rejected with `NODE_ENV=production`. The production cookie is Secure, HttpOnly and SameSite=Lax. Cookie writes require the configured website Origin.

If you have already started a fresh development database without an owner, use `create` instead of `init`:

```powershell
npm run admin -- create tester@example.com
npm run admin -- reset tester@example.com
npm run admin -- disable tester@example.com
npm run admin -- benchmark
```

Reset, disable, and password changes revoke all sessions. Disable keeps notes and does not reactivate on reset. There is no public signup or automated email reset.

## Shared beta signup

After initializing the database, issue, inspect, or revoke the shared beta link:

```powershell
npm run admin -- beta-link
npm run admin -- beta-status
npm run admin -- revoke-beta-link
```

`beta-link` prints the private link once. Share it directly with the beta group; no email is sent automatically. Each person enters their own email and a 12–128 character password, then signs in normally on the website and extension. The [published Chrome extension](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko) is linked in onboarding when `VITE_EXTENSION_INSTALL_URL` is set for the website build. Email ownership is not verified; someone with a forwarded link can use an available spot.

The cap is **30 successful accounts created through the shared link**. Existing accounts and individual invitations do not consume these spots. Failed attempts, duplicate emails, and link inspections do not count; disabling an account does not return a spot. Reissuing invalidates the earlier link but retains usage. The default lifetime is seven days; optional `BETA_SIGNUP_HOURS` accepts 1–168 integer hours for newly issued links. `beta-status` never prints the link; if it is lost, issue a replacement. Revocation closes new signup without affecting existing accounts.

The link's `#beta=` fragment is removed from the browser address bar and held only in page memory. Refreshing setup requires reopening the original link. An interrupted signup might have completed: try ordinary sign-in before submitting again. The extension uses the existing login API and does not need a new store release for this feature.

The October 3 production migration to schema 4 used an independently restored SQLite-aware backup. If upgrading another schema-3 database, take and verify such a backup before opening it with schema-4 code. The schema-3 server cannot open schema 4. Follow the [Lightsail runbook](deploy/LIGHTSAIL_RUNBOOK.md#10a-shared-beta-signup-after-the-schema-4-release) for production commands and rollback.

## Invitation commands

After database initialization, issue or revoke an invitation without a password prompt:

```powershell
npm run admin -- invite tester@example.com
npm run admin -- revoke-invite tester@example.com
```

`invite` normalizes the email and prints its expiry and private setup link once after saving only the token hash. Share the link privately with the intended tester; possession authorizes setting up that account and does not verify mailbox ownership. Reissuing replaces the old link. Existing accounts, including disabled accounts, cannot be changed through invitations; use the manual reset procedure instead. Revoking a missing invitation is an informative no-op and never changes accounts or sessions.

Links use `APP_ORIGIN` as their website base and expire after 72 hours by default. Optional `INVITATION_HOURS` accepts integers from 1 to 168; changes affect only newly issued links. Production requires an explicit HTTPS origin. HTTP is allowed only with `LOCAL_DEVELOPMENT=true` and a loopback origin. The npm admin script loads the root `.env`; production commands must explicitly load `/etc/cp-notes/app.env` as shown in the [operator guide](deploy/README.md#invitation-operations).

**Before upgrading an existing schema-2 database, take and independently verify a SQLite-aware pre-migration backup before either the new server or any new admin command opens it.** Both automatically migrate to schema 3, including with `existingOnly`. The schema-2 binary rejects schema 3: rollback requires its matching backup and can lose later writes. Never issue an invitation as the first production upgrade step.

## For invited testers

1. Open your private invitation, choose a 12–128 character password, and confirm it.
2. Sign in to the website with the invited email and your new password.
3. Follow “Start here” to install the extension and sign in there with the same email and password.
4. Open a supported problem, capture a note, then find and edit it in your diary.

Opening a link does not consume it. The website removes the invitation from the address bar and keeps it only for the current page; after a refresh, reopen the original link. If already signed in, sign out explicitly before setting up the invited account, or return to your current diary.

If account setup is interrupted or reports an unavailable link after retrying, try ordinary sign-in with the password you just chose. The account may already have been created. Acceptance is never retried automatically. If sign-in fails, ask the person who invited you for a replacement link or a manual password reset. Keep links and passwords out of feedback and screenshots.

## Development extension

```powershell
npm run dev:extension
```

1. Open `chrome://extensions`, enable Developer mode, and load `extension/dist` unpacked.
2. Copy its actual ID into the root `.env`: `EXTENSION_ORIGINS=chrome-extension://<32-letter-id>`. Restart the backend.
3. Open a supported problem, open the extension, and sign in with your individual account.
4. Check the detected title/URL, enter a note, and save. Review it on the website.

Reload the extension after rebuilding it. Development builds expose a loopback API setting ending in `/api`. Production builds have a fixed HTTPS endpoint and no server-setting UI. Extension tokens use local storage restricted to trusted extension contexts; passwords are never stored.

Unsent drafts are separated by API environment, account, problem page and note type. Open the same page/type to recover a draft. Session expiry preserves it for same-user reauthentication. Successful saves, explicit discard and explicit sign-out clear drafts under their documented scope. Sign-out clears all drafts for that account on that server. Closing a popup during a save leaves a warning to check the diary before resubmitting; writes are never automatically replayed.

## Build and verify

```powershell
npm run check
```

This runs strict typechecking, automated tests and all workspace builds in dependency order. `npm run build` creates development-configured client bundles for local checks. No lint script is configured.

Set `VITE_BACKEND_URL=https://<hostname>/api`, `VITE_FEEDBACK_URL=https://<form>`, and `VITE_EXTENSION_ID=<stable-id>` for a production release. Optional `VITE_EXTENSION_KEY` is the public store manifest key; set `VITE_EXTENSION_INSTALL_URL` to the [published install page](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko) so onboarding links directly to it. All `VITE_*` values are public. Both clients must use the same feedback URL.

```powershell
npm run build:release
npm start
```

Production startup additionally requires the runtime values in [deploy/README.md](deploy/README.md), existing website assets, and an explicitly initialized database outside the release directory. It fails if that database is missing. `npm start` uses compiled JavaScript and does not load `.env` automatically.

For a separate Linux build, native dependency installation, production start/restart and backup-restore check:

```bash
bash deploy/verify-linux.sh /path/to/CP_notes_mvp
```

This uses a temporary copy and test accounts, downloads the pinned official Node binary with a checksum check, installs locked dependencies, builds both release clients with test-only hostnames, prunes development dependencies, and runs `deploy/verify-release.mjs`. It exercises compiled invitation and shared beta CLI commands, acceptance, ordinary login, restart persistence, and independent schema-4 backup restoration. Temporary files are retained for inspection; the script never touches the real notes database. See the checklist for browser/HTTPS/S3 checks that require a deployed environment.

## API and data

Every data route is under `/api` and requires a valid cookie or extension bearer session. Login, invitation setup, and shared beta setup are available before authentication, with the required origin protection:

- `/auth/login`, `/auth/extension-login`, `/auth/me`, `/auth/logout`, `/auth/change-password`
- `POST /auth/invitations/inspect` (`{ token }`) and `POST /auth/invitations/accept` (`{ token, password }`): website-origin-only setup; acceptance returns an email, never a session
- `POST /auth/beta/inspect` (`{ token }`) and `POST /auth/beta/accept` (`{ token, email, password }`): website-origin-only shared beta setup, capped at 30 successful accounts
- `/problems`: create/reuse and search private problem metadata
- `/patterns`, `/mistakes`, `/snippets`, `/editorial`: create, list, edit and delete notes
- `/mistakes/stats` and `/feed`: private aggregates and timeline

JSON retains `{ "data": ..., "meta": ... }` and `{ "error": { "code": ..., "message": ... } }` envelopes. Ownership comes exclusively from the session. `/health` checks database readiness without returning user data. Schema 3 adds hashed, single-use invitations to existing accounts and per-user canonical problem URLs; schema 4 adds the shared beta signup counter and hashed current link. Historical URLs are not bulk rewritten. Invalid invitations and beta links use 400 responses, so they do not expire an existing session.

Deleting a note is permanent; its problem is retained. Do not copy a live WAL database file for backup. Use the SQLite backup command and stopped-app restore procedure in the deployment guide. Restoring an older backup can revive outstanding invitations; revoke or reissue affected links before reopening access. User export, website capture forms, public signup, offline synchronization, sharing, and automatic imports remain deferred.
