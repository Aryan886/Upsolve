import type { User } from "@cp-notes/shared";
import { ApiError, clearSessionData, getCurrentUser, logout } from "./api";
import { LoginForm, PasswordForm } from "./components/LoginForm";
import { useEffect, useState } from "react";
import { FeedPage } from "./pages/FeedPage";
import { MistakesPage } from "./pages/MistakesPage";
import { SearchPage } from "./pages/SearchPage";

type Page = "feed" | "mistakes" | "patterns" | "snippets" | "editorial";

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


export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const expired = () => { clearSessionData(); setUser(null); setLoading(false); setMessage("Sign in to continue."); };
    const channel = new BroadcastChannel("cp-notes-account");
    channel.onmessage = () => { expired(); setReload((value) => value + 1); };
    window.addEventListener("cp-notes-session-expired", expired);
    setLoading(true);
    setError("");
    void getCurrentUser().then((nextUser) => { if (active) setUser(nextUser); }).catch((caught: unknown) => {
      if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
      if (!(caught instanceof ApiError && caught.code === "session_expired")) setError(caught instanceof Error ? caught.message : "Could not check your session.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; clearSessionData(); channel.close(); window.removeEventListener("cp-notes-session-expired", expired); };
  }, [reload]);

  function accountChanged(nextUser: User | null, notice = ""): void {
    clearSessionData();
    setUser(nextUser);
    setMessage(notice);
    const channel = new BroadcastChannel("cp-notes-account");
    channel.postMessage("changed");
    channel.close();
  }
  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await logout(); accountChanged(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Sign-out failed. Try again."); }
    finally { setBusy(false); }
  }
  const feedback = import.meta.env.VITE_FEEDBACK_URL as string | undefined;
  const install = import.meta.env.VITE_EXTENSION_INSTALL_URL as string | undefined;
  return <div className="wrap">
    <header className="site-title"><h1>CP Notes</h1><p>A private diary for patterns, mistakes, snippets, and insights.</p></header>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error} <button onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
    {loading ? <p role="status">Checking your session?</p> : user ? <>
      <div className="account-bar"><span>{user.email}</span><button className="button secondary" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
      <details className="account-card"><summary>Start here</summary><ol>
        <li>{install ? <a href={install} target="_blank" rel="noreferrer">Install the CP Notes extension</a> : "Install the extension from your beta invitation."}</li>
        <li>Sign in to the extension with this account.</li><li>Open a LeetCode, Codeforces, CodeChef, or AtCoder problem. Open the extension, write a note, and save.</li>
        <li>Find and edit your saved note in this diary.</li>
      </ol></details>
      <PasswordForm key={user.id} onChanged={() => accountChanged(null, "Password changed. Sign in again on each device.")} />
      <Diary key={user.id} />
    </> : !error && <LoginForm onLogin={(nextUser) => accountChanged(nextUser)} />}
    <footer>CP Notes v{import.meta.env.VITE_APP_VERSION ?? "0.1.0"} ? Capture with the extension; review here.
      {feedback && <> ? <a href={feedback} target="_blank" rel="noreferrer">Send feedback</a></>}
    </footer>
  </div>;
}
