import type { User } from "@cp-notes/shared";
import { InvitationTokenSchema } from "@cp-notes/shared";
import { ApiError, clearSessionData, getCurrentUser, logout } from "./api";
import { LoginForm, PasswordForm } from "./components/LoginForm";
import { InvitationForm } from "./components/InvitationForm";
import { useEffect, useRef, useState } from "react";
import { FeedPage } from "./pages/FeedPage";
import { MistakesPage } from "./pages/MistakesPage";
import { SearchPage } from "./pages/SearchPage";

type Page = "feed" | "mistakes" | "patterns" | "snippets" | "editorial";

export type InvitationEntry = { token: string } | { invalid: true };

export function readInvitation(): InvitationEntry | null {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const tokens = parameters.getAll("invite");
  if (tokens.length === 0) return null;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  const result = InvitationTokenSchema.safeParse(tokens[0]);
  if (tokens.length !== 1 || !result.success) return { invalid: true };
  return { token: result.data };
}

const pages: { id: Page; label: string }[] = [
  { id: "feed", label: "Diary" },
  { id: "mistakes", label: "Mistakes" },
  { id: "patterns", label: "Patterns" },
  { id: "snippets", label: "Snippets" },
  { id: "editorial", label: "Editorial" },
];

function Diary() {
  const [page, setPage] = useState<Page>("feed");
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((value) => value + 1);

  return (
    <div className="wrap">

      <nav className="tab-nav" aria-label="Main views">
        {pages.map((item) => <button key={item.id} type="button" className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>{item.label}</button>)}
      </nav>
      <main>
        {page === "feed" && <FeedPage revision={revision} onChanged={changed} />}
        {page === "mistakes" && <MistakesPage revision={revision} onChanged={changed} />}
        {page === "patterns" && <SearchPage type="pattern" revision={revision} onChanged={changed} />}
        {page === "snippets" && <SearchPage type="snippet" revision={revision} onChanged={changed} />}
        {page === "editorial" && <SearchPage type="editorial" revision={revision} onChanged={changed} />}
      </main>

    </div>
  );
}


export default function App({ initialInvitation = null }: { initialInvitation?: InvitationEntry | null }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [invitation, setInvitation] = useState(initialInvitation);
  const [loginEmail, setLoginEmail] = useState("");
  const [showChecklist, setShowChecklist] = useState(false);
  const sessionGeneration = useRef(0);
  const accountChannel = useRef<BroadcastChannel | null>(null);
  const signingOut = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let checking = true;
    const generation = ++sessionGeneration.current;
    const expired = () => {
      if (!active) return;
      clearSessionData();
      setUser(null);
      setShowChecklist(false);
      setMessage("Sign in to continue.");
      // Initial discovery can emit 401 before its promise has finished cancelling other requests.
      if (!checking) { sessionGeneration.current += 1; setLoading(false); }
    };
    const channel = new BroadcastChannel("cp-notes-account");
    accountChannel.current = channel;
    channel.onmessage = () => {
      if (!active) return;
      sessionGeneration.current += 1;
      clearSessionData();
      setUser(null);
      setInvitation(null);
      setLoginEmail("");
      setShowChecklist(false);
      setMessage("");
      setBusy(false);
      setLoading(true);
      setReload((value) => value + 1);
    };
    window.addEventListener("cp-notes-session-expired", expired);
    setLoading(true);
    setError("");
    void getCurrentUser().then((nextUser) => { if (active && generation === sessionGeneration.current) setUser(nextUser); }).catch((caught: unknown) => {
      if (!active || generation !== sessionGeneration.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
      if (!(caught instanceof ApiError && caught.code === "session_expired")) setError(caught instanceof Error ? caught.message : "Could not check your session.");
    }).finally(() => { checking = false; if (active && generation === sessionGeneration.current) setLoading(false); });
    return () => {
      active = false;
      clearSessionData();
      channel.close();
      if (accountChannel.current === channel) accountChannel.current = null;
      window.removeEventListener("cp-notes-session-expired", expired);
    };
  }, [reload]);

  function accountChanged(nextUser: User | null, notice = ""): void {
    sessionGeneration.current += 1;
    clearSessionData();
    setUser(nextUser);
    setMessage(notice);
    setError("");
    setBusy(false);
    setShowChecklist(nextUser !== null);
    accountChannel.current?.postMessage("changed");
  }
  async function signOut(): Promise<void> {
    if (signingOut.current) return;
    signingOut.current = true;
    const generation = sessionGeneration.current;
    setBusy(true);
    setError("");
    try { await logout(); if (mounted.current && generation === sessionGeneration.current) accountChanged(null); }
    catch (caught) { if (mounted.current && generation === sessionGeneration.current) setError(caught instanceof Error ? caught.message : "Sign-out failed. Try again."); }
    finally { signingOut.current = false; if (mounted.current && generation === sessionGeneration.current) setBusy(false); }
  }
  function showSignIn(email = "", notice = ""): void {
    sessionGeneration.current += 1;
    clearSessionData();
    setInvitation(null);
    setLoginEmail(email);
    setMessage(notice);
    setError("");
  }
  const generation = sessionGeneration.current;
  const feedback = import.meta.env.VITE_FEEDBACK_URL as string | undefined;
  const install = import.meta.env.VITE_EXTENSION_INSTALL_URL as string | undefined;
  return <div className="wrap">
    <header className="site-title"><h1>CP Notes</h1><p>A private diary for patterns, mistakes, snippets, and insights.</p></header>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error} <button onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
    {loading ? <p role="status">Checking your session...</p> : user ? <>
      <div className="account-bar"><span>{user.email}</span><button className="button secondary" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
      {invitation ? <section className="account-card">
        <h2>Set up an invited account</h2>
        <p>You are signed in as {user.email}. Sign out before setting up an invited account.</p>
        <button className="button secondary" disabled={busy} onClick={() => showSignIn()}>Return to diary</button>
      </section> : <>
      <details className="account-card" open={showChecklist}><summary>Start here</summary><ol>
        <li>{install ? <a href={install} target="_blank" rel="noreferrer">Install the CP Notes extension</a> : "Install the extension from your beta invitation."}</li>
        <li>Sign in to the extension with the same email and password you use here.</li><li>Open a LeetCode, Codeforces, CodeChef, or AtCoder problem. Open the extension, write a note, and save.</li>
        <li>Find and edit your saved note in this diary.</li>
      </ol></details>
      <PasswordForm key={user.id} onChanged={() => { if (generation === sessionGeneration.current) accountChanged(null, "Password changed. Sign in again on each device."); }} />
      <Diary key={user.id} />
      </>}
    </> : !error && (invitation ? <InvitationForm entry={invitation}
      onAccepted={(email) => { if (generation === sessionGeneration.current) showSignIn(email, "Account created. Sign in to continue."); }}
      onSignIn={(email, notice) => { if (generation === sessionGeneration.current) showSignIn(email, notice); }} />
      : <LoginForm key={loginEmail} initialEmail={loginEmail} onLogin={(nextUser) => { if (generation === sessionGeneration.current) accountChanged(nextUser); }} />)}
    <footer>CP Notes v{import.meta.env.VITE_APP_VERSION ?? "0.1.0"} ? Capture with the extension; review here.
      {feedback && <> ? <a href={feedback} target="_blank" rel="noreferrer">Send feedback</a></>}
    </footer>
  </div>;
}
