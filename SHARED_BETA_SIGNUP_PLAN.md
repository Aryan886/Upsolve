# CP Notes: shared beta signup implementation plan

Prepared: 2026-10-03.
Status: deployed on 2026-10-03; schema-4 migration, backup restoration, restart persistence, and the live signup page are verified. A real tester's complete signup, login, and extension capture remain pending.
Requested scope: one reusable signup link with a maximum of **30 successful beta signups**.

Scope supersession (2026-10-08): [public website signup](EXTENSION_PUBLIC_SIGNUP_PLAN.md) removes referral requirements and the lifetime beta cap, with the extension linking to `/signup`. Local implementation and verification are recorded in the [release checklist](deploy/RELEASE_CHECKLIST.md#public-website-signup-preparation-2026-10-08); live rollout and extension publication remain pending. This supersedes the earlier enrollment restrictions after cutover; schema 4, accounts, sessions, notes and optional invitations remain supported. Earlier dated evidence is retained as history.

## 1. Product behavior and scope

An operator generates one link and shares it with the beta group. Each visitor enters their own email, password, and password confirmation. After account creation, they sign in normally, install the published extension from the website's existing “Start here” section, and sign in to the extension with the same credentials.

Selected cap semantics: 30 new accounts created through this shared beta flow, across the lifetime of this beta. Existing accounts, manual account creation, and individual invitations are outside this counter. This is a signup cap, not a limit of 30 total database users or proof of 30 distinct people. This interpretation follows the shared-link scope; counting existing testers toward a total population limit would require an explicit membership/backfill decision before implementation.

- Only successful, committed account creation uses a spot. Visits, validation errors, failed writes, duplicate emails, and retries do not.
- Replacing, expiring, or revoking a link never resets the count. Disabling or deleting an account does not release a spot.
- At 30 signups, registration closes; existing users can still sign in and use their notes.
- Proposed default expiry: seven days from issue/reissue. Operators can shorten it through validated configuration.
- Possession of the link authorizes signup. Forwarded links work while registration is open. Email ownership is not verified, and one person could use multiple email addresses.
- Keep existing individual invitations and account/session behavior working. This feature does not reset passwords or reactivate disabled accounts.
- No public signup button without a valid shared link, email delivery/verification, OAuth, CAPTCHA, admin dashboard, new infrastructure, or extension release is included.

This document extends the account-creation scope of [AWS_BUILD_PLAN.md](AWS_BUILD_PLAN.md) and [INVITATION_LINKS_PLAN.md](INVITATION_LINKS_PLAN.md). Local implementation is complete; production migration, deployment, link issuance, and distribution remain subsequent work.

## 2. Architecture and trade-offs

The CLI stores a hash of a random shared token in SQLite and prints the link once. The website reads and clears its URL fragment, inspects availability, and submits the token, email, and password. The API validates and hashes the password, then a short transaction creates the account and increments the signup counter. Normal login and onboarding follow.

Reuse Express, Zod, the existing auth helpers, direct SQL in `database.ts`, and the current React patterns. No new dependency or service is needed.

| Decision | Choice and reason |
| --- | --- |
| Separate shared signup | Add focused beta routes and one small table; preserve the existing email-bound invitation contract. Making invitation email nullable would complicate its established single-use behavior. |
| One persistent beta record | Store one beta and rotate its token. Separate counters per issued link could accidentally admit another 30 people on every replacement. |
| Durable counter | Increment only with account creation; avoid counting all users, since owner and manually created accounts are not shared-link signups. A separate membership table is unnecessary for this scope. |
| Explicit login after signup | Reuse the existing flow and uncertain-response recovery. Automatic login would add another write and failure boundary. |
| Separate form | A focused `BetaSignupForm.tsx` keeps editable-email behavior clear and protects existing invitation behavior; reuse styles/API conventions without introducing a generic form framework. |

The expensive-to-reverse decision is **schema 3 → 4**. The current binary rejects schema versions above 3, so a code-only rollback will fail. Prepare and independently verify a pre-migration backup before any new server or admin command opens the production database.

## 3. Data model and transactions

Add a `beta_signup` table in a versioned migration, with one row identified by `id = 1`:

| Column | Constraint / purpose |
| --- | --- |
| `id` | Integer primary key, constrained to 1 |
| `token_hash` | Nullable unique text; SHA-256 hash of the current token; NULL means revoked |
| `max_signups` | Integer, initially 30; database constraint permits 1–30; no public or CLI cap-changing option in this release |
| `signup_count` | Integer, initially 0; constrained between 0 and `max_signups` |
| `created_at` | UTC ISO timestamp of the original beta issuance |
| `expires_at` | UTC ISO timestamp of the current/latest link expiry |

Migration creates the table but no row: registration remains closed until the operator issues a link. Keep users, notes, sessions, and individual invitations untouched. DDL and schema-version advancement run in one transaction. Preserve existing legacy-owner requirements and reject schemas newer than 4.

The primary key and unique token-hash index cover status and token lookups. No user-table scan, user-column backfill, redemption ledger, or additional index is required.

Add readable methods in `backend/src/database.ts` for issuing, inspecting, accepting, reporting status, and revoking beta signup. Issuance inserts the singleton once or updates only its token and expiry; it must retain the original creation time, limit, and count. Reject reissuance when the beta is full. Revocation clears the hash without deleting the row. Status reports not issued/open/expired/revoked/full, used count, maximum, remaining count, and expiry, never the token or hash.

Acceptance sequence:

1. Enforce website origin and rate limits; validate a strict request body and normalize email with `EmailSchema`.
2. Check that the token is current, unexpired, and below its cap before expensive password hashing. Reject existing accounts with the generic account-setup response described below.
3. Await the existing password hash helper outside any SQLite transaction.
4. Begin an immediate write transaction. Recheck token, expiry using the current time, capacity, and email absence; another request or CLI operation may have changed them during hashing.
5. Create the normal user, then conditionally increment `signup_count` for the same token while below the cap. Require exactly one updated row. Roll back both writes on any failure.
6. Commit and return only the normalized email. Set no session cookie and return no session token.

Two requests competing for the last spot must produce one account and one success. Two requests for the same email must consume only one spot. Token rotation/revocation during hashing prevents acceptance with the old token. Preserve and log unexpected errors with safe context; never turn arbitrary database failures into “link unavailable.”

## 4. CLI and configuration

Operator commands:

```powershell
npm run admin -- beta-link
npm run admin -- beta-status
npm run admin -- revoke-beta-link
```

- `beta-link`: issue or replace the link; print it once after commit, plus expiry and usage (for example, `12 / 30 signups`). Clearly state that replacement invalidates the old link and preserves usage.
- `beta-status`: report usage and registration state without printing credentials. It cannot recover the original link; replace a lost link.
- `revoke-beta-link`: close registration immediately while retaining usage. Repeated revocation or no existing beta is an informative no-op. A later `beta-link` can reopen only remaining capacity.
- None accept email, password, token, or count arguments. Refactor CLI argument validation explicitly so existing commands retain their exact argument rules.
- Reuse 32 random bytes encoded as base64url, `hashToken`, the existing output-failure handling, and origin validation. A failed output after commit reports that the operator should issue a replacement; it must not silently succeed.
- Require an existing initialized database. All commands that open `NotesDatabase`, including status, may migrate an older schema: document and enforce the deployment ordering operationally.
- Add `BETA_SIGNUP_HOURS`, default `168`, integer range `1–168`; changes affect only a newly issued link. Keep `INVITATION_HOURS` independent. Reject empty, fractional, nonnumeric, and out-of-range values. Share the existing HTTPS/explicit-loopback link-origin rules without duplicating them.

Link format: `https://upsolve-aryan.duckdns.org/#beta=<random-token>`. Use validated `APP_ORIGIN`, never a request Host header.

Production example after upgrade:

```bash
sudo -u cp-notes /opt/node/bin/node --env-file=/etc/cp-notes/app.env \
  "$(readlink -f /opt/cp-notes/current)/backend/dist/admin.js" beta-link
```

Use `beta-status` or `revoke-beta-link` in the same invocation for the other operations. Do not put the shared credential in source control, build-time variables, persistent logs, or public feedback. No automatic messaging is included.

## 5. API contract and request protection

Add schemas in `shared/src/index.ts` and routes in `backend/src/auth.ts`, under the existing auth mount before data authentication:

| Route | Strict JSON body | Success |
| --- | --- | --- |
| `POST /api/auth/beta/inspect` | `{ token }` | `200 { data: { expiresAt, remainingSignups } }` |
| `POST /api/auth/beta/accept` | `{ token, email, password }` | `201 { data: { email } }` |

Reuse the token format, normalized email, and 12–128 character password rules. Confirm-password is a website field only. Reject extra fields such as `userId`, `active`, `maxSignups`, or `signupCount`. Client-provided counts or identity properties never influence admission or ownership.

Both routes require the configured website Origin, return no-store responses, and retain the current JSON size limit and security headers. No new CORS origin is required. Link inspection never consumes capacity or creates an account.

- Malformed input: `400 validation_error` without reflecting submitted values.
- Unknown, expired, or revoked token: `400 beta_unavailable`, with guidance to ask for a current link or sign in if already registered.
- Current, unexpired token with no spots: `400 beta_full`, “This beta has reached its 30-signup limit. Existing users can still sign in.” Unknown tokens never receive usage data.
- Existing email, including disabled accounts: `400 beta_account_unavailable`, “Account setup is unavailable for this email. If you already have an account, sign in or contact the operator.” Do not expose active/disabled state, overwrite passwords, or alter sessions. This generic rejection still permits some account-existence inference to a valid link holder; do not claim full enumeration resistance.
- Wrong/missing origin: `403`; throttled or password hashing saturated: `429`; unexpected failures retain existing safe server-error behavior.
- None of the signup failures uses `401`, which would incorrectly expire an unrelated website session.

Reuse bounded in-memory throttling with separate beta keys. Initial limits per 15 minutes: 120 inspect/accept requests per IP combined, 40 accept attempts per IP, and 5 accept attempts per token-hash + normalized email. Apply IP limiting before route-level schema validation/lookup and account limiting before hashing; retain the existing globally bounded JSON parser. Never use raw tokens/passwords in limiter keys or logs. Keep the existing global two-password-job bound.

Do **not** copy the individual invitation's 10-attempt limit keyed only by token: all 30 testers share this token. The selected IP limits allow 30 signups behind one shared network, while imposing temporary throttling; a shared-network attacker could still affect others. Limits reset on server restart, but the durable 30-signup cap does not. No distributed limiter is needed for the existing single-process deployment.

## 6. Website and onboarding

Extend the startup fragment parser in `App.tsx`/`main.tsx` to recognize `#invite=` and `#beta=` using an explicit entry kind. Capture before React StrictMode renders, immediately remove signup credentials from the address bar, and retain them only in memory.

Reject duplicate supported parameters, empty/malformed tokens, and a fragment containing both invite and beta parameters; clear the fragment even for these invalid entry links. Preserve ordinary unrelated hashes and the current pathname, query, and history state. Keep `/privacy` public and unaffected.

`BetaSignupForm.tsx` should provide:

- Loading and retry states for inspection; readable unavailable/full messages and a normal sign-in option.
- Labeled email, password, and confirmation fields with existing input conventions and autocomplete attributes. Explain that the email will be used to sign in. Validate client-side and again on the server.
- Remaining spots and expiry from inspection, with wording that spots are confirmed only when account creation completes.
- Duplicate-submit protection, preserved fields after definite failures, and cancellation/stale-result protection on unmount and account changes.
- No automatic replay of account creation. After an uncertain response, offer sign-in using the submitted email/password and explain setup may already have completed. Freeze fields while submitting and use the submitted normalized email for recovery. Reject mismatched success payloads as uncertain failures.
- On confirmed success, clear password/token state and prefill ordinary login. After login, show existing onboarding. Keep the current signed-in guard: explicitly sign out to register another account or return to the diary; never silently switch identity.
- If refreshed before completion, tell the tester to reopen the original link. Do not persist tokens or passwords in browser storage.

Update login/onboarding wording to accommodate either invitation type. Configure `VITE_EXTENSION_INSTALL_URL` with the verified [CP Notes store URL](https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko) at website release build time. The existing published extension uses the same account/login API and requires no code or store update for this feature.

## 7. Implementation order and files

1. **Contracts and persistence:** `shared/src/index.ts`, `backend/src/database.ts`, shared/database tests. Implement migration, lifecycle methods, and cap transaction first.
2. **Operator commands:** `backend/src/admin.ts`, `backend/src/config.ts`, their tests, and `.env.example`. Add configuration and safe issue/status/revoke operations.
3. **API:** `backend/src/auth.ts` and a focused `backend/src/betaSignup.test.ts`. Preserve old invitation routes and schemas.
4. **Website:** `website/src/App.tsx`, `main.tsx`, `api.ts`, new `components/BetaSignupForm.tsx` with tests, existing app/startup/API tests, and necessary login copy. Reuse current styles.
5. **Release and documentation:** extend `deploy/verify-release.mjs`; update README, deployment guide, runbook, and release checklist. Review privacy wording for the additional signup flow and temporary rate-limit keys; avoid unrelated policy changes. Preserve the user's existing runbook edits.

Keep new tests beside the code they exercise. No extension source, note schema, ownership queries, package dependency, or lockfile change is expected.

## 8. Required verification

| Area | Cases that must pass |
| --- | --- |
| Migration | Fresh database reaches schema 4; schema-3 copy preserves users, sessions, invitations, note IDs/links/contents; migration failure rolls back DDL/version; unsupported newer schema rejected; legacy-owner protections unchanged. |
| Cap | First through 30th account succeed; 31st fails; invalid/duplicate/failed creations do not increment; account disable does not free a spot; restart preserves usage. |
| Races | Two distinct emails at count 29 yield one success; same email concurrently consumes one spot; reissue/revoke/expiry during paused hashing blocks the pending signup; transaction failure creates neither account nor count increment. Exercise separate SQLite connections or processes against one temporary file for the final-slot race, not only sequential calls. |
| Link lifecycle | One valid token at a time; reissue retains count and limit; revoked/expired links fail; reopening retains used count; full beta cannot be reopened; status/output failure/argument validation work; only hashes are stored. |
| API safety | Origin, strict payloads, normalization, unknown tokens, disabled users, rate limits, password-job saturation, no secret reflection, no cookie/token returned, no automatic retries. At least 30 valid same-IP acceptances can complete within a window when inspected once each; varied emails do not hit a shared token-only limit. |
| Website | StrictMode parsing, duplicate/mixed parameters, refresh guidance, email/password validation, double click, full/expired link, loading failures, malformed/mismatched responses, uncertain completion, signed-in guard, stale requests and cross-tab account change, success → login → onboarding. |
| Regression | Individual invitations, normal website/extension login, password reset/disable revocation, and two-user isolation through direct API requests still work. |
| Release | Compiled CLI works after dependency pruning; production Linux startup, shared signup, website and extension login, restart persistence, and independent backup/restore preserve count and token state. |

Use temporary databases and synthetic tokens only. Use controlled hashing pauses/fake time for deterministic race and expiry tests; retain real hashing coverage in release verification. Do not create 30 production accounts to exercise the cap.

During implementation run focused workspace tests after building shared output. Before declaring application implementation complete, run `npm run check` and review `git diff --check`. There is no configured lint script. Record actual results and distinguish local tests, Linux release checks, and live browser verification.

## 9. Rollout and recovery

1. Complete local code, tests, docs, and the Linux release exercise on disposable data. Add the verified published store URL to the website's public build settings.
2. Follow the existing release runbook: stop writes and backup scheduling as appropriate, create a SQLite-aware pre-migration backup, and independently verify its restoration with the matching schema-3 release. Retain it off-server.
3. Deploy the new backend and website together, using the production environment file. The first open migrates to schema 4; do not run a new admin command against the live schema-3 database before the backup procedure.
4. Verify HTTPS, existing login, private notes, and the install link. Issue the beta link from the active compiled release. Confirm status shows `0 / 30` before recruitment begins unless an explicitly agreed live smoke-test account has already consumed a spot.
5. Have the first intended tester use the same flow in a fresh browser profile, install from the store, save a note, and see it in their diary. A real tester's successful signup counts toward 30; never reset production usage to hide a smoke test.
6. Share the one link with the group. Use `beta-status` to check usage; replace a lost/expired link for remaining spots or revoke it to stop enrollment. Closure leaves normal sign-in available.

Rollback to schema-3 code requires its matching backup and may lose writes made after that backup; prefer a forward fix where practical. Restoring any older backup can reduce the signup count and revive a previous link. Keep signup closed after restoration, revoke the restored token, reconcile the pre-incident admitted count from available records, and preserve consumed capacity before issuing a replacement. Do not blindly reopen 30 spots or guess the prior count; if it cannot be established, keep enrollment closed. A reconciliation command/ledger is outside this MVP and would need separate implementation if recovery requires it.

## 10. Completion criteria

- [x] One shared link creates at most 30 new accounts across replacements and restarts.
- [x] Expiry, revocation, concurrent acceptance, and uncertain responses behave as specified.
- [x] Existing invitations, accounts, notes, and extension clients retain working behavior.
- [x] Automated tests and `npm run check` pass; Linux release verification is recorded separately.
- [x] Operator instructions and onboarding include the published extension install URL.
- [x] Production backups, schema-4 migration, restart persistence, and the live signup page with 0 / 30 used spots are verified. The operator issued the shared link for private delivery.
- [ ] Complete the first real tester's signup, website/extension login, and capture flow, and verify that signup usage increments. Automated acceptance tests use disposable databases and do not consume production spots.
