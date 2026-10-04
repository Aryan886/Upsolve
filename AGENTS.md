# AGENTS.md

## Purpose and scope

These instructions apply to the repository and its workspaces. Check for more specific instructions before editing a subdirectory.

Build CP Notes as a small, maintainable product for about 10 invited testers. Prioritize reliable capture, private data, recoverable notes, and useful feedback. Write code another student or developer can understand and change six months later.

- Follow the current user request. A request for a plan or documentation is not a request to implement or deploy the product.
- Read `README.md`, the relevant parts of `AWS_BUILD_PLAN.md`, and the affected code before making changes.
- `AWS_BUILD_PLAN.md` defines the agreed AWS beta scope and implementation sequence.
- `cp-notes-mvp-spec.md` describes the original note types and product behavior. Its original prohibitions on authentication, multiple users, hosting, onboarding, and extension storage are superseded where the AWS beta plan explicitly introduces those features. Full offline sync remains deferred.
- This file defines working standards; it does not replace the build plan's acceptance criteria or authorize unrelated features.
- Verify repository state and implemented behavior directly. Historical statements in the plan or README may be stale.
- Keep the four existing note types and their purposes. Do not collapse them into a generic notebook or expand the product without a requirement.

## Before and during implementation

1. Inspect `git status --short`, existing file structure, relevant tests, and package scripts. Preserve unrelated user changes.
2. Before writing a new feature, state the approach in 3-5 lines: data flow, files affected, and key decisions.
3. Flag tight coupling and decisions that are expensive to reverse, such as schema changes, data ownership, runtime changes, and sync versus async behavior. Briefly name a reasonable alternative and explain the choice.
4. Reuse the existing code and dependencies. Introduce a library or pattern only when there is a clear need, explaining why existing tools are insufficient.
5. Implement in small, reviewable steps using the build plan's dependency order. Complete the requested scope; do not stop after one milestone if the user requested the whole implementation.
6. Resolve routine implementation choices autonomously. Ask only when missing information affects correctness, scope, cost, or an action not already authorized. Continue independent work while a deployment-specific detail is pending.
7. Keep the user informed of meaningful findings, decisions, failures, and verification. Explain behavior and trade-offs in plain language.

## Repository map and conventions

| Location | Responsibility |
| --- | --- |
| `shared/src/index.ts` | Shared types, Zod schemas, platform definitions, URL detection and normalization |
| `backend/src/app.ts` | Express routes, request validation, HTTP responses and error handling |
| `backend/src/database.ts` | SQLite schema, migrations, SQL, transactions and row mapping |
| `backend/src/index.ts` | Runtime configuration, startup and shutdown |
| `website/src/` | React pages, components, hooks and the API client |
| `extension/src/` | Popup interaction, page metadata capture and submission validation |
| `extension/public/manifest.json` | Manifest V3 permissions and extension metadata |
| `deploy/` | Planned Linux/AWS configuration and operating instructions; create only as needed |
| `*.test.ts`, `*.test.tsx` | Tests colocated with the code they exercise |

- Keep npm workspaces, TypeScript, React/Vite, Express, Zod, better-sqlite3, and the existing test tools.
- Use npm and the root `package-lock.json`; do not introduce another package manager.
- Follow nearby formatting: two-space indentation, double quotes, semicolons, and existing file naming.
- Preserve ESM conventions. Backend/shared NodeNext relative imports use `.js` extensions; follow the existing Vite import style in the website and extension.
- Keep shared code independent of Express, SQLite, React, and Chrome APIs.
- Keep SQL in the existing database module and HTTP concerns in the app/auth boundary. Do not introduce repository factories or a new service hierarchy.
- Keep the API's camelCase JSON, success/error envelopes, validation behavior, pagination, and note semantics consistent. Update both clients and tests when intentionally changing a contract.

## Human-readable code

- Use short, descriptive names such as `user`, `userId`, `userCount`, `response`, `result`, `isLoading`, and `handleSubmit`. Avoid cryptic abbreviations and inflated names.
- Functions should normally do one thing and use meaningful verbs: `getUser`, `saveNote`, `validateEmail`. Avoid vague names such as `process` or `handleData`.
- Classes, when justified, should have one responsibility and a simple name. Do not create classes merely to group a few functions.
- Prefer straightforward loops and conditions when they are easier to read than chained transformations or clever expressions.
- Use explicit types where they improve clarity. Preserve strict TypeScript, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`; do not weaken compiler settings to make a change pass.
- Avoid unnecessary generics, complex mapped/conditional types, broad `any`, and casts that hide invalid data. Validate unknown data at boundaries.
- Prefer early returns and clear control flow over deeply nested conditions and try/catch blocks.
- Add comments for a non-obvious reason or constraint, not to narrate obvious code.
- Keep related code together while the file remains readable. Create a new file only for a real responsibility or a meaningful test boundary.
- Keep configuration explicit and validated. Avoid duplicated magic values and environment-specific paths scattered through the app.
- Prefer the readable solution over the shortest solution. Modularity should make real features easier to add and remove, without hypothetical abstractions.

## Correctness and error handling

- Validate external input with existing Zod schemas or focused boundary checks. Client-side validation does not replace server validation.
- Handle empty collections, optional/null values, invalid IDs, malformed URLs, pagination boundaries, and unexpected network responses.
- Do not silently swallow exceptions. Raise or log them with useful context, excluding passwords, credentials, session tokens, cookies, and private note contents.
- Expected cancellation may be handled quietly; unexpected errors must remain visible. Return useful user messages without exposing internals.
- Await or deliberately handle asynchronous work. Consider duplicate clicks, stale responses, account changes, draft-write races, timeouts, and cleanup on unmount/shutdown.
- Do not report success until the save or upload has completed. Preserve unsent input after a failure; do not automatically retry a write whose outcome is unknown.
- After implementation, review the diff for missing validation, unhandled errors, races, broken contracts, and unintended behavior changes.

## SQLite and data ownership

Apply these requirements when implementing the multi-user beta; do not claim the current single-user code already meets them.

- Keep SQLite and direct parameterized SQL. Consider transaction boundaries and query indexes for every schema/query change.
- Use transactions for related writes, especially problem upsert plus note creation and migration/backfill work. Do not hold a synchronous SQLite transaction across an `await`.
- Maintain foreign keys, WAL configuration, the busy timeout, and versioned migrations.
- Add ownership to saved problems and every note table. Derive `userId` from the validated session, never the client body.
- Scope reads, search, list counts, every feed UNION branch, statistics, edits, deletes, and problem linking to the current user. Parenthesize OR search conditions so they cannot bypass ownership filters.
- Use `UNIQUE(user_id, url)` for canonical problems and indexes matching user/filter/order queries. Do not add speculative indexes or a separate search service.
- Verify that linked problems belong to the same user. Another user's record should behave as not found.
- Back up before changing real data. Migrations must preserve IDs, links, contents, and ownership and roll back on failure.
- Require an explicit owner when importing a populated legacy database; never assign it to the first signup/login or a hard-coded user ID.
- Test migrations on temporary databases or copies. Never delete, reset, or alter `backend/data/cp-notes.db` to make tests pass.
- After production initialization, a missing expected database must fail clearly rather than silently create an empty diary.
- Use SQLite-aware backups. Do not copy only a live WAL-mode database file and assume it is a consistent backup.

## Authentication and user privacy

- Follow the plan's manually created individual accounts and SQLite-backed sessions. Defer public signup, OAuth, email infrastructure, and roles unless requested.
- Use standard cryptographic primitives and current password-hashing guidance. Configure and test hashing costs; do not design custom cryptography or store plaintext passwords.
- Use high-entropy opaque session tokens, store their hashes server-side, enforce expiry, and support revocation.
- Use a Secure, HttpOnly, SameSite cookie for the production website and a separate bearer session for the extension.
- Include login throttling and protection against cross-site cookie-authenticated writes. CORS and extension IDs are not authorization.
- Revoke sessions on password reset/change or account disable, as specified in the build plan.
- Restrict extension credential storage to trusted contexts. Never put secrets in frontend bundles, `VITE_*` values, URLs, logs, or source control.
- Clear prior-user UI data on logout/account changes, and prevent a delayed request from repopulating it.
- Test with two distinct users, including direct API requests that bypass the UI. A login form alone does not provide data isolation.

## Website, extension, and LeetCode

- Preserve the existing React component and hook patterns. Do not add a router or state-management library without a demonstrated need.
- Provide clear loading, empty, error, and successful-save states. Use labeled controls and preserve keyboard access.
- Put reusable platform validation and URL normalization in `shared`. Update the TypeScript platform type, exhaustive platform maps, database constraint, dropdowns, scraper, and tests together.
- Detect exact supported LeetCode hosts/routes; normalize problem variants to the planned canonical URL. Preserve existing-site behavior and manual correction.
- Use visible page metadata with title fallbacks. Do not depend on unofficial APIs, fetch premium content, or store third-party site credentials.
- Keep injected scraper functions self-contained: Chrome serializes them, so they cannot rely on imported helpers or closed-over module variables.
- Keep capture user-initiated with activeTab and narrowly scoped API host permissions. Do not add `<all_urls>` for convenience.
- Initialize extension settings and authentication before requests. Production uses the configured HTTPS endpoint; localhost overrides belong to development.
- Isolate sessions and drafts by account and API environment. Persist drafts carefully, retain them through failures, and clear them only under the plan's save/logout/discard rules.
- Treat draft recovery as a small local feature, not an offline synchronization system.
- Keep implementation details out of tester-facing instructions. A tester should not need to know how to start a backend.

## AWS and operating constraints

- Target one Lightsail server with Caddy, one Express process, SQLite on persistent disk, and private off-server backups.
- Keep the database and secrets outside release/static directories. Keep Express on loopback behind Caddy and restrict proxy trust appropriately.
- Validate configuration on startup. Document how environment variables are loaded instead of assuming Node loads environment files.
- Verify production dependencies and native SQLite bindings on Linux. Do not deploy Windows `node_modules`.
- Keep resource choices small and verify current account eligibility, credit expiry, and pricing before provisioning. Budget alerts are not a hard spending cap.
- Do not add RDS, Redis, Cognito, containers/orchestration, load balancers, or NAT gateways solely for hypothetical scale.
- Make backup failures observable and test restoration independently of the live database. A deployment rollback must use a compatible database schema.
- Perform external provisioning, paid upgrades, publishing, and production data changes only within the user's authorization. Do not repeatedly request approval for an already authorized action.
- Complete local implementation, verification, and deployable configuration while waiting on external account/domain details. Distinguish prepared deployment files from a verified live deployment.

## Commands and verification

Run commands from the repository root. Check current package scripts before using them.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies when setup or lockfile changes require it |
| `npm run dev` | Build shared code and start backend plus website |
| `npm run dev:extension` | Build shared code once, then watch/build the extension |
| `npm run build -w @cp-notes/shared` | Refresh shared output before focused workspace checks |
| `npm test -w @cp-notes/backend` | Focused backend tests; substitute shared, website, or extension as appropriate |
| `npm run typecheck` | Root TypeScript checks |
| `npm test` | Tests across workspaces |
| `npm run build` | Build all workspaces |
| `npm run check` | Complete typecheck, test, and build gate |

- For non-trivial logic, add at least a couple of meaningful cases covering normal behavior and failure/edge behavior. Prefer automated tests; use documented manual verification where browser/infrastructure behavior requires it.
- Use Vitest, Supertest, and React Testing Library as appropriate. Keep tests deterministic and use in-memory or temporary SQLite databases.
- Test observable behavior rather than mirroring implementation. Include regression coverage when fixing a bug.
- During development, run relevant focused checks. Before declaring a non-trivial application change complete, run `npm run check`.
- If a check fails, determine whether it was introduced by the change. Fix introduced failures; clearly report pre-existing or environment failures. Do not weaken tests, validation, or compiler settings to obtain a pass.
- No lint script is currently configured. Do not invent a lint command or claim lint ran.
- Documentation-only changes need document/command/link and diff review, not an unnecessary application rebuild.
- For releases, also verify Linux startup, authentication, cross-user isolation, extension capture, restart/redeploy persistence, and backup restoration.
- Do not repeat broad checks after they pass unless subsequent changes or a specific concern justify it.

## Code Review Rules

Flag actionable defects, especially:

- Missing ownership filters, private data appearing in counts/statistics, or cross-user problem links.
- Migration steps that lose data, lack a clear legacy owner, break foreign keys, or cannot roll back safely.
- Credentials exposed in bundles/logs, ineffective session revocation, or browser writes without the required origin protection.
- Draft loss, stale account responses, duplicate writes, or race conditions around saving and clearing state.
- A public API without required authentication, publicly served database/configuration files, or a production database stored inside a replaceable release directory.
- Features marked complete without working behavior and verification evidence.

Explain the concrete failure and its impact. Keep review feedback focused on correctness and the agreed conventions rather than speculative redesign.

## Completion and handoff

- Review `git diff`, new files, and `git diff --check`; remove accidental edits and temporary artifacts without touching unrelated work.
- Update README/configuration examples when setup or behavior changes. Mark build-plan tasks complete only when implemented and verified; keep deployment/review/account dependencies visibly pending.
- Do not edit this file or the build plan merely to weaken a requirement or make incomplete work appear complete. Explain any justified scope change.
- Never commit secrets, databases, backups, or generated dependency folders. Keep dependency and lockfile changes limited to the task.
- Report what changed, why, which checks ran and their outcomes, and any remaining limitation.
- Do not label the product deployed or published until the real deployed behavior or store status has been verified.

