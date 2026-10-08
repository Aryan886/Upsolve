import { isLocalBackendUrl, NOTE_TYPES, UserSchema, type NoteType, type Platform } from "@cp-notes/shared";
import { ZodError } from "zod";
import "./styles.css";
import { getActiveProblemContext } from "./scraper";
import { buildSubmission, type CaptureFields, type ProblemFields } from "./submission";
import { ApiError, request } from "./api";
import { DraftStore, SessionSchema, draftKey, type Session } from "./storage";

const development = import.meta.env.MODE === "development";
const defaultApi = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
let api = defaultApi;
let activeType: NoteType = "pattern";
let session: Session | null = null;
let problemKey = "manual";
let prefilled: Record<string, string> = {};
let busy = true;
let pendingSave = false;
const drafts = new DraftStore(chrome.storage.local);

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element #${id}`);
  return found as T;
}

function value(id: string): string {
  return element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).value;
}

function setValue(id: string, nextValue: string): void {
  element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).value = nextValue;
}

function setStatus(id: string, message: string, kind: "success" | "error" | "neutral" = "neutral"): void {
  const status = element<HTMLParagraphElement>(id);
  status.textContent = message;
  status.className = `status ${kind}`;
}

function selectType(type: NoteType): void {
  activeType = type;
  document.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === type);
    button.setAttribute("aria-selected", String(button.dataset.type === type));
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    const isActive = panel.dataset.panel === type;
    panel.hidden = !isActive;
    panel.classList.toggle("active", isActive);
    panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((control) => {
      control.disabled = !isActive;
    });
  });
  element("problem-card").hidden = type === "snippet";
  element<HTMLButtonElement>("submit-button").textContent = `Save ${type}`;
  setStatus("form-status", "");
}

function problemFields(): ProblemFields {
  return {
    name: value("problem-name"),
    url: value("problem-url"),
    platform: value("problem-platform") as Platform,
    rating: value("problem-rating"),
    contestId: value("problem-contest"),
    tags: value("problem-tags"),
  };
}

function captureFields(type: NoteType): CaptureFields {
  switch (type) {
    case "pattern":
      return { trigger: value("pattern-trigger"), coreIdea: value("pattern-idea"), complexity: value("pattern-complexity"), tags: value("pattern-tags") };
    case "mistake":
      return { rootCause: value("mistake-cause"), notes: value("mistake-notes"), contestId: value("mistake-contest") };
    case "snippet":
      return { name: value("snippet-name"), language: value("snippet-language"), code: value("snippet-code"), tags: value("snippet-tags") };
    case "editorial":
      return { oneLiner: value("editorial-line"), contestId: value("editorial-contest") };
  }
}


function sessionKey(): string { return `session:${api}`; }
function currentDraftKey(): string {
  if (!session) throw new Error("Sign in before editing a draft.");
  return draftKey(api, session.user.id, problemKey, activeType);
}

function controls(): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#problem-card input, #problem-card select, [data-panel="${activeType}"] input, [data-panel="${activeType}"] textarea, [data-panel="${activeType}"] select`));
}

function snapshot(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const control of controls()) fields[control.id] = control.value;
  return fields;
}

function setBusy(next: boolean): void {
  busy = next;
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = next; });
  for (const control of controls()) control.disabled = next;
}

function showAccount(): void {
  element("login-form").hidden = session !== null;
  element("account").hidden = session === null;
  element("capture").hidden = session === null;
  element("account-email").textContent = session?.user.email ?? "";
}

function setWebsiteLinks(): void {
  const websiteOrigin = development ? "http://localhost:5173" : new URL(api).origin;
  element<HTMLAnchorElement>("open-diary").href = websiteOrigin;
  element<HTMLAnchorElement>("create-account").href = `${websiteOrigin}/signup`;
}

function resetFields(): void {
  element<HTMLFormElement>("capture-form").reset();
  for (const [id, field] of Object.entries(prefilled)) setValue(id, field);
  pendingSave = false;
}

async function restoreDraft(): Promise<void> {
  resetFields();
  const draft = await drafts.load(currentDraftKey());
  if (draft) {
    for (const control of controls()) if (draft.fields[control.id] !== undefined) control.value = draft.fields[control.id]!;
    pendingSave = draft.pendingSave;
    setStatus("form-status", pendingSave ? "A previous save may have completed. Check the diary before saving this recovered draft again." : "Unsent draft recovered.");
  }
}

async function saveDraft(): Promise<void> {
  if (!session) return;
  await drafts.save(currentDraftKey(), { fields: snapshot(), pendingSave });
}

function reportStorageError(error: unknown): void {
  console.warn("CP Notes could not update local draft storage", error instanceof Error ? error.name : "Unknown error");
  setStatus("form-status", "Could not store your draft. Keep this popup open and copy your text before closing it.", "error");
}

async function expireSession(): Promise<void> {
  await chrome.storage.local.remove(sessionKey());
  session = null;
  resetFields();
  showAccount();
  setStatus("login-status", "Your session ended. Sign in with the same account to recover your draft.");
}

async function submitNote(): Promise<void> {
  if (busy || !session) return;
  let body: unknown;
  try { body = buildSubmission(activeType, captureFields(activeType), problemFields()); }
  catch (error) {
    setStatus("form-status", error instanceof ZodError ? error.issues[0]?.message ?? "Check the form." : error instanceof Error ? error.message : "Check the form.", "error");
    return;
  }
  setBusy(true);
  const savedType = activeType;
  const key = currentDraftKey();
  let confirmed = false;
  try {
    pendingSave = true;
    await saveDraft();
    setStatus("form-status", "Saving?");
    await request(api, activeType === "editorial" ? "/editorial" : `/${activeType}s`, session.token, body);
    confirmed = true;
    await drafts.clear(key);
    resetFields();
    setStatus("form-status", `${savedType} saved. Open your diary to review it.`, "success");
  } catch (error) {
    if (confirmed) setStatus("form-status", "Note saved, but the local draft could not be cleared. Do not submit it again; discard the draft.", "error");
    else if (error instanceof ApiError && error.status === 401) {
      pendingSave = false;
      await saveDraft();
      await expireSession();
    } else if (error instanceof ApiError) {
      if (error.status >= 400 && error.status < 500) { pendingSave = false; await saveDraft(); }
      setStatus("form-status", error.message, "error");
    } else reportStorageError(error);
  } finally { setBusy(false); }
}

async function signIn(): Promise<void> {
  if (busy) return;
  setBusy(true);
  setStatus("login-status", "Signing in?");
  try {
    const response = await request(api, "/auth/extension-login", undefined, { email: value("login-email"), password: value("login-password") });
    const authenticated = SessionSchema.parse(response);
    await chrome.storage.local.set({ [sessionKey()]: authenticated });
    session = authenticated;
    setValue("login-password", "");
    showAccount();
    await restoreDraft();
    setStatus("login-status", "");
  } catch (error) { setStatus("login-status", error instanceof ApiError ? error.message : "Sign-in could not be completed. Check local extension storage and try again.", "error"); }
  finally { setBusy(false); }
}

async function signOut(): Promise<void> {
  if (busy || !session) return;
  setBusy(true);
  try {
    try { await request(api, "/auth/logout", session.token, {}); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    await drafts.clearAccount(api, session.user.id);
    await chrome.storage.local.remove(sessionKey());
    session = null;
    resetFields();
    showAccount();
    setStatus("login-status", "Signed out. Drafts for this account on this server were cleared.");
  } catch (error) { setStatus("form-status", error instanceof ApiError ? error.message : "Could not clear local account data. Try sign-out again.", "error"); }
  finally { setBusy(false); }
}

async function switchType(type: NoteType): Promise<void> {
  if (busy || !session || activeType === type) return;
  setBusy(true);
  try {
    await saveDraft();
    selectType(type);
    await restoreDraft();
  } catch (error) { reportStorageError(error); }
  finally { setBusy(false); }
}

async function loadSession(): Promise<void> {
  const stored = await chrome.storage.local.get(sessionKey());
  const parsed = SessionSchema.safeParse(stored[sessionKey()]);
  session = parsed.success ? parsed.data : null;
  if (session) {
    try {
      const user = UserSchema.parse(await request(api, "/auth/me", session.token));
      if (user.id !== session.user.id) throw new Error("Stored account did not match the session");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { await expireSession(); return; }
      session = null;
      showAccount();
      throw error;
    }
    await restoreDraft();
  }
  showAccount();
}

async function saveBackendSetting(): Promise<void> {
  if (busy || !development) return;
  const candidate = value("backend-url").trim().replace(/\/$/, "");
  if (!isLocalBackendUrl(candidate) || new URL(candidate).pathname !== "/api" || new URL(candidate).search || new URL(candidate).hash || new URL(candidate).username || new URL(candidate).password) {
    setStatus("settings-status", "Use http://localhost:PORT/api or http://127.0.0.1:PORT/api.", "error"); return;
  }
  setBusy(true);
  try {
    await saveDraft();
    await chrome.storage.local.set({ backendUrl: candidate });
    api = candidate;
    setWebsiteLinks();
    session = null;
    resetFields();
    showAccount();
    await loadSession();
    setStatus("settings-status", "Development server selected. Accounts and drafts are separate for each server.");
  } catch (error) { setStatus("settings-status", error instanceof ApiError ? error.message : "Could not load this server's account settings.", "error"); }
  finally { setBusy(false); }
}

async function initialize(): Promise<void> {
  setBusy(true);
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  if (development) {
    const stored = await chrome.storage.local.get("backendUrl");
    if (typeof stored.backendUrl === "string" && isLocalBackendUrl(stored.backendUrl)) {
      const candidate = new URL(stored.backendUrl);
      if (!candidate.username && !candidate.password && !candidate.search && !candidate.hash && candidate.pathname === "/api") api = candidate.toString().replace(/\/$/, "");
    }
  }
  element("settings").hidden = !development;
  setValue("backend-url", api);
  setWebsiteLinks();
  const context = await getActiveProblemContext();
  if (context) {
    problemKey = context.canonicalUrl;
    prefilled = { "problem-name": context.name, "problem-url": context.canonicalUrl, "problem-platform": context.platform, "problem-contest": context.contestId ?? "", "mistake-contest": context.contestId ?? "", "editorial-contest": context.contestId ?? "" };
    element("site-badge").textContent = context.platform;
    element("detection-status").textContent = context.name ? "Detected" : "Add a title";
  }
  element("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const feedback = import.meta.env.VITE_FEEDBACK_URL as string | undefined;
  if (feedback) { element<HTMLAnchorElement>("feedback").href = feedback; element("feedback").hidden = false; }
  selectType(activeType);
  resetFields();
  await loadSession();
  setBusy(false);
}

document.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.type as NoteType;
    if (NOTE_TYPES.includes(type)) void switchType(type);
  });
});
element<HTMLFormElement>("capture-form").addEventListener("submit", (event) => { event.preventDefault(); void submitNote().catch(reportStorageError); });
element("capture-form").addEventListener("input", () => { if (!busy) void saveDraft().catch(reportStorageError); });
element<HTMLFormElement>("login-form").addEventListener("submit", (event) => { event.preventDefault(); void signIn(); });
element("retry-connection").addEventListener("click", () => location.reload());
element("logout").addEventListener("click", () => void signOut());
element("save-backend").addEventListener("click", () => void saveBackendSetting());
element("discard").addEventListener("click", () => {
  if (busy || !session) return;
  setBusy(true);
  void drafts.clear(currentDraftKey()).then(() => { resetFields(); setStatus("form-status", "Draft discarded."); }).catch(reportStorageError).finally(() => setBusy(false));
});
void initialize().catch((error: unknown) => {
  console.warn("CP Notes popup initialization failed", error instanceof Error ? error.name : "Unknown error");
  element("retry-connection").hidden = false;
  element<HTMLButtonElement>("retry-connection").disabled = false;
  setStatus("login-status", error instanceof ApiError ? error.message : "Could not initialize the extension. Reopen it to retry; existing drafts are kept.", "error");
});
