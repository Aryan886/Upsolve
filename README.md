# CP Notes

A private competitive programming diary for invited testers. The Chrome extension captures patterns, mistakes, snippets, and editorial takeaways from LeetCode, Codeforces, CodeChef, AtCoder, or manually entered problems. The website provides search, a timeline, mistake statistics, editing, and deletion.

The AWS beta implementation is local and ready for release verification. **No AWS resources or store listing have been published.** See [deployment and recovery](deploy/README.md), [release checklist](deploy/RELEASE_CHECKLIST.md), and [build plan](AWS_BUILD_PLAN.md).

## Local setup

Use the pinned Node **22.23.3** and bundled npm **10.9.9** (`.nvmrc`). Linux installations also need Python 3, make, and a C++ compiler for better-sqlite3. Do not copy `node_modules` between Windows and Linux.

```powershell
npm ci
Copy-Item .env.example .env
npm run admin -- init owner@example.com
npm run dev
```

The admin command prompts invisibly for a 12?128 character password. Never pass a password as a command argument. If a populated schema-1 database exists, `init` first creates a consistent pre-migration backup, then assigns its existing records to this explicitly named owner in a transaction. Stop the old backend before running it. The real database is never used by tests.

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

Set `VITE_BACKEND_URL=https://<hostname>/api`, `VITE_FEEDBACK_URL=https://<form>`, and `VITE_EXTENSION_ID=<stable-id>` for a production release. Optional `VITE_EXTENSION_KEY` is the public store manifest key; `VITE_EXTENSION_INSTALL_URL` links onboarding to the install page. All `VITE_*` values are public. Both clients must use the same feedback URL.

```powershell
npm run build:release
npm start
```

Production startup additionally requires the runtime values in [deploy/README.md](deploy/README.md), existing website assets, and an explicitly initialized database outside the release directory. It fails if that database is missing. `npm start` uses compiled JavaScript and does not load `.env` automatically.

For a separate Linux build, native dependency installation, production start/restart and backup-restore check:

```bash
bash deploy/verify-linux.sh /path/to/CP_notes_mvp
```

This uses a temporary copy and test accounts, downloads the pinned official Node binary with a checksum check, installs locked dependencies, builds both release clients with test-only hostnames, prunes development dependencies, and runs `deploy/verify-release.mjs`. Temporary files are retained for inspection; the script never touches the real notes database. See the checklist for browser/HTTPS/S3 checks that require a deployed environment.

## API and data

Every data route is under `/api` and requires a valid cookie or extension bearer session:

- `/auth/login`, `/auth/extension-login`, `/auth/me`, `/auth/logout`, `/auth/change-password`
- `/problems`: create/reuse and search private problem metadata
- `/patterns`, `/mistakes`, `/snippets`, `/editorial`: create, list, edit and delete notes
- `/mistakes/stats` and `/feed`: private aggregates and timeline

JSON retains `{ "data": ..., "meta": ... }` and `{ "error": { "code": ..., "message": ... } }` envelopes. Ownership comes exclusively from the session. `/health` checks database readiness without returning user data. Schema 2 supports accounts and per-user canonical problem URLs; historical URLs are not bulk rewritten.

Deleting a note is permanent; its problem is retained. Do not copy a live WAL database file for backup. Use the SQLite backup command and stopped-app restore procedure in the deployment guide. User export, website capture forms, public signup, offline synchronization, sharing, and automatic imports remain deferred.
