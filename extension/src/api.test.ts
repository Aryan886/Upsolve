import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("uses only the bearer credential and treats gateway HTML as a recoverable failure", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("<h1>Gateway error</h1>", { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await expect(request("https://notes.test/api", "/patterns", "token", { trigger: "private" })).rejects.toThrow("draft is kept");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", headers: { Authorization: "Bearer token" } });
});
it("turns expiry into a login action without retrying a write", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await expect(request("https://notes.test/api", "/patterns", "token", {})).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
