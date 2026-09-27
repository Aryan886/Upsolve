import { describe, expect, it } from "vitest";
import { detectProblemPage, isLocalBackendUrl, normalizeProblemUrl, TagsSchema } from "./index.js";

describe("problem URL normalization", () => {
  it("deduplicates Codeforces contest and problemset URLs", () => {
    expect(normalizeProblemUrl("https://codeforces.com/contest/123/problem/A?locale=en")).toBe(
      "https://codeforces.com/problemset/problem/123/A",
    );
    expect(normalizeProblemUrl("https://codeforces.com/problemset/problem/123/A")).toBe(
      "https://codeforces.com/problemset/problem/123/A",
    );
  });

  it("detects CodeChef and AtCoder problem pages", () => {
    expect(detectProblemPage("https://www.codechef.com/START100/problems/HELLO")?.contestId).toBe("START100");
    expect(detectProblemPage("https://atcoder.jp/contests/abc100/tasks/abc100_a")?.platform).toBe("atcoder");
  });
});

describe("shared validation", () => {
  it("trims and case-insensitively deduplicates tags", () => {
    expect(TagsSchema.parse([" graphs ", "Graphs", "dp"])).toEqual(["graphs", "dp"]);
  });

  it("allows only local HTTP backend URLs", () => {
    expect(isLocalBackendUrl("http://localhost:3000")).toBe(true);
    expect(isLocalBackendUrl("http://127.0.0.1:4000/api")).toBe(true);
    expect(isLocalBackendUrl("https://example.com")).toBe(false);
  });
});


describe("LeetCode normalization", () => {
  it.each(["", "description/", "solutions/", "solutions/123/explanation/", "editorial/", "submissions/", "submissions/123/"])("canonicalizes the %s view", (view) => {
    expect(detectProblemPage(`https://leetcode.com/problems/two-sum/${view}?envType=study-plan#solution`)).toEqual({ platform: "leetcode", canonicalUrl: "https://leetcode.com/problems/two-sum/", contestId: null });
  });
  it("preserves contest context and recognizes www", () => {
    expect(detectProblemPage("https://www.leetcode.com/contest/weekly-contest-400/problems/two-sum/")).toEqual({ platform: "leetcode", canonicalUrl: "https://leetcode.com/problems/two-sum/", contestId: "weekly-contest-400" });
  });
  it.each(["https://leetcode.com/u/person", "https://leetcode.com/submissions/123/", "https://leetcode.com/problems/", "https://leetcode.com/problems/two-sum/unknown", "https://leetcode.com.evil.test/problems/two-sum/", "https://fake.leetcode.com/problems/two-sum/", "ftp://leetcode.com/problems/two-sum/", "https://leetcode.com/problems/two%2Fsum/"])("rejects %s", (url) => {
    expect(detectProblemPage(url)).toBeNull();
  });
});
