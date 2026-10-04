import { describe, expect, it } from "vitest";
import {
  detectProblemPage,
  isLocalBackendUrl,
  normalizeProblemUrl,
  TagsSchema,
  InvitationTokenSchema,
  InvitationInspectSchema,
  InvitationAcceptSchema,
  InvitationSchema,
  InvitationAcceptedSchema,
} from "./index.js";

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

describe("invitation validation", () => {
  const token = "Ab0_-".repeat(8) + "abc";
  const password = "a password with spaces";

  it("accepts the expected token form without changing it", () => {
    expect(InvitationTokenSchema.parse(token)).toBe(token);
    expect(InvitationInspectSchema.parse({ token })).toEqual({ token });
    expect(InvitationAcceptSchema.parse({ token, password })).toEqual({ token, password });
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["numeric", 123],
    ["empty", ""],
    ["short", "a".repeat(42)],
    ["long", "a".repeat(44)],
    ["padded", "a".repeat(42) + "="],
    ["invalid alphabet", "a".repeat(42) + "+"],
    ["leading whitespace", " " + "a".repeat(42)],
    ["trailing whitespace", "a".repeat(42) + " "],
  ])("rejects a %s token", (_label, value) => {
    expect(InvitationTokenSchema.safeParse(value).success).toBe(false);
    expect(InvitationInspectSchema.safeParse({ token: value }).success).toBe(false);
    expect(InvitationAcceptSchema.safeParse({ token: value, password }).success).toBe(false);
  });

  it("requires object bodies and the required fields", () => {
    for (const body of [undefined, null, [], token, {}]) {
      expect(InvitationInspectSchema.safeParse(body).success).toBe(false);
      expect(InvitationAcceptSchema.safeParse(body).success).toBe(false);
    }
    expect(InvitationAcceptSchema.safeParse({ token }).success).toBe(false);
    expect(InvitationAcceptSchema.safeParse({ password }).success).toBe(false);
  });

  it.each(["email", "userId", "active", "passwordHash", "expiresAt", "extra"])("rejects client supplied %s fields", (field) => {
    expect(InvitationInspectSchema.safeParse({ token, [field]: "override" }).success).toBe(false);
    expect(InvitationAcceptSchema.safeParse({ token, password, [field]: "override" }).success).toBe(false);
  });

  it("reuses the password length policy without trimming the chosen password", () => {
    expect(InvitationAcceptSchema.safeParse({ token, password: "a".repeat(11) }).success).toBe(false);
    expect(InvitationAcceptSchema.safeParse({ token, password: "a".repeat(129) }).success).toBe(false);
    expect(InvitationAcceptSchema.parse({ token, password: "a".repeat(12) }).password).toHaveLength(12);
    expect(InvitationAcceptSchema.parse({ token, password: "a".repeat(128) }).password).toHaveLength(128);
    expect(InvitationAcceptSchema.parse({ token, password: "  a password with spaces  " }).password).toBe("  a password with spaces  ");
  });

  it("validates safe invitation responses and UTC expiry", () => {
    const invitation = { email: "tester@example.com", expiresAt: "2026-10-01T12:00:00.000Z" };
    expect(InvitationSchema.parse(invitation)).toEqual(invitation);
    expect(InvitationAcceptedSchema.parse({ email: invitation.email })).toEqual({ email: invitation.email });
    expect(InvitationSchema.safeParse({ ...invitation, expiresAt: "not a date" }).success).toBe(false);
    expect(InvitationSchema.safeParse({ ...invitation, email: "invalid email" }).success).toBe(false);
    expect(InvitationAcceptedSchema.safeParse({}).success).toBe(false);
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
