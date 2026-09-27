# CP Notes

CP Notes is a local, single-user competitive programming diary. The Chrome extension captures patterns, mistakes, snippets, and editorial takeaways; the website provides the searchable timeline, mistake statistics, reference lists, and correction tools.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Google Chrome or another Chromium browser that supports Manifest V3

## Install

From the repository root:

```powershell
npm install
```

## Run the backend and website

```powershell
npm run dev
```

This starts:

- API: `http://localhost:3000` (bound to `127.0.0.1` only)
- Website: `http://localhost:5173`

The backend creates its SQLite database at `backend/data/cp-notes.db` on first launch. Set `DATABASE_PATH` or `PORT` before starting the backend if a different database location or port is needed. If the port changes, update the extension's local backend URL as described below.

## Build and load the Chrome extension

In a second terminal, build once:

```powershell
npm run build -w @cp-notes/extension
```

Or rebuild automatically while editing extension files:

```powershell
npm run dev:extension
```

Then load the unpacked extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension/dist` directory.
5. After a rebuild, use the extension card's **Reload** button before reopening the popup.

The popup defaults to `http://localhost:3000`. Its **Backend connection** section can save another `http://localhost` or `http://127.0.0.1` URL and port. This is the only extension setting stored in Chrome; note data is never stored or queued in the extension.

On recognized Codeforces, CodeChef, and AtCoder problem pages, the popup attempts to prefill the canonical URL, title, platform, and contest ID. All problem fields remain editable. A linked problem requires both name and URL; clear both to save the note without a link.

## Production builds and checks

```powershell
npm run build
npm run typecheck
npm test
```

Run the complete release gate with:

```powershell
npm run check
```

## Data backup and reset

Stop the backend before copying or replacing the database so SQLite's WAL files are fully reconciled.

- Backup: copy `backend/data/cp-notes.db` somewhere safe while the backend is stopped.
- Reset: stop the backend, remove `backend/data/cp-notes.db` and any adjacent `-wal`/`-shm` files, then restart it to create an empty database.

Deleting a note from the website is permanent. Its linked problem record is retained so other notes and future captures can continue to reuse it.

## API outline

The backend exposes:

- Problem upsert/search: `POST /problems`, `GET /problems`
- Pattern create/list/edit/delete: `/patterns`
- Mistake create/list/edit/delete and statistics: `/mistakes`, `GET /mistakes/stats`
- Snippet create/list/edit/delete: `/snippets`
- Editorial create/list/edit/delete: `/editorial`
- Combined paginated timeline: `GET /feed`

JSON uses camelCase. Successful responses use `{ "data": ..., "meta": ... }`; failures use `{ "error": { "code": ..., "message": ... } }`.

## Intentional MVP limitations

- No authentication, accounts, sessions, or multi-user isolation
- No offline queue, background sync, or extension-side note storage
- No create-note forms on the website
- No shared problem editing/deletion; website corrections can only relink or unlink a note
- No import/export, automatic orphan cleanup, time-series analytics, theme switching, onboarding, deployment, or hosting configuration
- The backend is intentionally local-only and permits the local website plus Chrome extension origins

These are known product boundaries, not missing setup steps.
