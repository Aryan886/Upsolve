import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NotesDatabase } from "./database.js";
import { hashToken } from "./auth.js";

let directory: string;
let path: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "cp-notes-test-")); path = join(directory, "legacy.db"); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function legacy(broken = false): void {
  const database = new Database(path);
  if (broken) database.pragma("foreign_keys = OFF");
  database.exec(readFileSync(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8"));
  database.prepare("INSERT INTO problems VALUES (42, 'Old title', 'https://example.com/old?keep=yes', 'other', 1200, 'old contest', '[\"old tag\"]', '2026-01-01')").run();
  database.prepare("INSERT INTO patterns VALUES (11, 'old trigger', 'old idea', 'O(1)', '[]', ?, '2026-01-01')").run(broken ? 999 : 42);
  database.exec("INSERT INTO mistakes VALUES (12, 42, 'contest', 'other', 'old mistake', '2026-01-01'); INSERT INTO snippets VALUES (13, 'old snippet', 'cpp', 'code', '[]', '2026-01-01'); INSERT INTO editorial_takeaways VALUES (14, 42, 'contest', 'old takeaway', '2026-01-01')");
  database.close();
}

it("requires an explicit legacy owner and preserves IDs, links and content", () => {
  legacy();
  expect(() => new NotesDatabase(path)).toThrow("explicit owner");
  const database = new NotesDatabase(path, { legacyOwner: { email: "owner@example.com", passwordHash: "test hash" } });
  expect(database.listFeed(1, { page: 1, limit: 20 }).meta.total).toBe(4);
  expect(database.getPattern(1, 11)).toMatchObject({ trigger: "old trigger", coreIdea: "old idea", problem: { id: 42, name: "Old title", url: "https://example.com/old?keep=yes", tags: ["old tag"] } });
  expect(database.getMistake(1, 12).notes).toBe("old mistake");
  expect(database.getSnippet(1, 13).code).toBe("code");
  expect(database.getEditorial(1, 14).oneLiner).toBe("old takeaway");
  database.createSession(1, "test hash", hashToken("a".repeat(43)), "extension", new Date(Date.now() + 60_000).toISOString());
  database.close();
  const reopened = new NotesDatabase(path, { existingOnly: true });
  expect(reopened.getSession(hashToken("a".repeat(43)), "extension")?.email).toBe("owner@example.com");
  expect(reopened.listFeed(1, { page: 1, limit: 20 }).meta.total).toBe(4);
  reopened.close();
});

it("rolls back a failed migration including ownership and schema version", () => {
  legacy(true);
  expect(() => new NotesDatabase(path, { legacyOwner: { email: "owner@example.com", passwordHash: "test" } })).toThrow();
  const source = new Database(path);
  expect(source.pragma("user_version", { simple: true })).toBe(1);
  expect(source.prepare("SELECT name FROM sqlite_master WHERE name='users'").get()).toBeUndefined();
  expect(source.prepare("SELECT trigger FROM patterns WHERE id=11").get()).toEqual({ trigger: "old trigger" });
  source.close();
});

it("initializes empty databases but rejects missing expected files and newer schemas", () => {
  expect(() => new NotesDatabase(path, { existingOnly: true })).toThrow();
  const database = new NotesDatabase(path);
  database.close();
  const source = new Database(path);
  expect(source.pragma("foreign_key_check")).toEqual([]);
  expect(source.pragma("user_version", { simple: true })).toBe(2);
  source.pragma("user_version = 99");
  source.close();
  expect(() => new NotesDatabase(path)).toThrow("not supported");
});


it("reclassifies a canonical LeetCode problem without overwriting manual metadata", () => {
  const database = new NotesDatabase(path);
  try {
    database.createUser("a@example.com", "hash");
    database.createUser("b@example.com", "hash");
    const original = database.upsertProblem(1, { name: "My title", url: "https://leetcode.com/problems/two-sum/", platform: "other", rating: 1400, tags: ["mine"] });
    const reused = database.upsertProblem(1, { name: "Scraped title", url: "https://leetcode.com/problems/two-sum/solutions/?x=y", platform: "leetcode", tags: ["new"] });
    expect(reused).toMatchObject({ id: original.id, name: "My title", platform: "leetcode", rating: 1400, tags: ["mine"] });
    expect(database.upsertProblem(2, { name: "B title", url: reused.url, platform: "leetcode" }).id).not.toBe(original.id);
  } finally { database.close(); }
});
