import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmailSchema, PasswordSchema } from "@cp-notes/shared";
import { createAccount, ApiError } from "../api";

const recoveryMessage = "Account setup may have completed. Try signing in with the password you just chose before submitting again. If sign-in fails, contact support using the privacy page.";

export function SignupForm({ onAccepted, onSignIn }: {
  onAccepted: (email: string) => void;
  onSignIn: (email: string, notice: string) => void;
}) {
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

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || completed.current) return;
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
      const result = await createAccount(parsedEmail.data, password, controller.signal);
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
      setRecovery(!definiteFailure);
      setError(definiteFailure ? caught.message : recoveryMessage);
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
    <h2>Create your CP Notes account</h2>
    <p>Choose an email and password for your private diary. Use the same credentials to sign in to the extension.</p>
    <p className="hint">Email verification and automatic password recovery are not available yet. For help, use the contact details on the <a href="/privacy">privacy page</a>.</p>
    <p className="hint">Already tried creating an account? Try signing in first.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button" disabled={busy || completed.current}>{busy ? "Creating account..." : "Create account"}</button>
    </form>
    <p>Already have an account? <button className="text-button" onClick={showSignIn}>{recovery ? "Sign in with the password you just chose" : "Sign in"}</button></p>
  </section>;
}
