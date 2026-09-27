# CP Notes MVP — Build Spec

## Context

This is a personal tool for logging competitive programming (CP) notes during
and after contests (Codeforces / CodeChef / AtCoder). It has two parts:

1. A **Chrome extension** for fast, low-friction capture while solving problems
   or reviewing a contest.
2. A **website** for reviewing, searching, and analyzing everything that's been
   logged — the "diary."

**This is an MVP for single-user personal use only. There is no auth, no
login, no multi-user support, and none should be built. Do not add user
accounts, sessions, password flows, OAuth, or any authorization layer. One
person (me) will use this from one browser. Skip anything that exists only to
support multiple users or secure the app against other users — it adds no
value here and should not be built in this pass.**

Keep the whole build minimal. Only build what's listed below. Do not add
extra entities, extra pages, settings screens, theming, onboarding, or
"nice to have" features not explicitly requested. If something seems missing,
leave it out rather than guessing — flag it instead.

## Why this shape (for context, not to be re-litigated)

CP notes fail in two ways: transcribing full solutions (busywork, no
learning) or writing nothing (relearn the same mistake five times). The fix
is four small, distinct note types, not one big notebook:

- **Patterns** — one entry per problem *type*, not per problem. trigger →
  core idea → complexity, no code. For in-contest recognition speed.
- **Mistakes** — logged after every contest. The actual root cause, not
  "got WA": misread constraint, missed edge case, wrong approach, ran out
  of time, implementation bug. This log is the highest-value one — it's
  the aggregate view that tells you what to drill.
- **Snippets** — small reusable code (BFS/DFS skeleton, DSU, fast I/O,
  modpow), written once, copied in future contests.
- **Editorial takeaways** — one-liner insight, only for problems you were
  genuinely stuck on.

## Data model

Four note-type tables, all optionally linked to a shared `problems` table.
Use SQLite for the MVP (single file, zero setup, fits single-user local use).

```
problems
  id            (pk)
  name
  url
  platform      (enum: codeforces | codechef | atcoder | other)
  rating        (nullable int)
  contest_id    (nullable text/string)
  tags          (json array of strings, nullable)
  created_at

patterns
  id            (pk)
  trigger       (text)
  core_idea     (text)
  complexity    (text)
  tags          (json array of strings, nullable)
  problem_id    (nullable fk -> problems.id)
  created_at

mistakes
  id            (pk)
  problem_id    (nullable fk -> problems.id)
  contest_id    (nullable text/string)
  root_cause    (enum: misread_constraint | missed_edge_case | wrong_approach
                        | time_management | implementation_bug | other)
  notes         (text, free-form)
  created_at

snippets
  id            (pk)
  name          (text)
  language      (text, e.g. cpp / python / java)
  code          (text, plain — no syntax-check needed)
  tags          (json array of strings, nullable)
  created_at

editorial_takeaways
  id            (pk)
  problem_id    (nullable fk -> problems.id)
  contest_id    (nullable text/string)
  one_liner     (text)
  created_at
```

Notes:
- `problem_id` is nullable everywhere — sometimes a mistake or takeaway
  doesn't cleanly map to a stored problem, and forcing that link isn't worth
  the friction.
- Don't build a separate tags table / join table — a JSON array column is
  fine at this scale.

## Backend (shared by extension + website)

Minimal REST API. Suggested stack: Node + Express + `better-sqlite3` (sync,
simple, no extra process). No auth middleware, no rate limiting, no CORS
lockdown beyond allowing the extension's origin and localhost for the
website dev server.

Endpoints needed (only these):

- `POST /problems` — create or upsert a problem (by url, so re-logging the
  same problem doesn't duplicate it)
- `GET /problems?query=...` — simple search by name/tag, used for linking
- `POST /patterns`, `GET /patterns?query=...`
- `POST /mistakes`, `GET /mistakes?root_cause=...&from=...&to=...`
- `POST /snippets`, `GET /snippets?query=...`
- `POST /editorial`, `GET /editorial?query=...`
- `GET /feed` — combined chronological list across all four tables (for the
  diary/timeline view), paginated, filterable by date range
- `GET /mistakes/stats` — count of mistakes grouped by `root_cause`, for the
  dashboard chart. Optional group-by date bucket (week/month) if trivial to
  add, skip if not.

No update/delete endpoints are required for the MVP unless trivial to add —
if time-boxing, read+create only is fine; note this limitation explicitly in
the README rather than silently omitting it.

## Chrome extension (Manifest V3)

Purpose: capture, not review. Keep the UI to one small popup with four tabs
(Pattern / Mistake / Snippet / Editorial), matching the four tables above.

Must have:
- Detect current site (codeforces.com / codechef.com / atcoder.jp) from the
  active tab URL. If on a recognized problem page, best-effort scrape the
  problem name and URL to prefill the "linked problem" field. If scraping
  fails or the site isn't recognized, just leave problem name/url blank and
  let me type it — don't block submission on this.
- Four simple forms matching the table fields above (skip `id`/`created_at`,
  those are server-assigned).
- Submit button posts directly to the local backend
  (e.g. `http://localhost:3000`). No offline queueing, no local storage
  fallback needed for the MVP — if the backend's down, just show an error
  and let me retry. (This is a deliberate simplification vs. earlier
  discussion — don't build local-first sync logic for this pass.)
- A settings field (or hardcoded constant, whichever is faster to ship) for
  the backend base URL, since it'll point at localhost during dev.

Explicitly skip: options page, icons/branding polish, keyboard shortcuts,
context menus, multi-language support.

## Website

Purpose: review and search, not capture. Plain React (or plain HTML/JS if
faster to scaffold) + fetch calls to the backend. No component library
needed beyond whatever ships fastest.

Pages needed (only these):

1. **Feed / diary view** — chronological list pulling from `GET /feed`.
   Each entry shows its type, a one-line summary, and timestamp. Filter by
   date range and by type. This is the "diary" view.
2. **Mistakes dashboard** — bar chart of `root_cause` counts from
   `GET /mistakes/stats`, plus a plain list below it filterable by
   root_cause. This is the highest-value screen — prioritize it if
   something has to be cut.
3. **Patterns reference** — searchable list (trigger / core idea /
   complexity), search-as-you-type against `GET /patterns?query=`. This
   should feel like quick lookup, not a wiki.
4. **Snippets library** — list with language filter and a copy-to-clipboard
   button per snippet.
5. **Editorial takeaways** — simple searchable list, same pattern as above.

No routing library needed if a simple tab-based single page is faster to
ship. No login screen. No settings screen beyond (optionally) the backend
URL if it's not just hardcoded.

## Explicit non-goals for this pass

- No auth/login/accounts of any kind
- No multi-user support
- No offline sync / local-first queueing
- No update/delete unless trivial
- No analytics beyond the one mistakes chart
- No theming/branding/onboarding
- No deployment/hosting setup — this runs locally (localhost backend,
  extension loaded unpacked, website run via local dev server)

## Deliverables

- `backend/` — Express + SQLite API per the endpoints above
- `extension/` — Manifest V3 Chrome extension per the above
- `website/` — React (or plain HTML/JS) app per the above
- A root `README.md` explaining: how to run the backend locally, how to
  load the unpacked extension in Chrome, how to run the website dev
  server, and a short note on what was explicitly left out (per the
  non-goals list) so it's clear what's a known gap vs. an oversight.

If any requirement here is ambiguous or underspecified, ask for clarifications.