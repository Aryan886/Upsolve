import { useEffect, useRef, useState, type FormEvent } from "react";
import { INVITATION_INVALID_MESSAGE, PasswordSchema, type Invitation } from "@cp-notes/shared";
import type { SignupEntry } from "../App";
import { acceptInvitation, ApiError, inspectInvitation } from "../api";

const recoveryMessage = "Account setup may have completed. Sign in with the password you just chose. If sign-in fails, ask the person who invited you for a new link.";

export function InvitationForm({ entry, onAccepted, onSignIn }: {
  entry: Extract<SignupEntry, { kind: "invitation" | "invalid" }>;
  onAccepted: (email: string) => void;
  onSignIn: (email: string, notice: string) => void;
}) {
  const token = entry.kind === "invitation" ? entry.token : null;
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(token !== null);
  const [inspectError, setInspectError] = useState(token === null ? INVITATION_INVALID_MESSAGE : "");
  const [invalid, setInvalid] = useState(token === null);
  const [revision, setRevision] = useState(0);
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

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current += 1; acceptance.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    setLoading(true);
    setInspectError("");
    setInvalid(false);
    void inspectInvitation(token, controller.signal).then((result) => {
      if (active && generation === requestGeneration.current) setInvitation(result);
    }).catch((caught: unknown) => {
      if (!active || generation !== requestGeneration.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setInvalid(caught instanceof ApiError && caught.code === "invitation_invalid");
      setInspectError(caught instanceof ApiError ? caught.message : "This invitation could not be checked. Try again shortly.");
    }).finally(() => { if (active && generation === requestGeneration.current) setLoading(false); });
    return () => { active = false; requestGeneration.current += 1; controller.abort(); };
  }, [token, revision]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || completed.current || !token || !invitation) return;
    if (!PasswordSchema.safeParse(password).success) { setError("Use a password with 12–128 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    submitting.current = true;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    acceptance.current = controller;
    setBusy(true);
    setError("");
    setRecovery(false);
    try {
      const result = await acceptInvitation(token, password, controller.signal);
      if (!mounted.current || generation !== requestGeneration.current) return;
      if (result.email !== invitation.email) throw new ApiError("invalid_response", "CP Notes returned an unreadable account setup response.");
      completed.current = true;
      setPassword("");
      setConfirmation("");
      setBusy(false);
      onAccepted(result.email);
    } catch (caught: unknown) {
      if (!mounted.current || generation !== requestGeneration.current) return;
      const definiteFailure = caught instanceof ApiError && caught.status !== undefined && caught.status >= 400 && caught.status < 500;
      const unavailable = caught instanceof ApiError && caught.code === "invitation_invalid";
      setRecovery(!definiteFailure || unavailable);
      setError(unavailable ? INVITATION_INVALID_MESSAGE : definiteFailure ? caught.message : recoveryMessage);
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
    setPassword("");
    setConfirmation("");
    onSignIn(invitation?.email ?? "", notice);
  }

  return <section className="account-card">
    <h2>Set up your account</h2>
    <p>Choose a password, then sign in to your diary. If you reload this page, reopen your original invitation link to continue setup.</p>
    {loading ? <p role="status">Checking your invitation...</p> : inspectError ? <>
      <p role="alert" className="inline-error">{inspectError}</p>
      {!invalid && <button className="button secondary" onClick={() => setRevision((value) => value + 1)}>Retry invitation check</button>}
    </> : invitation && <>
      <p>Invited email: <strong>{invitation.email}</strong></p>
      <p className="hint">This invitation expires {new Date(invitation.expiresAt).toLocaleString()}. Use 12–128 characters for your password.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <button className="button" disabled={busy || completed.current}>{busy ? "Creating account..." : "Create account"}</button>
      </form>
    </>}
    <p><button className="text-button" onClick={showSignIn}>{recovery ? "Sign in with the password you just chose" : "Go to sign in"}</button></p>
  </section>;
}
