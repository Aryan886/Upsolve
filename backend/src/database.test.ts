import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotesDatabase } from "./database.js";
import { hashToken } from "./auth.js";

let directory: string;
let path: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "cp-notes-test-")); path = join(directory, "legacy.db"); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

const invitationError = {
  status: 400,
  code: "invitation_invalid",
  message: "This invitation is invalid or no longer available. Sign in if you already created your account, or ask the person who invited you for a new link.",
};

function schemaTwo(): void {
  const database = new Database(path);
  try {
    database.exec(readFileSync(new URL("./fixtures/schema-v2.sql", import.meta.url), "utf8"));
    database.exec(`
      INSERT INTO users VALUES (7, 'owner@example.com', 'original password hash', 1, '2026-01-01');
      INSERT INTO users VALUES (8, 'disabled@example.com', 'disabled password hash', 0, '2026-01-02');
      INSERT INTO sessions VALUES ('website hash', 7, 'website', '2026-01-01', '2099-01-01T00:00:00.000Z');
      INSERT INTO sessions VALUES ('extension hash', 7, 'extension', '2026-01-01', '2099-01-01T00:00:00.000Z');
      INSERT INTO problems VALUES (42, 7, 'Old title', 'https://example.com/old?keep=yes', 'other', 1200, 'old contest', '["old tag"]', '2026-01-01');
      INSERT INTO patterns VALUES (11, 7, 'old trigger', 'old idea', 'O(1)', '[]', 42, '2026-01-01');
      INSERT INTO mistakes VALUES (12, 7, 42, 'contest', 'other', 'old mistake', '2026-01-01');
      INSERT INTO snippets VALUES (13, 7, 'old snippet', 'cpp', 'code', '[]', '2026-01-01');
      INSERT INTO editorial_takeaways VALUES (14, 7, 42, 'contest', 'old takeaway', '2026-01-01');
      INSERT INTO snippets VALUES (15, 8, 'private snippet', 'cpp', 'private code', '[]', '2026-01-02');
    `);
  } finally { database.close(); }
}

function existingRows(database: Database.Database): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  for (const table of ["users", "sessions", "problems", "patterns", "mistakes", "snippets", "editorial_takeaways"]) {
    rows[table] = database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  }
  return rows;
}

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
  const source = new Database(path);
  expect(source.pragma("user_version", { simple: true })).toBe(4);
  source.close();
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
  expect(source.pragma("user_version", { simple: true })).toBe(4);
  expect(source.prepare("PRAGMA table_info(invitations)").all()).toMatchObject([
    { name: "email", type: "TEXT", notnull: 1, pk: 1 },
    { name: "token_hash", type: "TEXT", notnull: 1 },
    { name: "created_at", type: "TEXT", notnull: 1 },
    { name: "expires_at", type: "TEXT", notnull: 1 },
  ]);
  source.pragma("user_version = 99");
  source.close();
  expect(() => new NotesDatabase(path)).toThrow("not supported");
});

it("requires explicit initialization for an existing empty file", () => {
  const source = new Database(path);
  source.close();
  expect(() => new NotesDatabase(path, { existingOnly: true })).toThrow("not initialized");
  const unchanged = new Database(path);
  expect(unchanged.pragma("user_version", { simple: true })).toBe(0);
  expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
  unchanged.close();
});

it("upgrades populated schema 2 without rewriting users, sessions, notes or links", () => {
  schemaTwo();
  const original = new Database(path);
  const rows = existingRows(original);
  const schema = original.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  original.close();
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(database.getUserByEmail("owner@example.com")).toMatchObject({ id: 7, passwordHash: "original password hash", active: true });
    expect(database.getUserByEmail("disabled@example.com")).toMatchObject({ id: 8, passwordHash: "disabled password hash", active: false });
    expect(database.getSession("website hash", "website")?.id).toBe(7);
    expect(database.getSession("extension hash", "extension")?.id).toBe(7);
    expect(database.getPattern(7, 11)).toMatchObject({ problem: { id: 42, url: "https://example.com/old?keep=yes", tags: ["old tag"] } });
    expect(database.listFeed(7, { page: 1, limit: 20 }).meta.total).toBe(4);
    expect(database.listFeed(8, { page: 1, limit: 20 }).meta.total).toBe(1);
    const source = new Database(path);
    try {
      expect(existingRows(source)).toEqual(rows);
      expect(source.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT IN ('invitations', 'beta_signup') ORDER BY name").all()).toEqual(schema);
      expect(source.pragma("user_version", { simple: true })).toBe(4);
      expect(source.pragma("foreign_key_check")).toEqual([]);
      expect(source.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally { source.close(); }
  } finally { database.close(); }
  const reopened = new NotesDatabase(path, { existingOnly: true });
  try { expect(reopened.getSession("extension hash", "extension")?.id).toBe(7); }
  finally { reopened.close(); }
});

it("rolls back schema-3 DDL and its version when migration fails after advancing the version", () => {
  schemaTwo();
  const original = new Database(path);
  const rows = existingRows(original);
  original.close();
  const pragma = Database.prototype.pragma;
  const failure = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, sql: string, options?: Database.PragmaOptions) {
    const result = pragma.call(this, sql, options);
    if (sql === "user_version = 3") throw new Error("Synthetic migration failure");
    return result;
  });
  expect(() => new NotesDatabase(path, { existingOnly: true })).toThrow("Synthetic migration failure");
  failure.mockRestore();
  const source = new Database(path);
  try {
    expect(source.pragma("user_version", { simple: true })).toBe(2);
    expect(source.prepare("SELECT name FROM sqlite_master WHERE name = 'invitations'").get()).toBeUndefined();
    expect(existingRows(source)).toEqual(rows);
    expect(source.pragma("foreign_key_check")).toEqual([]);
  } finally { source.close(); }
});

it("upgrades schema 3 to 4 without changing existing accounts, notes, sessions or invitations", () => {
  schemaTwo();
  const source = new Database(path);
  source.exec(`CREATE TABLE invitations (email TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    INSERT INTO invitations VALUES ('new@example.com', 'old invitation hash', '2026-01-01', '2099-01-01');
    PRAGMA user_version = 3;`);
  const rows = existingRows(source);
  const invitation = source.prepare("SELECT * FROM invitations").get();
  source.close();
  const upgraded = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(upgraded.getBetaStatus()).toMatchObject({ state: "not issued", signupCount: 0, remainingSignups: 30 });
    expect(upgraded.getInvitation("old invitation hash")?.email).toBe("new@example.com");
    expect(upgraded.getSession("website hash", "website")?.id).toBe(7);
    const check = new Database(path);
    try {
      expect(check.pragma("user_version", { simple: true })).toBe(4);
      expect(existingRows(check)).toEqual(rows);
      expect(check.prepare("SELECT * FROM invitations").get()).toEqual(invitation);
      expect(check.pragma("foreign_key_check")).toEqual([]);
    } finally { check.close(); }
  } finally { upgraded.close(); }
});

it("rolls back schema-4 DDL and version together on migration failure", () => {
  schemaTwo();
  const source = new Database(path);
  source.exec(`CREATE TABLE invitations (email TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    PRAGMA user_version = 3;`);
  source.close();
  const pragma = Database.prototype.pragma;
  const failure = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, sql: string, options?: Database.PragmaOptions) {
    const result = pragma.call(this, sql, options);
    if (sql === "user_version = 4") throw new Error("Synthetic beta migration failure");
    return result;
  });
  expect(() => new NotesDatabase(path, { existingOnly: true })).toThrow("Synthetic beta migration failure");
  failure.mockRestore();
  const check = new Database(path);
  try {
    expect(check.pragma("user_version", { simple: true })).toBe(3);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'beta_signup'").get()).toBeUndefined();
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'invitations'").get()).toBeDefined();
  } finally { check.close(); }
});

it("issues only a stored hash, normalizes email and replaces the previous invitation", () => {
  const database = new NotesDatabase(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const token = "a".repeat(43);
  const tokenHash = hashToken(token);
  try {
    expect(database.issueInvitation(" Tester@Example.com ", tokenHash, expiresAt)).toEqual({ email: "tester@example.com", expiresAt });
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getInvitation(tokenHash)).toEqual({ email: "tester@example.com", expiresAt });
    expect(database.getInvitation(tokenHash)).toEqual({ email: "tester@example.com", expiresAt });
    const source = new Database(path);
    try {
      expect(source.prepare("SELECT email, token_hash, expires_at FROM invitations").get()).toEqual({ email: "tester@example.com", token_hash: tokenHash, expires_at: expiresAt });
      expect(JSON.stringify(source.prepare("SELECT * FROM invitations").all())).not.toContain(token);
    } finally { source.close(); }
    const replacement = hashToken("b".repeat(43));
    database.issueInvitation("tester@example.com", replacement, expiresAt);
    expect(database.getInvitation(tokenHash)).toBeNull();
    expect(database.getInvitation(replacement)).toEqual({ email: "tester@example.com", expiresAt });
    expect(() => database.acceptInvitation(tokenHash, "hash")).toThrowError(expect.objectContaining(invitationError));
  } finally { database.close(); }
});

it("rejects invitations for existing active or disabled users and preserves existing records", () => {
  schemaTwo();
  const database = new NotesDatabase(path, { existingOnly: true });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    for (const email of ["owner@example.com", "disabled@example.com"]) {
      expect(() => database.issueInvitation(email, hashToken(email), expiresAt)).toThrowError(expect.objectContaining({ code: "account_exists" }));
    }
    expect(database.getUserByEmail("owner@example.com")?.passwordHash).toBe("original password hash");
    expect(database.getUserByEmail("disabled@example.com")?.active).toBe(false);
    expect(database.getSession("website hash", "website")?.id).toBe(7);
  } finally { database.close(); }
});

it("preserves a prior invitation when replacement fails with a token uniqueness conflict", () => {
  const database = new NotesDatabase(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("a@example.com", "first hash", expiresAt);
    database.issueInvitation("b@example.com", "second hash", expiresAt);
    expect(() => database.issueInvitation("a@example.com", "second hash", expiresAt)).toThrow("UNIQUE constraint failed");
    expect(database.getInvitation("first hash")?.email).toBe("a@example.com");
    expect(database.getInvitation("second hash")?.email).toBe("b@example.com");
  } finally { database.close(); }
});

it("revokes only the normalized intended invitation and reports a missing row", () => {
  const database = new NotesDatabase(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("a@example.com", "first hash", expiresAt);
    database.issueInvitation("b@example.com", "second hash", expiresAt);
    expect(database.revokeInvitation(" A@EXAMPLE.COM ")).toBe(true);
    expect(database.revokeInvitation("a@example.com")).toBe(false);
    expect(database.getInvitation("first hash")).toBeNull();
    expect(database.getInvitation("second hash")?.email).toBe("b@example.com");
    expect(() => database.acceptInvitation("first hash", "hash")).toThrowError(expect.objectContaining(invitationError));
    expect(database.getUserByEmail("a@example.com")).toBeNull();
  } finally { database.close(); }
});

it("accepts once, creates a normal active user, and persists no session or invitation", () => {
  const database = new NotesDatabase(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("tester@example.com", "invitation hash", expiresAt);
    expect(database.acceptInvitation("invitation hash", "password hash")).toEqual({ email: "tester@example.com" });
    expect(database.getUserByEmail("tester@example.com")).toMatchObject({ email: "tester@example.com", passwordHash: "password hash", active: true });
    expect(database.getInvitation("invitation hash")).toBeNull();
    expect(() => database.acceptInvitation("invitation hash", "other password")).toThrowError(expect.objectContaining(invitationError));
    const source = new Database(path);
    try {
      expect(source.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
      expect(source.prepare("SELECT COUNT(*) AS count FROM invitations").get()).toEqual({ count: 0 });
      expect(source.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    } finally { source.close(); }
  } finally { database.close(); }
});

it("rejects unknown invitations and expiry at the exact current time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
  const database = new NotesDatabase(path);
  try {
    database.issueInvitation("tester@example.com", "hash", "2026-09-29T12:00:01.000Z");
    expect(database.getInvitation("hash")?.email).toBe("tester@example.com");
    vi.setSystemTime(new Date("2026-09-29T12:00:01.000Z"));
    expect(database.getInvitation("hash")).toBeNull();
    for (const tokenHash of ["hash", "unknown"]) {
      expect(() => database.acceptInvitation(tokenHash, "password hash")).toThrowError(expect.objectContaining(invitationError));
    }
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
  } finally { database.close(); }
});

it("rechecks changes from a separate operator connection before acceptance", () => {
  const database = new NotesDatabase(path);
  const operator = new NotesDatabase(path, { existingOnly: true });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("tester@example.com", "old hash", expiresAt);
    expect(database.getInvitation("old hash")?.email).toBe("tester@example.com");
    operator.issueInvitation("tester@example.com", "new hash", expiresAt);
    expect(() => database.acceptInvitation("old hash", "hash")).toThrowError(expect.objectContaining(invitationError));
    expect(database.getInvitation("new hash")?.email).toBe("tester@example.com");
    operator.createUser("tester@example.com", "operator password hash");
    expect(database.getInvitation("new hash")).toBeNull();
    expect(() => database.acceptInvitation("new hash", "hash")).toThrowError(expect.objectContaining(invitationError));
    expect(database.getUserByEmail("tester@example.com")?.passwordHash).toBe("operator password hash");
    expect(operator.revokeInvitation("tester@example.com")).toBe(true);
  } finally { operator.close(); database.close(); }
});

it("maps a final user-email uniqueness conflict to an invalid invitation and rolls back", () => {
  const database = new NotesDatabase(path);
  const source = new Database(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("tester@example.com", "hash", expiresAt);
    source.exec(`CREATE TRIGGER insert_conflicting_user BEFORE INSERT ON users BEGIN
      INSERT INTO users (email, password_hash, created_at) VALUES (NEW.email, 'conflicting hash', NEW.created_at);
    END`);
    expect(() => database.acceptInvitation("hash", "password hash")).toThrowError(expect.objectContaining(invitationError));
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getInvitation("hash")).toEqual({ email: "tester@example.com", expiresAt });
  } finally { source.close(); database.close(); }
});

it.each(["insert", "delete", "missing deletion"])("rolls back user creation and invitation consumption after a %s failure", (failure) => {
  const database = new NotesDatabase(path);
  const source = new Database(path);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    database.issueInvitation("tester@example.com", "hash", expiresAt);
    const table = failure === "insert" ? "users" : "invitations";
    const operation = failure === "insert" ? "INSERT" : "DELETE";
    const action = failure === "missing deletion" ? "RAISE(IGNORE)" : "RAISE(ABORT, 'Synthetic write failure')";
    source.exec(`CREATE TRIGGER fail_invitation_write BEFORE ${operation} ON ${table} BEGIN SELECT ${action}; END`);
    if (failure === "missing deletion") {
      expect(() => database.acceptInvitation("hash", "password hash")).toThrowError(expect.objectContaining(invitationError));
    } else {
      expect(() => database.acceptInvitation("hash", "password hash")).toThrow("Synthetic write failure");
    }
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getInvitation("hash")).toEqual({ email: "tester@example.com", expiresAt });
    source.exec("DROP TRIGGER fail_invitation_write");
    expect(database.acceptInvitation("hash", "password hash")).toEqual({ email: "tester@example.com" });
  } finally { source.close(); database.close(); }
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
