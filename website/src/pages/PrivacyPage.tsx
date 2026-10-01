export function PrivacyPage() {
  return <div className="wrap">
    <header className="site-title">
      <p>CP Notes</p>
      <h1>Privacy policy</h1>
      <p>Last updated: 1 October 2026</p>
    </header>
    <main className="privacy-policy">
      <p>This policy covers the CP Notes Chrome extension and its companion website at upsolve-aryan.duckdns.org. CP Notes is an invitation-only service for saving and reviewing personal competitive programming notes.</p>

      <h2>Information we handle</h2>
      <ul>
        <li><strong>Account and authentication:</strong> your email address, account identifier, password submitted during sign-in or account setup, and session information. The server stores a salted password hash, not your plaintext password. The extension stores a session token, not your password.</li>
        <li><strong>Problem details and notes:</strong> problem titles and URLs, platform, optional tags, ratings and contest details, plus the patterns, mistakes, code snippets and editorial takeaways you enter.</li>
        <li><strong>Local drafts:</strong> unfinished note fields and linked problem details stored in your browser so you can recover them.</li>
        <li><strong>Security and operation:</strong> IP addresses temporarily used to limit sign-in and invitation attempts, and technical error information needed to operate the service. CP Notes does not request GPS location.</li>
        <li><strong>Support and feedback:</strong> information you choose to send when contacting the operator or submitting feedback.</li>
      </ul>

      <h2>How we use information</h2>
      <p>We use this information to authenticate your account, protect sign-in, save and display your notes, provide search and mistake statistics, recover drafts, and respond to support requests.</p>
      <p>When you open the extension on a supported problem page, it reads the active page URL and visible title to fill in editable problem details. Your note and linked details are sent to the CP Notes server when you save. The extension does not continuously monitor your browsing, import submission history, or collect your coding-platform passwords.</p>

      <h2>Storage and security</h2>
      <p>Saved account data and notes are hosted on Amazon Web Services (AWS). Production connections use HTTPS. Notes are associated with your account and are not shared with other testers.</p>
      <p>The website uses a session cookie to keep you signed in. The extension keeps its session token and unfinished drafts in local browser storage restricted to trusted extension contexts. These drafts are not sent through Chrome Sync. Drafts are separated by account, server, problem and note type.</p>
      <p>A successful save clears the corresponding draft. You can also discard a draft explicitly. Signing out of the extension clears its session and the drafts for that account on that server. Session expiry preserves drafts for recovery after signing in with the same account.</p>

      <h2>Service providers and sharing</h2>
      <p>AWS processes hosted data as our infrastructure provider. The optional feedback link opens Google Forms; information you submit there is also handled by Google under its privacy policy. Private notes and code are not automatically attached to feedback.</p>
      <p>We do not sell user data or use it for advertising, unrelated profiling, creditworthiness or lending decisions. We only disclose information as necessary to provide the service, address security issues, or meet legal obligations. Operator access to private content is limited to your consent for support, security needs, or legal requirements.</p>
      <p>CP Notes uses information received through Chrome APIs in accordance with the Chrome Web Store User Data Policy, including its Limited Use requirements.</p>

      <h2>Retention and deletion</h2>
      <p>Saved notes remain until you delete them or request account deletion. Deleting a note does not delete its linked problem record. Disabling an account prevents access but does not delete its notes.</p>
      <p>Backup and migration copies can contain earlier versions of your data, including deleted notes, until those copies are rotated or manually removed. These copies are used for recovery and are not accessible to other users. Contact the operator about removal of account data and backup copies; this policy does not promise immediate deletion from every backup.</p>
      <p>You can edit or delete individual notes on the website and discard local drafts in the extension. For account deletion, remaining problem records, password resets, or questions about retention, use the contact details below. We may need to verify that a request comes from the account owner. Do not send your password or session token.</p>

      <h2>Contact the operator</h2>
      <p>Email: <a href="mailto:aryankhade80@gmail.com">aryankhade80@gmail.com</a><br />
        Phone: <a href="tel:7219283196">7219283196</a></p>

      <h2>Policy changes</h2>
      <p>Changes will be posted on this page with an updated date. If the service changes how it handles your information, we will update the disclosures and obtain consent where required.</p>
    </main>
    <footer><a href="/">Return to CP Notes</a></footer>
  </div>;
}
