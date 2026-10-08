import { afterEach, expect, it, vi } from "vitest";
import { createAccount, acceptInvitation, clearSessionData, inspectInvitation, request } from "./api";
afterEach(() => { clearSessionData(); vi.unstubAllGlobals(); });
it("reports gateway failures without leaking HTML", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>bad gateway</h1>", { status: 502 })));
  await expect(request("/feed")).rejects.toMatchObject({ code: "invalid_response" });
});
it("ignores a delayed response from the previous account", async () => {
  let finish: (response: Response) => void = () => undefined;
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = request("/feed");
  clearSessionData();
  finish(new Response(JSON.stringify({ data: ["old private note"] })));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("notifies the website on session expiry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
  const expired = vi.fn();
  window.addEventListener("cp-notes-session-expired", expired);
  await expect(request("/feed")).rejects.toMatchObject({ code: "session_expired" });
  expect(expired).toHaveBeenCalledOnce();
  window.removeEventListener("cp-notes-session-expired", expired);
});

it("posts invitation credentials only in JSON bodies and validates both responses", async () => {
  const token = "a".repeat(43);
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { email: "tester@example.com", expiresAt: "2026-10-01T00:00:00.000Z" } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { email: "tester@example.com" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  await expect(inspectInvitation(token)).resolves.toMatchObject({ email: "tester@example.com" });
  await expect(acceptInvitation(token, "a long password")).resolves.toEqual({ email: "tester@example.com" });
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/auth/invitations/inspect");
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/auth/invitations/accept");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ token }) });
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ token, password: "a long password" }) });
});

it("rejects malformed successful invitation responses without exposing their contents", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { token: "private value" } }))));
  await expect(inspectInvitation("a".repeat(43))).rejects.toMatchObject({ code: "invalid_response" });
  await expect(acceptInvitation("a".repeat(43), "a long password")).rejects.toMatchObject({ code: "invalid_response" });
});

it("keeps invitation errors separate from session expiry and carries their HTTP status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invitation_invalid", message: "Unavailable" } }), { status: 400 })));
  const expired = vi.fn();
  window.addEventListener("cp-notes-session-expired", expired);
  try {
    await expect(inspectInvitation("a".repeat(43))).rejects.toMatchObject({ code: "invitation_invalid", status: 400 });
    expect(expired).not.toHaveBeenCalled();
  } finally { window.removeEventListener("cp-notes-session-expired", expired); }
});

it("lets a caller cancel an invitation acceptance", async () => {
  let finish: (response: Response) => void = () => undefined;
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = acceptInvitation("a".repeat(43), "a long password", controller.signal);
  controller.abort();
  finish(new Response(JSON.stringify({ data: { email: "tester@example.com" } }), { status: 201 }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("posts only email/password to public signup and validates its acknowledgment", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { email: "tester@example.com" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  expect(await createAccount("tester@example.com", "  a long password  ")).toEqual({ email: "tester@example.com" });
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/auth/signup");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ email: "tester@example.com", password: "  a long password  " }) });
});

it.each([{}, null, { email: "invalid" }, { email: "tester@example.com", token: "private" }])("rejects malformed signup acknowledgments", async (data) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 201 })));
  await expect(createAccount("tester@example.com", "a long password")).rejects.toMatchObject({ code: "invalid_response" });
});

it("keeps signup conflict separate from session expiry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "signup_unavailable", message: "Try signing in" } }), { status: 409 })));
  const expired = vi.fn();
  window.addEventListener("cp-notes-session-expired", expired);
  try {
    await expect(createAccount("tester@example.com", "a long password")).rejects.toMatchObject({ code: "signup_unavailable", status: 409 });
    expect(expired).not.toHaveBeenCalled();
  } finally { window.removeEventListener("cp-notes-session-expired", expired); }
});

it("ignores signup after account cancellation and reports timeout without replay", async () => {
  let finish: (response: Response) => void = () => undefined;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const pending = createAccount("tester@example.com", "a long password");
  clearSessionData();
  finish(new Response(JSON.stringify({ data: { email: "tester@example.com" } }), { status: 201 }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  vi.useFakeTimers();
  try {
    fetch.mockImplementationOnce((_url?: unknown, options?: RequestInit) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    }));
    const timedOut = expect(createAccount("tester@example.com", "a long password")).rejects.toMatchObject({ code: "service_unavailable" });
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
