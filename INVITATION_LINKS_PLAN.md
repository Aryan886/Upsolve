# CP Notes: invitation links implementation plan

Status: planned; application implementation and verification have not started.
Prepared: 2026-09-28.
Handoff: Sol should implement this document in the existing repository.

## 1. Objective and scope

Let an operator invite a tester without choosing or communicating their password. The tester opens a private link, chooses a password, signs in, and uses the existing website and extension.

This is an approved extension to [AWS_BUILD_PLAN.md](AWS_BUILD_PLAN.md): account creation may now happen through an operator-issued invitation. Unrestricted public signup, OAuth, passwordless login, automated email delivery/reset, roles, and an admin dashboard remain deferred. Follow [AGENTS.md](AGENTS.md) for implementation and verification standards. Keep all four note types, ownership checks, and existing login/session behavior.

Implement the complete local feature, tests, and operating instructions. Do not provision services, deploy, migrate the real notes database, generate real tester invitations, or send messages as part of this implementation. Those are release/operator actions. No additional provider, package, router, or background service is expected.

## 2. Architecture and decisions

The operator CLI generates a random invitation, stores its hash with the intended email in SQLite, and prints a website link for manual sharing. The website reads that link and asks the API to validate it. The tester submits a new password; the backend hashes it and atomically creates the account and consumes the invitation. The tester then uses the existing login endpoints on the website and extension.

| Decision | Selected behavior and reason |
| --- | --- |
| Account creation | Create the user only when the invitation is accepted. Avoid placeholder passwords, pending-user states, and changes to the existing required password hash. |
| Email binding | The operator specifies one normalized email. Acceptance derives the email from the stored invitation; the client cannot substitute another identity. |
| Link lifetime | Default 72 hours; `INVITATION_HOURS` permits integers from 1 to 168. The stored expiry is authoritative, so later configuration changes do not extend existing invitations. |
| Reissue | One outstanding invitation per email. Issuing another replaces its token and expiry immediately. No list of overlapping valid links. |
| Completion | Show "Account created. Sign in to continue" and prefill the normal login email. Do not automatically sign in. This adds one password entry but reuses the existing session flow and avoids coupling account creation to a second login operation. |
| Delivery | The operator privately shares the generated link. No email provider, mailbox verification claim, or additional infrastructure. |
| Storage | Add a small invitations table in schema 3. Preserve current users, sessions, note IDs, ownership, and links. |

The schema version is the main deployment compatibility decision: today's binary rejects versions above 2. A rollback to that binary after migration needs the matching pre-migration backup and may lose subsequent writes. Do not describe a schema-3 deployment as supporting code-only rollback to schema 2.

Possession of an invitation authorizes creating its specified account. Email binding does not prove mailbox ownership: the operator must deliver it to the intended person. These links are account-setup credentials, never reusable login or password-reset links. Existing accounts, including disabled accounts, cannot be reclaimed or reactivated through invitations.

## 3. Current implementation to reuse

Verify these observations before editing; they describe the repository on the preparation date.

- `backend/src/database.ts`: schema versions 0/1/2, transactional ownership migration, `createUser`, `getUserByEmail`, `createSession`, session revocation, and scoped note operations.
- `backend/src/auth.ts`: asynchronous scrypt, a global limit of two expensive password jobs, `hashToken`, bounded in-memory throttling, website-origin validation, and cookie/bearer separation.
- `backend/src/admin.ts`: hidden-password prompts and `init`, `create`, `reset`, `disable`, and `benchmark`. Its current argument handling prompts for every command other than disable/benchmark; change that deliberately for invitations.
- `backend/src/config.ts`: origin validation and runtime settings. The full runtime reader also checks production database/extension configuration; do not call it indiscriminately from a CLI command that only needs link configuration.
- `backend/src/app.ts`: auth routes are mounted before the data authentication middleware. API responses already use `Cache-Control: no-store`; production responses already include `Referrer-Policy: no-referrer` and a restrictive CSP.
- `shared/src/index.ts`: `EmailSchema`, `PasswordSchema` (12-128 characters), `UserSchema`, and API envelopes.
- `website/src/main.tsx`: React StrictMode entry point. `App.tsx` performs session initialization, clears stale data, broadcasts account changes, and renders onboarding.
- `website/src/api.ts`: request cancellation, timeouts, stale-account protection, and global handling of 401 responses. Invitation invalidity must not become a 401/session-expired event.
- `extension/src/popup.ts`: existing email/password login already works for any normal local account. It needs no invitation protocol or additional permission.

## 4. Operator workflow and configuration

Add these commands alongside the existing ones:

```powershell
npm run admin -- invite tester@example.com
npm run admin -- revoke-invite tester@example.com
```

`invite` must:

1. Validate the email, website origin, and invitation lifetime before any write. Normalize with the existing email schema.
2. Require an existing initialized database. A missing file must not be created; a populated schema-1 database still requires the explicit owner initialization procedure.
3. Reject any email already in `users`, active or disabled, with an operator-facing explanation. Do not reset or change an existing account.
4. Generate 32 random bytes encoded as base64url, yielding a 43-character token. Reuse Node crypto and the existing SHA-256 token-hashing helper; no JWT or custom encryption.
5. In a short write transaction, recheck account absence and insert or replace the invitation for that email. Reissue invalidates the old link.
6. After the write commits, display the normalized email, exact expiry, and link once. Explain that the link is private, and that reissuing replaces it. Do not save plaintext tokens to files or the database. If output fails, fail visibly; the operator can issue a replacement.

`revoke-invite` validates/normalizes the email and deletes only its outstanding invitation. Report whether a row was removed; a missing invitation is an informative no-op. Do not change an account, password, notes, or sessions. Neither invitation command prompts for a password or accepts a password/token argument. Preserve existing command validation and nonzero failures.

Build links only from validated `APP_ORIGIN`, never request headers or arbitrary redirect parameters. Reuse the runtime origin rules through a small shared function in the existing config module if needed. Production requires an explicit HTTPS origin. Permit HTTP only for an explicit local-development configuration with a loopback origin. `INVITATION_HOURS` is an operator setting; the API validates the persisted expiry and does not need its own separate lifetime setting.

Document development `.env` loading and an explicit production command, since the interactive CLI does not inherit systemd's environment:

```bash
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env /opt/cp-notes/current/backend/dist/admin.js invite tester@example.com
```

Use the same invocation with `revoke-invite`. Test the compiled CLI after dev dependencies are pruned. Generating a link must work without `tsx` in a production installation.

## 5. Token transport and website entry

Link format:

```text
https://YOUR_HOSTNAME/#invite=<random-token>
```

Use a URL fragment so the initial website request does not send the token to the server or access logs. The fragment is not secret from JavaScript or the person receiving it. Read it once at website startup, remove it immediately with `history.replaceState`, and keep the token only in memory. Send it only in JSON POST bodies to the two invitation endpoints below. Never put passwords, session tokens, or invitation tokens in query strings, request paths, analytics, error details, or feedback URLs.

The requested invitation link and its one-time operator output are the narrow exceptions needed to deliver this account-setup credential. Do not weaken the repository's general prohibition on exposing secrets in URLs/logs. Keep links out of persistent application logs, source control, screenshots, and test evidence; use synthetic examples in documentation.

Do not parse-and-clear the fragment inside a React state initializer/effect that StrictMode may replay and thereby lose the token. Capture it before the initial render and pass it into the app. Reject malformed tokens and ambiguous duplicate `invite` parameters without echoing their contents. Ordinary page visits and unrelated hashes must keep their existing behavior.

Removing the fragment means reloading during setup loses the in-memory token. Tell the tester to reopen the original invitation if necessary; do not persist the token or password in browser storage to avoid that extra step. Opening or inspecting a link never consumes it, including when a link preview loads the page.

This design applies the random, expiring, single-use credential principles in [OWASP's token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) to new-account invitations; password-reset functionality itself is out of scope. Fragment transport behavior is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment).

## 6. Database schema and transaction boundaries

Add a versioned migration from schema 2 to schema 3 in the existing module:

| Column | Constraint / purpose |
| --- | --- |
| `email` | `TEXT PRIMARY KEY NOT NULL`; normalized intended account email |
| `token_hash` | `TEXT NOT NULL UNIQUE`; hash lookup and token uniqueness |
| `created_at` | `TEXT NOT NULL`; UTC ISO timestamp |
| `expires_at` | `TEXT NOT NULL`; UTC ISO timestamp |

Name the table `invitations`. The email primary key supports replacement/revocation and the unique token-hash index supports lookup. No extra indexes or speculative audit/status fields are required. There is no user foreign key because that user does not exist yet. Delete a row on acceptance or revocation; expired rows are invalid and can be replaced or revoked. A new cleanup job is unnecessary for this operator-controlled beta.

Run DDL and the schema-version update in the same transaction. Fresh databases and explicit legacy-owner initialization must reach schema 3 in sequence. Preserve the existing schema-1 ownership protection and its rollback behavior. Reject versions above 3, retain WAL/foreign keys/busy timeout, and update schema-version tests and startup messages. A failed 2-to-3 migration must leave schema 2 and its data intact; do not rebuild the users or notes tables for this feature.

Add straightforward database methods for issuing, looking up, revoking, and accepting invitations. Keep all SQL here. Lookup returns only an unexpired invitation whose email has no existing user. Issuance rechecks that same absence inside its write transaction, because the CLI and server may use separate SQLite connections.

Acceptance sequence:

1. Validate request, origin, and rate limits; resolve a currently usable invitation before expensive password hashing.
2. Hash the password asynchronously using the existing helper and concurrency bound. Do not keep any SQLite transaction open across this await.
3. Begin a short SQLite write transaction, preferably immediate to serialize competing CLI/API writes predictably. Re-read by the submitted token hash, evaluate expiry using the current time, and recheck that the email is still unused.
4. Create the normal active user with the stored invitation email and password hash, then delete exactly the invitation matching that email and token hash. Require one deletion; otherwise roll back.
5. Commit both changes together and return the email. Any failure must leave neither a partial new account nor a consumed invitation without its account.

Reissue, revocation, expiry, or manual account creation during password hashing must make acceptance fail without modifying another record. Two simultaneous acceptances produce exactly one account and one success. Keep the users email uniqueness constraint as the final safeguard. Map expected conflicts to the generic invitation error; unexpected database failures must remain visible as server errors with safe context.

## 7. API contract

Add invitation schemas/types to `shared/src/index.ts`, next to authentication schemas. Reuse password validation. Use strict request objects so fields such as `email`, `userId`, `active`, and `passwordHash` cannot override server decisions. Bound token input to the expected 43-character base64url form.

| Endpoint | Request body | Success |
| --- | --- | --- |
| `POST /api/auth/invitations/inspect` | `{ token }` | `200 { data: { email, expiresAt } }` |
| `POST /api/auth/invitations/accept` | `{ token, password }` | `201 { data: { email } }` |

These endpoints do not require a login, but both require the configured website Origin, even when a cookie or bearer token is supplied. Extension origins and absent/untrusted origins cannot use them. An invitation is not a session: it grants no access to notes or `/auth/me`. Do not add HTTP invitation-creation/revocation endpoints or a generic registration endpoint.

Return `400` with code `invitation_invalid` and the same helpful message for an unknown, expired, revoked, used, or now-ineligible invitation: "This invitation is invalid or no longer available. Sign in if you already created your account, or ask the person who invited you for a new link." Malformed request shapes/passwords use the existing `validation_error` envelope. Do not disclose account status or an email for invalid tokens. Return 403 for origin failures and 429 for throttling/password-job saturation. Never return password/token hashes, raw input values, or a new session.

Reuse the existing bounded in-memory throttle with separate invitation keys and suitable messages. Start with 40 invitation requests per IP per 15 minutes across inspect/accept and 10 accept attempts per token hash per 15 minutes. Apply IP limiting before route-level schema validation and token lookup, then token limiting before hashing; retain the existing bounded JSON parser. Keep the global two-job scrypt bound shared with login. Do not use raw tokens as rate-limit keys. Tests must confirm the limiter's bounded storage and expiry behavior; this remains a single-process limiter, consistent with deployment.

Inherit API `no-store` and security headers. Acceptance sets no session cookie and never changes or revokes an existing session. An authenticated direct caller still cannot use this flow to change its current identity or modify an existing account.

## 8. Website and extension behavior

Create a focused `website/src/components/InvitationForm.tsx` with colocated tests. Reuse account-card styles and the API helper; keep app-level routing/state minimal.

1. A normal visit renders the existing session/login experience. A visit carrying an invitation initializes the usual session check and offers setup once it is safe to show it.
2. If already signed in, show the current identity and explain that setup requires signing out first, with the existing explicit sign-out action and an option to return to the diary. Do not silently log out or discard the invitation on a failed sign-out. Keep the token only for this page's pending setup.
3. For a signed-out visitor, inspect the invitation and show a loading state, the fixed invited email, labeled password/confirmation controls, and a clear "Create account" action. Do not allow email editing.
4. Match the existing password length policy and use `autoComplete="new-password"`. Check confirmation before submission; the server independently validates the password. Disable duplicate submissions using the existing ref/busy pattern.
5. On confirmed acceptance, clear password fields and the in-memory token, then render the normal login form with the invited email prefilled and a success notice. No automatic login request. On successful login, use `accountChanged` and the existing onboarding checklist.
6. For invalid/expired links, show the generic recovery guidance and a route back to ordinary sign-in. Keep raw tokens out of rendered error messages.
7. Preserve input after definite validation/service failures. An interrupted POST, timeout, cancellation, or gateway failure can mean the account was created even though the browser saw no success. Never automatically replay acceptance. Offer "Sign in with the password you just chose" and explain that a new link can be requested if sign-in fails. A used-link response after retry offers the same recovery path.
8. Ignore stale inspect/accept results after unmount, explicit dismissal, or account changes. Session initialization and broadcasts must not let an old result replace the current user's UI. Expected cancellation can be quiet, but a possibly completed write needs the recovery guidance when the form is still active.

Inspect only after initial session discovery has settled: today's `/auth/me` 401 cancels pending API requests. Test this ordering, StrictMode, and account-change handling rather than launching both requests together. The API uses 400 for invalid invitations so ordinary invitation failures do not trigger the global 401 handler.

Update login/onboarding text so a new tester understands: open the invitation, choose a password, sign in, install the extension, and sign in there with the same email/password. Keep manual reset contact guidance. Make the existing "Start here" checklist visible after the new account's first website login without adding a database preference or tracking feature. The extension requires copy changes only where existing text conflicts; preserve its session format, permissions, storage, drafts, and capture behavior.

## 9. Files and implementation order

Keep changes in existing modules except the invitation form and focused tests/fixtures that provide a meaningful boundary.

| Step | Primary files | Completion condition |
| --- | --- | --- |
| 1. Database | `backend/src/database.ts`, `database.test.ts`; a schema-2 fixture if needed | Fresh/legacy/schema-2 upgrades and invitation lifecycle/transaction tests pass. |
| 2. Operator commands | `backend/src/admin.ts`, `admin.test.ts`, `config.ts`, `config.test.ts`, `.env.example` | Issue, replace, revoke, validate configuration, and preserve existing commands. |
| 3. Shared/API | `shared/src/index.ts`, `index.test.ts`, `backend/src/auth.ts`, `auth.test.ts` or a focused `invitations.test.ts` | Contracts, origin protection, throttling, async races, and failure handling verified. |
| 4. Website | `website/src/main.tsx`, `App.tsx`, `api.ts`, `components/LoginForm.tsx`, new `InvitationForm.tsx`, focused tests; styles only as needed | Full setup and recovery flow works without breaking normal login or stale-account protection. |
| 5. Integration/docs | `backend/src/index.ts`, `README.md`, `deploy/README.md`, `deploy/RELEASE_CHECKLIST.md`, `deploy/verify-release.mjs`, relevant extension copy/tests | Schema claims and operator/tester instructions agree with actual behavior; compiled release exercised. |

Read the relevant tests before editing. Use small named functions and direct parameterized SQL. Do not introduce a generic invitation service, provider interface, routing framework, or unrelated auth refactor. Keep shared code independent of Node crypto, SQLite, browser, and React APIs.

## 10. Required verification

All databases and invitations used in tests must be synthetic and temporary. Never open, reset, migrate, or issue invitations against `backend/data/cp-notes.db` during implementation checks.

| Area | Required observable cases |
| --- | --- |
| Migration | Fresh DB reaches 3; populated schema 2 preserves users, hashes, sessions, all note types, IDs and links; explicit-owner schema 1 still works; missing owner/file and newer version fail; repeated startup is safe; injected migration failure rolls back. |
| CLI | Mixed-case/whitespace email normalization; no password prompt for invite/revoke; default/custom/invalid lifetime; production HTTPS and local loopback validation; no user created by issuance; only hash stored; replacement invalidates old link; revoke/missing revoke; existing/disabled account rejected; compiled command after pruning. |
| API success | Inspect is repeatable without consuming; acceptance creates exactly one normal user with a verifiable password and no session; ordinary website and extension login succeed; invite token fails as cookie/bearer auth. |
| API failure | Missing/malformed token, invalid password, extra identity fields, unknown/revoked/used/expired token including exact expiry; missing/hostile/extension Origin; IP/token throttling and bounded hash jobs; no input echo or sensitive logs. |
| Races/atomicity | Concurrent acceptance; expiry/revoke/reissue/manual account creation while hashing is pending; user-insert/delete failure rolls back; reissue failure preserves prior invitation. Use controlled promises/time or focused DB failure injection, not timing-dependent sleeps. |
| Website | Fragment removed, token survives StrictMode initialization; malformed/duplicate parameters; inspect after session discovery; fixed email; confirmation/duplicate-submit checks; known failure preserves input; uncertain success offers normal login; successful setup clears sensitive state and prefills login. |
| Existing-account UI | Signed-in visitor is not switched silently; failed logout preserves setup; delayed responses cannot overwrite a new account; ordinary login/expiry/password-change behavior still works; refresh requires reopening the link. |
| Privacy/regressions | Two invited users cannot read/search/count/edit/delete/link each other's records; existing ownership tests pass; reset/disable still revoke sessions; extension draft and account isolation unchanged. |
| Operations | Restore a schema-3 backup independently; document that restoring an older backup can revive outstanding invitations and revoke/reissue them when necessary; preserve existing readiness/startup behavior. |

Run focused tests during implementation, then the root gate once the change is ready:

```powershell
npm run build -w @cp-notes/shared
npm test -w @cp-notes/backend
npm test -w @cp-notes/website
npm run check
git diff --check
```

Also run the affected shared/extension tests when working on those files. `npm run check` covers typechecking, tests, and builds; there is no lint script. Install locked dependencies only when needed and use the pinned Node/npm versions for release verification. Do not weaken existing tests or compiler settings.

Extend the temporary Linux release exercise to cover invitation issuance/acceptance, normal login with the resulting account, restart persistence, and schema-3 backup restoration. Use the existing `deploy/verify-linux.sh` workflow when available. Record environmental blockers separately from passing local checks.

Manual browser exercise: use a temporary database and synthetic invited accounts A and B; follow a link in a fresh profile, choose a password, sign in, install/open the extension, capture a note, and find/edit it in the diary. Check invalid/reissued links, a visit while signed in, and an interrupted acceptance response. Verify production headers over HTTPS when a release environment exists. Do not claim browser, Linux, or live-release checks passed unless exercised.

## 11. Documentation, rollout, and handoff criteria

- [ ] Schema 3 and invitation commands/routes/UI are implemented and verified.
- [ ] README and operator guide describe issuing/revoking links, expiry, reissue, private delivery, manual resets, production environment loading, and recovery after an uncertain response.
- [ ] Tester instructions contain only the link/password/install/sign-in steps and support guidance, without backend startup instructions.
- [ ] `.env.example` documents `INVITATION_HOURS=72` as optional and explains that `APP_ORIGIN` is the link base.
- [ ] Schema-version statements, startup output, and release scripts are current; previous dated verification evidence remains historical and new results are recorded separately.
- [ ] Root checks and diff review pass; meaningful failure/race cases and real limitations are reported.
- [ ] Release instructions require a verified SQLite-aware backup before schema-2-to-3 migration. Opening with `existingOnly` still runs migrations, so take that backup before either the new server or new admin CLI opens a real database. Do not silently use an invitation command as the first production upgrade step.
- [ ] Deployments, real-data migration, actual invitation delivery, store distribution, and HTTPS/S3 checks remain visibly pending until separately performed and verified.

Sol's completion report should state what changed, the new operator commands, test results, any pending external verification, and the schema rollback limitation. Mark this plan complete only after the local implementation and applicable checks actually pass.

## 12. Ready-to-use instruction for Sol

> Implement `INVITATION_LINKS_PLAN.md` in this repository. Read `AGENTS.md`, `README.md`, and the relevant portions of `AWS_BUILD_PLAN.md` first, inspect Git status and affected code, then state the approach before editing. Complete the invitation database migration, operator commands, API, website setup flow, meaningful tests, and documentation in the plan's dependency order. Preserve existing authentication, user ownership, and extension drafts. Run focused checks and `npm run check`, review the final diff, and report concrete results and remaining release gates. Use temporary databases; do not touch the real notes database, deploy, issue actual tester links, or send messages. This task is invitation-only onboarding; public signup and email/OAuth services remain out of scope.
