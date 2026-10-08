import popupHtml from "../popup.html?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey } from "./storage";
const api = "http://localhost:3000/api";
const problem = "https://leetcode.com/problems/two-sum/";
const session = { token: "a".repeat(43), user: { id: 1, email: "a@example.com", createdAt: "2026-01-01" }, expiresAt: "2027-01-01T00:00:00.000Z" };
let data: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let access: ReturnType<typeof vi.fn>;
let queryTabs: ReturnType<typeof vi.fn>;
function field(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function input(id: string, value: string): void { field(id).value = value; field(id).dispatchEvent(new Event("input", { bubbles: true })); }
function response(value: unknown, status = 200) { return new Response(JSON.stringify({ data: value }), { status }); }
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "development");
  document.body.innerHTML = popupHtml.split("<body>")[1]!.split("</body>")[0]!;
  data = { [`session:${api}`]: session };
  access = vi.fn().mockResolvedValue(undefined);
  queryTabs = vi.fn().mockResolvedValue([{ id: 1, url: problem, title: "Two Sum - LeetCode" }]);
  vi.stubGlobal("chrome", {
    storage: { local: { setAccessLevel: access, get: vi.fn(async (key: string | null) => key ? { [key]: data[key] } : { ...data }), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, items); }), remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; }) } },
    tabs: { query: queryTabs },
    scripting: { executeScript: vi.fn().mockResolvedValue([{ result: "1. Two Sum" }]) },
    runtime: { getManifest: () => ({ version: "0.1.0" }) },
  });
  fetchMock = vi.fn().mockResolvedValue(response(session.user));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("initializes credentials before capture and preserves a draft through expiry and same-user login", async () => {
  const key = draftKey(api, 1, problem, "pattern");
  data[key] = { fields: { "pattern-trigger": "saved draft", "pattern-idea": "use a map", "pattern-complexity": "O(n)" }, pendingSave: false };
  await import("./popup");
  await vi.waitFor(() => expect(field("submit-button").disabled).toBe(false));
  expect(access).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  expect(field("pattern-trigger").value).toBe("saved draft");
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  document.getElementById("capture-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.getElementById("login-form")!.hidden).toBe(false));
  expect(data[key]).toBeTruthy();
  fetchMock.mockResolvedValueOnce(response(session));
  input("login-email", session.user.email); input("login-password", "some password");
  document.getElementById("login-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.getElementById("capture")!.hidden).toBe(false));
  expect(field("pattern-trigger").value).toBe("saved draft");
});

it("prevents duplicate submits and clears only a confirmed saved draft", async () => {
  await import("./popup");
  await vi.waitFor(() => expect(field("submit-button").disabled).toBe(false));
  input("pattern-trigger", "map lookup"); input("pattern-idea", "use a map"); input("pattern-complexity", "O(n)");
  let finish: (result: Response) => void = () => undefined;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const form = document.getElementById("capture-form")!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const key = draftKey(api, 1, problem, "pattern");
  expect(data[key]).toMatchObject({ pendingSave: true });
  finish(response({ id: 1 }, 201));
  await vi.waitFor(() => expect(data[key]).toBeUndefined());
  expect(field("pattern-trigger").value).toBe("");
});

it("offers a development signup link in a new tab without touching credentials or drafts", async () => {
  delete data[`session:${api}`];
  const key = draftKey(api, 1, problem, "pattern");
  data[key] = { fields: { "pattern-trigger": "kept draft" }, pendingSave: false };
  await import("./popup");
  await vi.waitFor(() => expect(document.getElementById("create-account")?.getAttribute("href")).toBe("http://localhost:5173/signup"));
  const link = document.getElementById("create-account")!;
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  expect(document.getElementById("login-form")?.textContent).toContain("same email and password");
  expect(data[key]).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(Object.keys(data)).toEqual([key]);
});

it.each(["blank", "restricted", "unsupported", "scrape failure", "expired", "session failure"])("keeps signup usable on %s tabs or failed initialization", async (state) => {
  if (state === "blank") queryTabs.mockResolvedValue([]);
  if (state === "restricted") queryTabs.mockResolvedValue([{ id: 1, url: "chrome://extensions", title: "Extensions" }]);
  if (state === "unsupported") queryTabs.mockResolvedValue([{ id: 1, url: "https://example.com", title: "Other page" }]);
  if (state === "scrape failure") queryTabs.mockRejectedValue(new Error("Cannot read active tab"));
  if (state === "expired") fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
  if (state === "session failure") fetchMock.mockRejectedValue(new Error("Offline"));
  await import("./popup");
  await vi.waitFor(() => expect(document.getElementById("create-account")?.getAttribute("href")).toBe("http://localhost:5173/signup"));
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("signup"))).toBe(true);
});

it("uses the configured API origin for production signup without /api", async () => {
  vi.stubEnv("MODE", "production");
  vi.stubEnv("VITE_BACKEND_URL", "https://notes.example.test/api");
  try {
    await import("./popup");
    await vi.waitFor(() => expect(document.getElementById("create-account")?.getAttribute("href")).toBe("https://notes.example.test/signup"));
    expect(document.getElementById("open-diary")?.getAttribute("href")).toBe("https://notes.example.test");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});
