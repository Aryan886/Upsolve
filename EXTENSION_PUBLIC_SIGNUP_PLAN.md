# CP Notes: public website signup linked from the extension

Prepared and clarified: 2026-10-07.
Status: implemented and locally verified on 2026-10-08. Backend/website deployment, real beta-token revocation and extension publication remain pending. See [local evidence and release gates](deploy/RELEASE_CHECKLIST.md#public-website-signup-preparation-2026-10-08). Production data/settings have not changed.

## 1. Confirmed request

Anyone can create an account on the website without a referral/invitation link and without the 30-person beta cap. The extension provides a normal link to that website signup page. Users create accounts immediately; email verification is a later feature.

The intended journey:

1. Open the extension and click **Create account on the website**.
2. A browser tab opens the public **/signup** page.
3. Enter email, password, and confirmation; submit.
4. After confirmed creation, sign in on the website or return to the extension and sign in with the same credentials.

The website login page also links to signup. An installed extension is not a prerequisite. Direct visits, bookmarks, refreshes, and sharing the plain URL must work without a token.

This document replaces the earlier popup-signup proposal in this file. The extension does not collect signup credentials or call a signup endpoint. No extension signup state machine, pending-signup storage marker, or automatic website-to-extension login is needed.

This request extends the invitation-only scope of [AWS_BUILD_PLAN.md](AWS_BUILD_PLAN.md) and replaces the shared-link restrictions in [SHARED_BETA_SIGNUP_PLAN.md](SHARED_BETA_SIGNUP_PLAN.md). Preserve historical evidence; mark new work complete only when verified.

## 2. Architecture and trade-offs

Website form → website-origin API → existing password hashing → ordinary user insertion → confirmed acknowledgment → existing sign-in. The extension only opens the website.

Adapt the existing BetaSignupForm into SignupForm, keeping validation, duplicate-submit protection, and ambiguous-response recovery. Add /signup with the existing small routing approach; no router dependency.

Reuse the users table and unique email index. Keep schema 4, existing identities, sessions, notes and draft keys. No migration, account conversion, beta-counter reset, or new service is necessary. Public signup must not inspect or update beta_signup.

Keep creation and login separate, matching current behavior. Automatic login adds session/cookie failure boundaries without being required here.

Prefer a dedicated POST /api/auth/signup contract over making the old beta token optional: it makes public enrollment independent of legacy token/cap logic. Old beta links lead to public signup; legacy beta APIs return retirement guidance.

## 3. Repository findings

Verified from the working tree, not a new production audit:

- shared/src/index.ts provides email normalization and the current 12–128 character password schema.
- backend/src/auth.ts contains website-Origin validation, beta acceptance, bounded throttling and scrypt hashing with a shared two-job concurrency bound.
- backend/src/database.ts supports schema 4. Beta acceptance currently inserts a user and increments signup_count together; ordinary users already have unique normalized emails.
- website/src/components/BetaSignupForm.tsx already has the three inputs, duplicate-submit guards, generation checks, abort handling and ambiguous-response recovery.
- website/src/App.tsx manages signup fragments and account/session state. main.tsx reads the initial fragment before React StrictMode rendering.
- website/src/api.ts already provides error codes/status and response validation. Its initial /auth/me 401 cancels pending requests; account initialization must settle before signup becomes active.
- Production HTML routes in backend/src/app.ts currently allow only / and /privacy. Adding only frontend /signup rendering would fail on direct production visits and refreshes.
- extension/popup.html currently directs users to invitation setup. popup.ts already calculates a website diary URL using development mode/API environment.
- deploy/verify-release.mjs currently expects successful beta inspection/acceptance. Update those expectations or the deployment checks will reject the new release.
- Website/backend CI does not distribute packaged extension UI changes.

Inspect current Git status, instructions, affected tests and scripts again before implementation; preserve unrelated changes.

## 4. Website route and form

### Public route

Use https://<configured-website>/signup and the existing development website at http://localhost:5173/signup.

- Add /signup explicitly to the backend HTML route allowlist. Do not replace it with a blanket catch-all that serves HTML for missing APIs/private files.
- Recognize the route in the website's existing entry/state handling. Preserve /privacy, login and the diary.
- Add **Create account** beside website login and **Already have an account? Sign in** on signup.
- Cover direct navigation, refresh, Back/Forward and /signup/. Normalize the trailing slash or handle it identically in both environments.
- After creation, show normal login and update the URL to the login/home path while retaining the confirmed email in memory. Never put credentials or email in query parameters.
- Plain anchors/full navigation are sufficient where simpler. If history changes are used without navigation, handle popstate so the UI and URL agree. No new router library is needed.

### Reuse BetaSignupForm

Rename/adapt the component and tests to SignupForm. Remove the token prop, inspect request/effect, remaining-spots and expiry text, link-retry UI, and requirement for an inspection result before submitting.

Retain labeled inputs, keyboard access, email/new-password autocomplete, paste/password-manager support, synchronous duplicate-submit protection, completed/mounted/generation guards and relevant cancellation cleanup. Hidden/inactive controls must not block validation.

Normalize email with the shared schema. Never normalize, trim, truncate, lowercase or persist passwords. Retain the current password policy. Confirmation is client-only and is not sent to the API.

On a validated successful response, clear both passwords and show normal login with email prefilled and “Account created. Sign in to continue.” Onboarding explains that the same credentials work in the extension; signup does not automatically authenticate it.

### Existing sessions and multiple tabs

Wait for session discovery before activating signup. An unexpected session-check failure must show recovery rather than assume the user is signed out.

A signed-in visitor sees their identity and **Open diary**. Creating another account requires explicit sign-out. Never silently switch the account or clear its data; failed logout preserves the current UI.

Retain BroadcastChannel/account-generation protection. Ignore late signup results after unmount, dismissal or another tab's account change; clear sensitive form state on identity changes. Canceling a client request does not prove that account creation was canceled on the server.

## 5. Backend contract

Add a strict shared request schema containing only email and password, using EmailSchema and PasswordSchema. Add a focused accepted-response schema/type beside existing auth definitions.

**POST /api/auth/signup**

Request: { email, password }, without token/referral fields.
Success: 201 { data: { email } }, with normalized email only.

Do not create a cookie/session automatically or expose IDs, hashes or beta counters. Preserve API no-store/security headers.

The route is unauthenticated but requires the exact configured website Origin through requireWebsiteOrigin. Reject missing, null, hostile and extension Origins: the extension opens the website instead of calling this API. Cookies/bearer credentials cannot bypass origin checks or turn registration into account editing. All note/data routes remain authenticated.

| Condition | Response |
| --- | --- |
| Invalid fields, password/email, extra token/identity fields | 400 validation_error; safe guidance without credential echo. |
| Existing normalized email, including disabled accounts | 409 signup_unavailable: “Account setup is unavailable for this email. Try signing in or contact support.” |
| Disallowed Origin | 403 origin_not_allowed, before hashing/writes. |
| Excess attempts | Existing 429 too_many_attempts with signup-appropriate copy. |
| Shared password hashing capacity exhausted | 429 auth_busy, no user creation; manual retry only. |
| Unexpected database/runtime failure | Sanitized 500 through existing error handling, with safe contextual logs. |

Do not use 401 for signup conflicts, because the website treats it as session expiry. Never report success for an existing account, replace its password or reveal disabled status. Distinct success/conflict responses still reveal address availability; generic wording alone does not eliminate enumeration.

Keep strict validation, bounded JSON bodies and configured CORS. Origin checks constrain browser callers, not scripts forging headers, and do not prove email ownership.

### Abuse controls without an enrollment cap

Reuse the bounded/expiring throttle with separate signup keys. Proposed starting limits: 20 attempts per IP and 5 per normalized email per 15 minutes. Apply IP limiting before route-level validation/hashing, then email limiting after normalization and before hashing. Centralize the values and test shared-campus-network behavior.

Keep login/signup namespaces separate so signup attempts do not directly consume an existing user's login budget. Retain the shared two-job scrypt limit and cleanup after failure. Do not lower hash costs or add unbounded queues/new infrastructure.

Temporary throttling is not a lifetime account cap. The process-local limiter resets on restart and cannot stop distributed farming. Verify trusted-proxy IPs and bounded limiter memory. Monitor contention, disk growth and backups before wide promotion. A shutdown switch or stronger abuse controls can be separate operational follow-ups; no new runtime configuration is required for this baseline.

## 6. Database correctness

Signup must work with no beta row or a full, expired or revoked beta. Do not replace 30 with a large number or route public creation through optional-token beta acceptance.

Reuse existing user insertion, adding a focused method only if needed for the public conflict contract:

1. Optionally reject a used normalized email early to avoid expensive hashing; this is only an optimization.
2. Hash asynchronously through the existing helper, outside any SQLite transaction.
3. In a short immediate transaction, recheck email and insert one ordinary active user. The unique email constraint remains the final guard against other connections.
4. Map only the expected email uniqueness conflict; lock timeouts, disk failures, corruption and unrelated constraints remain visible failures.
5. Commit before 201. Do not insert sessions, change beta usage, modify existing users, or edit notes/invitations.

Concurrent same-email requests, including case/whitespace variants, must have exactly one winner. Concurrent admin creation or invitation acceptance during hashing cannot overwrite passwords or reactivate disabled accounts.

Keep schema 4, migrations, user IDs, session behavior, ownership and indexes. The existing email unique index suffices. Retain beta_signup as inactive historical data rather than dropping it and introducing a migration/rollback boundary.

Individual invitations can remain an optional operator workflow; no public user needs one. Existing invitation account-existence checks must stop an outstanding invitation from modifying an email registered publicly. Removing all individual invitation support is outside this narrow change.

## 7. Failure and interruption recovery

Preserve inputs after definite rejection while the page stays open. Clear passwords on success or dismissal. Never persist signup credentials in browser/extension storage, URLs, cookies, logs, analytics or note drafts.

| Situation | Behavior |
| --- | --- |
| Confirmation mismatch | Inline error, no request. |
| Rapid clicks/Enter | One in-flight POST. |
| Definite 400/403/409/429 | Explain safely, preserve current-page inputs as appropriate, offer deliberate retry/sign-in. |
| Offline/timeout/abort, 500/502/504, invalid JSON or malformed success | Explain that creation may have completed; try sign-in first. Never automatically replay. |
| Response email differs from submitted normalized email | Invalid/ambiguous response, not confirmed success. |
| Navigation/unmount/account change during POST | Abort/ignore stale UI work; do not claim server cancellation. |
| Reload/closed tab | Blank form on return; static “Already tried creating an account? Try signing in first” guidance. No persistent marker needed. |
| Lost success followed by duplicate signup | Offer sign-in; never reset or overwrite the account. |
| Creation succeeds but subsequent login fails | Handle login independently; do not call creation failed. |

Reuse website API error codes/status rather than parsing messages. The new signup helper validates unknown response data and retains existing account-generation cancellation. Avoid an unrelated API-layer rewrite.

Closing the extension popup after opening the website does not close the website form. Website refresh/navigation can still interrupt its own POST.

## 8. Extension link and copy

Add **Create account on the website** to the signed-out popup as an anchor opening /signup in a new tab with target="_blank" and rel="noreferrer" or explicit noopener/noreferrer.

Reuse the diary-origin calculation: development uses the Vite website origin; production uses the API origin where the website is served today. Append /signup to the website origin, not /api. Keep this alongside diary-link setup; no new environment variable is necessary for the existing same-origin production architecture.

Populate the link after environment settings load but independently of session lookup or optional scraping. It must remain usable on blank/restricted/unsupported tabs and with expired sessions. Assign it early enough that capture failures do not suppress it, without an unrelated scraper refactor.

Replace invitation-only text with “Create an account on the website, then sign in here with the same email and password.” Preserve existing login, trusted-context token storage, capture and drafts. Returning from signup must not transfer or clear another account's drafts.

No extension signup POST, token handoff, storage schema, permissions or API-helper changes are required.

## 9. Old beta links and gates

- Remove active referral-required, expiry and remaining-spots copy.
- For /#beta=... URLs, immediately strip the fragment and show/navigate to /signup. Never inspect, retain, render, forward or authorize using the token. Valid, expired, empty, revoked and full-beta links all reach public signup.
- Define mixed/duplicate fragment handling. Mixed invite/beta input must not silently accept an invitation; strip sensitive parameters and offer neutral setup guidance/public signup. Preserve valid single invite behavior and unrelated hashes.
- Retire /api/auth/beta/inspect and /api/auth/beta/accept with fixed 410 beta_signup_retired responses naming the public signup URL. Retain relevant origin checks; no lookup, hashing, creation or count change.
- Stop CLI beta-link issuance with retirement guidance. Retain beta-status as historical information and revoke-beta-link for operational cleanup.
- Remove dead active beta UI/client helpers after checking references; retain historical database/migration tests that protect compatibility.
- Update current README, onboarding, operator/tester and store copy; preserve dated historical evidence.

A stale open website bundle may still submit to the retired endpoint. It must fail safely with /signup guidance, and refreshing must load the new form.

At separately authorized cutover, revoke the stored beta token after the normal backup. New code ignores it, but older binaries/restored backups could otherwise revive capped enrollment. Do not delete users or reset historical counts.

## 10. Files and order

| Step | Main files | Completion criterion |
| --- | --- | --- |
| Shared | shared/src/index.ts and tests | Strict request/acknowledgment without token/count. |
| Backend | backend/src/auth.ts, database.ts, relevant tests/new signup.test.ts | Website-origin public signup, bounded work, atomic conflicts, independent of beta. |
| Website | backend/src/app.ts and production.test.ts; website App.tsx, main.tsx, api.ts, renamed signup form/tests, login component/tests | Direct /signup, refresh, navigation, session ordering, success/recovery. |
| Extension | extension/popup.html, src/popup.ts, popup.test.ts | Correct link/copy, unchanged login/storage/drafts. |
| Legacy | admin.ts/tests, beta API tests, fragment tests, dead client references | Old links lead to public signup; beta endpoints/issuance retire; invitations work. |
| Docs/release | deploy/verify-release.mjs and related tests; README.md, deploy/README.md, LIGHTSAIL_RUNBOOK.md, RELEASE_CHECKLIST.md, STORE_LISTING.md | Current smoke/copy reflects public registration; historical evidence retained. |
| Package | extension/public/manifest.json, metadata as existing conventions require | Higher actual store version, same identity/permissions. |

Review PrivacyPage.tsx for invitation-only claims; change only what behavior requires. Add a prospective pointer to this plan in AWS/shared-beta docs during implementation without marking rollout complete.

No migration, new configuration or deployment redesign is expected. Explain any proposed departure before introducing it.

## 11. Verification

Use temporary/in-memory databases and synthetic accounts; never modify the real database for tests.

| Area | Required cases |
| --- | --- |
| Validation | Missing/null/types, invalid/long email, normalization, 11/12/128/129 password boundaries, exact password preservation, confirmation and extra fields. |
| Cap removal | No token; no beta row; historical count 30; count unchanged. Create more than 30 public users using controlled test time/hashing or focused DB checks; test throttling separately without weakening production safeguards. |
| Auth/origin | Website allowed; missing/null/hostile/extension rejected; cookies/tokens cannot bypass; signup issues no session; note APIs protected. |
| Conflicts/races | Active/disabled emails, casing, two connections, admin/invite creation during hashing, unique conflicts, rollback/lock/write failures. |
| Abuse | IP/email limits/expiry, bounded keys, malformed attempts, hash saturation/cleanup, separate login budget, proxy IPs. |
| Routing | Direct production /signup, refresh/slash, Back/Forward, success/login URL consistency, signed-in visit, privacy, protected/private/unknown paths. |
| Lifecycle | Initial session check/error, StrictMode, duplicates, unmount, other-tab login/logout, failed logout, stale result protection. |
| Recovery | Network/timeout/5xx, invalid payload/email mismatch, lost response after commit, reload then login, manual duplicate; no replay/credential persistence. |
| Legacy | Old link variants and fragment cleanup, mixed/duplicate parameters, beta endpoints no writes, stale bundle guidance, individual invitations. |
| Extension | Dev/prod URL/new tab, usable link despite metadata/session failure, no signup POST/new permissions, login/capture/draft isolation. |
| Privacy | Two public users cannot read/search/count/edit/delete/link each other's records, feed/statistics/all four note types private, reset/disable revoke sessions. |
| Operations | Old/new extension login, public-user capture/website retrieval, restart/redeploy, schema 4 and independent SQLite-aware restore. |

Update deploy/verify-release.mjs before claiming CI readiness. Replace active beta-success assumptions with public signup, direct signup HTML availability, beta independence, retired APIs, both logins, restart and restoration. Retain invitation and isolation coverage.

Run focused workspace tests during implementation, then **npm run check**, **node --test deploy/check-release.test.mjs deploy/deploy-release.test.mjs**, and **git diff --check**. Run the existing deploy/verify-linux.sh exercise and applicable CI deployment checks when inputs change. No lint script exists; report environment failures separately.

Manual exercise: real extension link → website signup → website/extension login → capture → diary read/edit. Also test website-only signup, signed-in visits, refresh and interrupted acceptance. Mark browser/store/live checks pending until exercised.

## 12. Email and recovery limitations

Immediate signup is confirmed; verification is deferred. Email is an unverified identifier: someone can reserve another person's email or create multiple accounts. Do not claim verified identity or automated recovery.

Retain authenticated password changes and existing support/manual reset, but never reassign/reset an account solely because someone knows or claims its email. Without reliable proof, do not promise recovery or transfer notes. Use an actual support channel, not an invented address.

Email delivery, pending accounts, automatic reset, OAuth, quotas, CAPTCHA and new auth providers are future work. Opening registration does not prove unlimited hosting capacity; monitor the existing server and backups.

## 13. Rollout and rollback

1. Finish code, tests, docs and package preparation on a reviewable branch. Main auto-deploys; do not push/merge just to prepare changes.
2. Deploy backend/website plus updated smoke checks together once authorized, using the normal schema-compatible release and verified backup.
3. Verify /release.json, direct/refreshed /signup, token-free/cap-free creation, old login, retired APIs and isolation. Live signup smoke writes real data and must be within release authorization.
4. Revoke stored beta token at authorized cutover, preserving users/history; check old bookmarks.
5. Website signup is usable immediately after deployment, even for old extension users. Do not wait for the store update to open website registration.
6. Publish the extension link/copy update separately under the same item/ID, above the actual published version. Backend CI does not update the popup. Verify the published and installed package.
7. Record actual browser/Linux/live/restart/restore evidence separately. Pending store review is not publication.

Rollback preserves schema-4 data and newly created ordinary users. Verify the actual previous release against a temporary copy. Do not restore an older database solely to reverse UI changes, which would lose newer notes/accounts.

Old code may lack /signup and re-enable beta APIs. Revoke legacy tokens before serving it, including after restoring backups. Prefer a compatible corrective release retaining /signup with temporary-unavailability guidance if enrollment must close: updated extensions will keep opening it. Existing login must remain usable.

No automated store-publishing pipeline, infrastructure redesign or email provisioning belongs in this request.

## 14. Acceptance and Sol prompt

These items record local automated verification and prepared behavior. Actual browser/live/store exercises remain pending in the linked release checklist.

- [x] Direct website signup needs no referral link or installed extension.
- [x] Historical count 30 does not block enrollment; more than 30 public accounts can be created over time.
- [x] Extension opens website signup and retains current login/session/draft behavior.
- [x] Existing identities, disabled status, sessions, private notes and optional invitations are preserved.
- [x] Meaningful normal/failure/race tests and updated release checks pass; schema stays 4.
- [x] Local implementation, deployed website/backend and published extension are reported separately.

> Implement EXTENSION_PUBLIC_SIGNUP_PLAN.md with its clarified scope: public signup happens on the website at /signup; the extension only links there. Remove the shared-beta/referral-token requirement and lifetime 30-account cap. Immediate signup is confirmed and email verification deferred. Read repository instructions, README, relevant build-plan sections, code/tests and Git status first, then briefly state the approach. Adapt the existing beta form, add website-origin signup independent of beta state, support direct production routing and old-link transition, and preserve existing login, sessions, ownership and drafts. Keep schema 4; avoid new extension auth/storage flows, unnecessary libraries or infrastructure. Complete focused tests, full checks, release-smoke updates and current documentation. Report results and pending release gates. Do not push/merge to main, deploy, change real data, revoke real links, publish the extension, provision services or send messages unless separately authorized; main already auto-deploys.
