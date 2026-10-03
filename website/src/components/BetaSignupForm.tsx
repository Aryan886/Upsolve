import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmailSchema, PasswordSchema, type BetaSignup } from "@cp-notes/shared";
import type { SignupEntry } from "../App";
import { acceptBetaSignup, ApiError, inspectBetaSignup } from "../api";

const recoveryMessage = "Account setup may have completed. Sign in with the password you just chose. If sign-in fails, contact the person who shared your link.";

export function BetaSignupForm({ entry, onAccepted, onSignIn }: {
  entry: Extract<SignupEntry, { kind: "beta" }>;
  onAccepted: (email: string) => void;
  onSignIn: (email: string, notice: string) => void;
}) {
  const [signup, setSignup] = useState<BetaSignup | null>(null);
  const [loading, setLoading] = useState(true);
  const [inspectError, setInspectError] = useState("");
  const [linkUnavailable, setLinkUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(false);
  const requestGeneration = useRef(0);
  const acceptance = useRef<AbortController | null>(null);
  const submittedEmail = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current += 1; acceptance.current?.abort(); };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    setLoading(true);
    setInspectError("");
    setLinkUnavailable(false);
    void inspectBetaSignup(entry.token, controller.signal).then((result) => {
      if (active && generation === requestGeneration.current) setSignup(result);
    }).catch((caught: unknown) => {
      if (!active || generation !== requestGeneration.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setSignup(null);
      setLinkUnavailable(caught instanceof ApiError && ["beta_unavailable", "beta_full"].includes(caught.code));
      setInspectError(caught instanceof ApiError ? caught.message : "This beta link could not be checked. Try again shortly.");
    }).finally(() => { if (active && generation === requestGeneration.current) setLoading(false); });
    return () => { active = false; requestGeneration.current += 1; controller.abort(); };
  }, [entry.token, revision]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || completed.current || !signup) return;
    const parsedEmail = EmailSchema.safeParse(email);
    if (!parsedEmail.success) { setError("Enter a valid email address."); return; }
    if (!PasswordSchema.safeParse(password).success) { setError("Use a password with 12–128 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    submitting.current = true;
    submittedEmail.current = parsedEmail.data;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    acceptance.current = controller;
    setBusy(true);
    setError("");
    setRecovery(false);
    try {
      const result = await acceptBetaSignup(entry.token, parsedEmail.data, password, controller.signal);
      if (!mounted.current || generation !== requestGeneration.current) return;
      if (result.email !== parsedEmail.data) throw new ApiError("invalid_response", "CP Notes returned an unreadable account setup response.");
      completed.current = true;
      setPassword("");
      setConfirmation("");
      setBusy(false);
      onAccepted(result.email);
    } catch (caught: unknown) {
      if (!mounted.current || generation !== requestGeneration.current) return;
      const definiteFailure = caught instanceof ApiError && caught.status !== undefined && caught.status >= 400 && caught.status < 500;
      const unavailable = caught instanceof ApiError && ["beta_unavailable", "beta_full"].includes(caught.code);
      setRecovery(!definiteFailure || unavailable);
      setError(unavailable ? caught.message : definiteFailure ? caught.message : recoveryMessage);
    } finally {
      submitting.current = false;
      acceptance.current = null;
      if (mounted.current && generation === requestGeneration.current) setBusy(false);
    }
  }

  function showSignIn(): void {
    requestGeneration.current += 1;
    acceptance.current?.abort();
    const notice = recovery || submitting.current ? recoveryMessage : "";
    const parsedEmail = EmailSchema.safeParse(email);
    setPassword("");
    setConfirmation("");
    const currentEmail = parsedEmail.success ? parsedEmail.data : "";
    onSignIn(notice ? submittedEmail.current : currentEmail, notice);
  }

  return <section className="account-card">
    <h2>Join the CP Notes beta</h2>
    <p>Choose an email and password for your diary. If you reload, reopen the original beta link to continue.</p>
    {loading ? <p role="status">Checking the beta link...</p> : inspectError ? <>
      <p role="alert" className="inline-error">{inspectError}</p>
      {!linkUnavailable && <button className="button secondary" onClick={() => setRevision((value) => value + 1)}>Retry link check</button>}
    </> : signup && <>
      <p className="hint">{signup.remainingSignups} beta spots currently remain. Your spot is confirmed only after account creation completes. This link expires {new Date(signup.expiresAt).toLocaleString()}.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <button className="button" disabled={busy || completed.current}>{busy ? "Creating account..." : "Create account"}</button>
      </form>
    </>}
    <p><button className="text-button" onClick={showSignIn}>{recovery ? "Sign in with the password you just chose" : "Go to sign in"}</button></p>
  </section>;
}
