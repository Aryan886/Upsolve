import popupHtml from "../popup.html?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey } from "./storage";
const api = "http://localhost:3000/api";
const problem = "https://leetcode.com/problems/two-sum/";
const session = { token: "a".repeat(43), user: { id: 1, email: "a@example.com", createdAt: "2026-01-01" }, expiresAt: "2027-01-01T00:00:00.000Z" };
let data: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let access: ReturnType<typeof vi.fn>;
function field(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function input(id: string, value: string): void { field(id).value = value; field(id).dispatchEvent(new Event("input", { bubbles: true })); }
function response(value: unknown, status = 200) { return new Response(JSON.stringify({ data: value }), { status }); }
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = popupHtml.split("<body>")[1]!.split("</body>")[0]!;
  data = { [`session:${api}`]: session };
  access = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("chrome", {
    storage: { local: { setAccessLevel: access, get: vi.fn(async (key: string | null) => key ? { [key]: data[key] } : { ...data }), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, items); }), remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; }) } },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: problem, title: "Two Sum - LeetCode" }]) },
    scripting: { executeScript: vi.fn().mockResolvedValue([{ result: "1. Two Sum" }]) },
    runtime: { getManifest: () => ({ version: "0.1.0" }) },
  });
  fetchMock = vi.fn().mockResolvedValue(response(session.user));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

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
