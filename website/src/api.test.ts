import { afterEach, expect, it, vi } from "vitest";
import { acceptBetaSignup, acceptInvitation, clearSessionData, inspectBetaSignup, inspectInvitation, request } from "./api";
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

it("posts shared beta credentials in JSON and validates both responses", async () => {
  const token = "b".repeat(43);
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { expiresAt: "2030-01-08T00:00:00.000Z", remainingSignups: 29 } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { email: "tester@example.com" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  expect(await inspectBetaSignup(token)).toMatchObject({ remainingSignups: 29 });
  expect(await acceptBetaSignup(token, "tester@example.com", "a long password")).toEqual({ email: "tester@example.com" });
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/auth/beta/inspect");
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/auth/beta/accept");
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ token, email: "tester@example.com", password: "a long password" }) });
});

it("rejects malformed beta responses and keeps beta errors separate from session expiry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { remainingSignups: 30, token: "secret" } }))));
  await expect(inspectBetaSignup("b".repeat(43))).rejects.toMatchObject({ code: "invalid_response" });
  await expect(acceptBetaSignup("b".repeat(43), "tester@example.com", "a long password")).rejects.toMatchObject({ code: "invalid_response" });
  const expired = vi.fn();
  window.addEventListener("cp-notes-session-expired", expired);
  try {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "beta_full", message: "Full" } }), { status: 400 })));
    await expect(inspectBetaSignup("b".repeat(43))).rejects.toMatchObject({ code: "beta_full", status: 400 });
    expect(expired).not.toHaveBeenCalled();
  } finally { window.removeEventListener("cp-notes-session-expired", expired); }
});
