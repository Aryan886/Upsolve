import { afterEach, expect, it } from "vitest";
import { readSignupLink } from "./App";

afterEach(() => { window.history.replaceState(null, "", "/"); });

it("captures an invitation once while removing its fragment and preserving path, query, and history state", () => {
  const token = "a".repeat(43);
  window.history.replaceState({ from: "before setup" }, "", `/setup?view=diary#invite=${token}`);
  expect(readSignupLink()).toEqual({ kind: "invitation", token });
  expect(window.location.pathname).toBe("/setup");
  expect(window.location.search).toBe("?view=diary");
  expect(window.location.hash).toBe("");
  expect(window.history.state).toEqual({ from: "before setup" });
  expect(readSignupLink()).toBeNull();
});

it.each(["", "short", "a".repeat(44), `${"a".repeat(42)}!`, `%E2%9C%93`])("rejects malformed fragments without retaining their values: %s", (value) => {
  window.history.replaceState(null, "", `/#invite=${value}`);
  expect(readSignupLink()).toEqual({ kind: "invalid" });
  expect(window.location.hash).toBe("");
});

it("rejects duplicate invitation parameters even when they contain the same token", () => {
  const token = "a".repeat(43);
  window.history.replaceState(null, "", `/#invite=${token}&invite=${token}`);
  expect(readSignupLink()).toEqual({ kind: "invalid" });
  expect(window.location.hash).toBe("");
});

it("preserves ordinary visits and unrelated hashes", () => {
  expect(readSignupLink()).toBeNull();
  window.history.replaceState(null, "", "/?view=diary#start-here");
  expect(readSignupLink()).toBeNull();
  expect(window.location.hash).toBe("#start-here");
});

it("captures a shared beta link and rejects duplicate or mixed signup credentials", () => {
  const token = "b".repeat(43);
  window.history.replaceState({ returnTo: "diary" }, "", `/setup?source=friend#beta=${token}`);
  expect(readSignupLink()).toEqual({ kind: "beta", token });
  expect(window.location.pathname + window.location.search + window.location.hash).toBe("/setup?source=friend");
  expect(window.history.state).toEqual({ returnTo: "diary" });
  for (const fragment of [`#beta=${token}&beta=${token}`, `#invite=${token}&beta=${token}`, "#beta=short"]) {
    window.history.replaceState(null, "", `/${fragment}`);
    expect(readSignupLink()).toEqual({ kind: "invalid" });
    expect(window.location.hash).toBe("");
  }
});
