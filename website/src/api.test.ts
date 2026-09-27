import { afterEach, expect, it, vi } from "vitest";
import { clearSessionData, request } from "./api";
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
