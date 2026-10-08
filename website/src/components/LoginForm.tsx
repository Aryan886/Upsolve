import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@cp-notes/shared";
import { changePassword, login } from "../api";

export function LoginForm({ onLogin, initialEmail = "" }: { onLogin: (user: User) => void; initialEmail?: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const user = await login(String(data.get("email")), String(data.get("password")));
      if (!mounted.current) return;
      form.reset();
      onLogin(user);
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Sign-in failed. Try again."); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="account-card">
    <h2>Sign in to your diary</h2>
    <p>Use the same email and password here and in the extension. For help with your account, use the contact details on the <a href="/privacy">privacy page</a>.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>Email<input name="email" type="email" autoComplete="username" defaultValue={initialEmail} required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Signing in?" : "Sign in"}</button>
    </form>
    <p>New to CP Notes? <a href="/signup">Create account</a></p>
  </section>;
}

export function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("newPassword") !== data.get("confirmPassword")) { setError("New passwords do not match."); return; }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await changePassword(String(data.get("currentPassword")), String(data.get("newPassword")));
      if (!mounted.current) return;
      form.reset();
      onChanged();
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Password change failed."); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <details className="account-card"><summary>Change password</summary>
    <p>Use 12?128 characters. You will need to sign in again on the website and extension.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Changing?" : "Change password"}</button>
    </form>
  </details>;
}
