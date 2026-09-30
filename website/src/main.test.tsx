import { afterEach, expect, it } from "vitest";
import { readInvitation } from "./App";

afterEach(() => { window.history.replaceState(null, "", "/"); });

it("captures an invitation once while removing its fragment and preserving path, query, and history state", () => {
  const token = "a".repeat(43);
  window.history.replaceState({ from: "before setup" }, "", `/setup?view=diary#invite=${token}`);
  expect(readInvitation()).toEqual({ token });
  expect(window.location.pathname).toBe("/setup");
  expect(window.location.search).toBe("?view=diary");
  expect(window.location.hash).toBe("");
  expect(window.history.state).toEqual({ from: "before setup" });
  expect(readInvitation()).toBeNull();
});

it.each(["", "short", "a".repeat(44), `${"a".repeat(42)}!`, `%E2%9C%93`])("rejects malformed fragments without retaining their values: %s", (value) => {
  window.history.replaceState(null, "", `/#invite=${value}`);
  expect(readInvitation()).toEqual({ invalid: true });
  expect(window.location.hash).toBe("");
});

it("rejects duplicate invitation parameters even when they contain the same token", () => {
  const token = "a".repeat(43);
  window.history.replaceState(null, "", `/#invite=${token}&invite=${token}`);
  expect(readInvitation()).toEqual({ invalid: true });
  expect(window.location.hash).toBe("");
});

it("preserves ordinary visits and unrelated hashes", () => {
  expect(readInvitation()).toBeNull();
  window.history.replaceState(null, "", "/?view=diary#start-here");
  expect(readInvitation()).toBeNull();
  expect(window.location.hash).toBe("#start-here");
});
