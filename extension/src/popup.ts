import { isLocalBackendUrl, NOTE_TYPES, type NoteType, type Platform } from "@cp-notes/shared";
import { ZodError } from "zod";
import "./styles.css";
import { getActiveProblemContext } from "./scraper";
import { buildSubmission, type CaptureFields, type ProblemFields } from "./submission";

const DEFAULT_BACKEND_URL = "http://localhost:3000";
let activeType: NoteType = "pattern";
let backendUrl = DEFAULT_BACKEND_URL;

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

function clearActiveFields(type: NoteType): void {
  const ids: Record<NoteType, string[]> = {
    pattern: ["pattern-trigger", "pattern-idea", "pattern-complexity", "pattern-tags"],
    mistake: ["mistake-notes"],
    snippet: ["snippet-name", "snippet-code", "snippet-tags"],
    editorial: ["editorial-line"],
  };
  ids[type].forEach((id) => setValue(id, ""));
}

async function submitNote(): Promise<void> {
  if (!isLocalBackendUrl(backendUrl)) {
    setStatus("form-status", "Save a valid localhost backend URL first.", "error");
    return;
  }
  let body: unknown;
  try {
    body = buildSubmission(activeType, captureFields(activeType), problemFields());
  } catch (error) {
    const message = error instanceof ZodError ? (error.issues[0]?.message ?? "Check the form values.") : error instanceof Error ? error.message : "Check the form values.";
    setStatus("form-status", message, "error");
    return;
  }

  const button = element<HTMLButtonElement>("submit-button");
  button.disabled = true;
  setStatus("form-status", "Saving…");
  const endpoint = activeType === "editorial" ? "/editorial" : `/${activeType}s`;
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Backend returned ${response.status}`);
    clearActiveFields(activeType);
    setStatus("form-status", `${activeType.charAt(0).toUpperCase()}${activeType.slice(1)} saved.`, "success");
  } catch (error) {
    setStatus(
      "form-status",
      error instanceof TypeError ? "Could not reach the backend. Start it and retry—your entry is still here." : error instanceof Error ? error.message : "Could not save this note.",
      "error",
    );
  } finally {
    button.disabled = false;
  }
}

async function loadBackendSetting(): Promise<void> {
  const stored = await chrome.storage.local.get("backendUrl");
  const candidate = typeof stored.backendUrl === "string" ? stored.backendUrl : DEFAULT_BACKEND_URL;
  backendUrl = isLocalBackendUrl(candidate) ? candidate.replace(/\/$/, "") : DEFAULT_BACKEND_URL;
  setValue("backend-url", backendUrl);
}

async function saveBackendSetting(): Promise<void> {
  const candidate = value("backend-url").trim().replace(/\/$/, "");
  if (!isLocalBackendUrl(candidate)) {
    setStatus("settings-status", "Use an http://localhost or http://127.0.0.1 URL.", "error");
    return;
  }
  await chrome.storage.local.set({ backendUrl: candidate });
  backendUrl = candidate;
  setStatus("settings-status", "Backend URL saved.", "success");
}

async function prefillProblem(): Promise<void> {
  try {
    const context = await getActiveProblemContext();
    if (!context) return;
    setValue("problem-name", context.name);
    setValue("problem-url", context.canonicalUrl);
    setValue("problem-platform", context.platform);
    setValue("problem-contest", context.contestId ?? "");
    setValue("mistake-contest", context.contestId ?? "");
    setValue("editorial-contest", context.contestId ?? "");
    element("site-badge").textContent = context.platform;
    element("detection-status").textContent = context.name ? "Detected" : "URL detected";
  } catch (error) {
    console.warn("CP Notes problem prefill failed:", error);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.type;
    if (NOTE_TYPES.includes(type as NoteType)) selectType(type as NoteType);
  });
});
element<HTMLFormElement>("capture-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitNote();
});
element<HTMLButtonElement>("save-backend").addEventListener("click", () => void saveBackendSetting());

selectType(activeType);
void loadBackendSetting();
void prefillProblem();
