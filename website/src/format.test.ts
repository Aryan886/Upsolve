import { describe, expect, it } from "vitest";
import { localDateBoundary, noteTags } from "./format";

describe("website formatting helpers", () => {
  it("uses inclusive local day boundaries", () => {
    const start = localDateBoundary("2026-09-12", false);
    const end = localDateBoundary("2026-09-12", true);
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    expect(new Date(end!).getTime() - new Date(start!).getTime()).toBe(86_399_999);
  });

  it("returns tags only for tagged note types", () => {
    expect(noteTags({ id: 1, problem: null, contestId: null, rootCause: "other", notes: "x", createdAt: "now" })).toEqual([]);
    expect(noteTags({ id: 1, name: "DSU", language: "cpp", code: "x", tags: ["graphs"], createdAt: "now" })).toEqual(["graphs"]);
  });
});
