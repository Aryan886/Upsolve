# Unlisted Chrome Web Store release preparation

Status: draft copy; no listing submitted. Final hostname, extension ID, install link, privacy URL, organizer contact and reviewer account must be supplied by the owner.

## Listing copy

**Name:** CP Notes

**Short description:** Capture competitive programming patterns, mistakes, snippets, and editorial takeaways in your private diary.

**Description:** Open a supported LeetCode, Codeforces, CodeChef or AtCoder problem and capture the insight you want to remember. Save a pattern, a mistake and its root cause, a reusable code snippet, or a short editorial takeaway. Review and edit your entries in your private CP Notes diary. Unsent drafts are recovered when you return to the same problem and note type. This invitation-only beta requires an individual CP Notes account. It does not import submission history or require credentials for coding platforms.

**Single purpose:** Save and review the user's competitive programming learning notes.

## Permission explanations

- `activeTab`: access the selected problem URL/title after the user opens the popup.
- `scripting`: read visible title metadata on that selected page; no background scraping.
- `storage`: save the API session and unsent drafts locally, accessible only to trusted extension contexts.
- Fixed hosted API permission: send login and user-initiated note requests to the chosen CP Notes service over HTTPS.

## Privacy disclosure draft

CP Notes sends your account email, selected problem metadata and the notes/code you choose to save to the hosted CP Notes service. Your password is sent over HTTPS at sign-in; the service stores a salted password hash, not plaintext. Sessions use revocable tokens. The extension stores its session token and unsent drafts locally; it does not use Chrome sync, collect coding-platform passwords, read submission history, or automatically upload your browsing history. Feedback is submitted separately through the linked form. Account notes are private to that account.

Deletion/reset requests go to **[owner contact, required before publication]**. Notes remain until deleted or the operator fulfills an account deletion request. Daily backups expire after 14 days; any pre-migration backup retention must be disclosed explicitly. The website's privacy page must name the operator, final service domain, feedback provider and contact channel before publication. Do not claim zero data collection in store disclosures.

## Store assets and reviewer preparation

- Original notebook/code icons are included at `extension/public/icons` in 16/32/48/128 px sizes, with editable SVG source. They are emitted into both extension builds. Confirm the final artwork and dashboard requirements before submission.
- Capture screenshots using synthetic notes/accounts: popup with a LeetCode pattern, diary/search, mistake review, and recovered draft. Never use real private notes or credentials.
- Verify current dashboard asset dimensions and distribution requirements before uploading.
- Create a restricted tester account for the reviewer through the operator CLI; provide credentials privately in the reviewer fields, not in this repository.
- Select unlisted distribution, publish the privacy disclosure at its final URL, complete data-use disclosures, and submit for review.
- Obtain the store item's public manifest key when available; use it for stable unpacked IDs and align backend `EXTENSION_ORIGINS` with the verified ID.
- Smoke-test with the owner and a second technical tester before sharing with all 10 invited testers. Do not promise a publication date before review.

References: [manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key), [distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [developer registration](https://developer.chrome.com/docs/webstore/register).
