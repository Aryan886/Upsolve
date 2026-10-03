import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeOwner, runAdmin } from "./admin.js";
import { hashToken } from "./auth.js";
import { NotesDatabase } from "./database.js";
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "cp-admin-test-")); });
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function initializeDatabase(): string {
  const path = join(directory, "notes.db");
  new NotesDatabase(path).close();
  return path;
}

function environmentFor(path: string): NodeJS.ProcessEnv {
  return { DATABASE_PATH: path, LOCAL_DEVELOPMENT: "true", APP_ORIGIN: "http://localhost:5173" };
}

async function issueBetaLink(path: string, settings: NodeJS.ProcessEnv = {}): Promise<{ token: string; message: string }> {
  let message = "";
  await runAdmin(["beta-link"], { ...environmentFor(path), ...settings }, async (output) => { message = output; });
  const token = /#beta=([A-Za-z0-9_-]{43})/.exec(message)?.[1];
  if (!token) throw new Error("Beta command did not produce a link");
  return { token, message };
}

async function issueInvitation(path: string, email: string, settings: NodeJS.ProcessEnv = {}): Promise<{ token: string; message: string }> {
  let message = "";
  await runAdmin(["invite", email], { ...environmentFor(path), ...settings }, async (output) => { message = output; });
  const token = /#invite=([A-Za-z0-9_-]{43})/.exec(message)?.[1];
  if (!token) throw new Error("Invitation command did not produce a setup link");
  return { token, message };
}
it("initializes an explicit owner in a fresh database and refuses reinitialization", async () => {
  const path = join(directory, "notes.db");
  await initializeOwner(path, "OWNER@example.com", "test hash");
  const database = new NotesDatabase(path, { existingOnly: true });
  expect(database.getUserByEmail("owner@example.com")?.passwordHash).toBe("test hash");
  database.close();
  await expect(initializeOwner(path, "other@example.com", "test hash")).rejects.toThrow("already initialized");
});
it("backs up schema 1 before assigning its records to the explicitly named owner", async () => {
  const path = join(directory, "legacy.db");
  const source = new Database(path);
  source.exec(await readFile(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8"));
  source.exec("INSERT INTO snippets VALUES (27, 'old name', 'cpp', 'old code', '[]', '2026-01-01')");
  source.close();
  await initializeOwner(path, "owner@example.com", "test hash");
  const backups = await readdir(join(directory, "backups"));
  const backup = new Database(join(directory, "backups", backups.find((file) => file.endsWith(".db"))!), { readonly: true });
  expect(backup.pragma("user_version", { simple: true })).toBe(1);
  backup.close();
  const database = new NotesDatabase(path);
  expect(database.getSnippet(1, 27).code).toBe("old code");
  database.close();
});

it("issues a normalized, expiring invitation without creating a user or storing its token", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  const path = initializeDatabase();
  const invitation = await issueInvitation(path, "  TESTER@Example.com  ");
  const expiresAt = "2030-01-04T00:00:00.000Z";
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getInvitation(hashToken(invitation.token))).toEqual({ email: "tester@example.com", expiresAt });
  } finally { database.close(); }
  const source = new Database(path, { readonly: true, fileMustExist: true });
  try {
    expect(source.prepare("SELECT * FROM invitations").get()).toEqual({
      email: "tester@example.com", token_hash: hashToken(invitation.token),
      created_at: "2030-01-01T00:00:00.000Z", expires_at: expiresAt,
    });
  } finally { source.close(); }
  expect(invitation.message).toContain("Invitation for tester@example.com");
  expect(invitation.message).toContain(`Expires: ${expiresAt}`);
  expect(invitation.message).toContain("Share privately");
  expect(invitation.message).toContain("Reissuing replaces");
  expect(invitation.message.match(/#invite=/g)).toHaveLength(1);
});

it("issues, reports, rotates and revokes a shared beta link without resetting usage", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  const path = initializeDatabase();
  const first = await issueBetaLink(path);
  expect(first.message).toContain("2030-01-08T00:00:00.000Z");
  expect(first.message).toContain("0 / 30");
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    database.acceptBetaSignup(hashToken(first.token), "first@example.com", "stored hash");
    const next = await issueBetaLink(path, { BETA_SIGNUP_HOURS: "2" });
    expect(next.token).not.toBe(first.token);
    expect(next.message).toContain("1 / 30");
    expect(next.message).toContain("2030-01-01T02:00:00.000Z");
    expect(database.getBetaSignup(hashToken(first.token))).toBeNull();
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runAdmin(["beta-status"], { DATABASE_PATH: path });
    expect(output).toHaveBeenLastCalledWith(expect.stringContaining("open; 1 / 30 signups; 29 remaining"));
    expect(JSON.stringify(output.mock.calls)).not.toContain(next.token);
    await runAdmin(["revoke-beta-link"], { DATABASE_PATH: path });
    expect(database.getBetaSignup(hashToken(next.token))).toBeNull();
    await runAdmin(["revoke-beta-link"], { DATABASE_PATH: path });
    expect(output).toHaveBeenLastCalledWith("No active shared beta signup link");
    expect(database.getBetaStatus()).toMatchObject({ state: "revoked", signupCount: 1 });
  } finally { database.close(); }
});

it("validates beta CLI arguments and configuration before changing the active link", async () => {
  const path = initializeDatabase();
  const first = await issueBetaLink(path);
  for (const args of [["beta-link", "email@example.com"], ["beta-status", "extra"], ["revoke-beta-link", "extra"]]) {
    await expect(runAdmin(args, environmentFor(path))).rejects.toThrow("Usage");
  }
  for (const settings of [{ APP_ORIGIN: "http://example.test" }, { BETA_SIGNUP_HOURS: "169" }, { BETA_SIGNUP_HOURS: "" }]) {
    await expect(issueBetaLink(path, settings)).rejects.toThrow();
  }
  const database = new NotesDatabase(path, { existingOnly: true });
  try { expect(database.getBetaSignup(hashToken(first.token))).not.toBeNull(); }
  finally { database.close(); }
  const missing = join(directory, "missing.db");
  await expect(issueBetaLink(missing)).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
  await expect(runAdmin(["beta-status"], { DATABASE_PATH: missing })).rejects.toThrow();
});

it("reports a failed shared-link output and leaves replacement possible", async () => {
  const path = initializeDatabase();
  await expect(runAdmin(["beta-link"], environmentFor(path), async () => { throw new Error("broken output"); }))
    .rejects.toThrow("Shared beta link output failed");
  expect((await issueBetaLink(path)).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it("uses a configured lifetime and invalidates the prior link on reissue", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  const path = initializeDatabase();
  const first = await issueInvitation(path, "tester@example.com");
  const second = await issueInvitation(path, "TESTER@example.com", { INVITATION_HOURS: "2" });
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(second.token).not.toBe(first.token);
    expect(database.getInvitation(hashToken(first.token))).toBeNull();
    expect(database.getInvitation(hashToken(second.token))).toEqual({ email: "tester@example.com", expiresAt: "2030-01-01T02:00:00.000Z" });
  } finally { database.close(); }
});

it("revokes only the named invitation and reports a missing invitation without a password prompt", async () => {
  const path = initializeDatabase();
  const first = await issueInvitation(path, "tester@example.com");
  const other = await issueInvitation(path, "other@example.com");
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await runAdmin(["revoke-invite", "  TESTER@Example.com  "], { DATABASE_PATH: path });
  expect(output).toHaveBeenLastCalledWith("Invitation revoked for tester@example.com");
  await runAdmin(["revoke-invite", "tester@example.com"], { DATABASE_PATH: path });
  expect(output).toHaveBeenLastCalledWith("No outstanding invitation for tester@example.com");
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(database.getInvitation(hashToken(first.token))).toBeNull();
    expect(database.getInvitation(hashToken(other.token))?.email).toBe("other@example.com");
  } finally { database.close(); }
});

it("rejects existing active and disabled accounts without changing users, notes or sessions", async () => {
  const path = initializeDatabase();
  const database = new NotesDatabase(path, { existingOnly: true });
  try {
    database.createUser("active@example.com", "active hash");
    database.createUser("disabled@example.com", "disabled hash");
    database.disableUser(2);
    database.createSession(1, "active hash", "session hash", "extension", new Date(Date.now() + 60_000).toISOString());
    database.createSnippet(1, { name: "saved", language: "cpp", code: "private code" });
  } finally { database.close(); }
  for (const email of ["active@example.com", "disabled@example.com"]) {
    await expect(issueInvitation(path, email)).rejects.toThrow("account with this email already exists");
  }
  const reopened = new NotesDatabase(path, { existingOnly: true });
  try {
    expect(reopened.getUserByEmail("active@example.com")?.passwordHash).toBe("active hash");
    expect(reopened.getUserByEmail("disabled@example.com")?.active).toBe(false);
    expect(reopened.getSession("session hash", "extension")?.email).toBe("active@example.com");
    expect(reopened.listSnippets(1, { page: 1, limit: 20 }).meta.total).toBe(1);
  } finally { reopened.close(); }
});

it("validates email, origin, lifetime and extra arguments before writing", async () => {
  const path = initializeDatabase();
  const initial = await issueInvitation(path, "tester@example.com");
  for (const settings of [{ APP_ORIGIN: "https://notes.test/path" }, { INVITATION_HOURS: "169" }, { LOCAL_DEVELOPMENT: "false" }]) {
    await expect(issueInvitation(path, "tester@example.com", settings)).rejects.toThrow();
  }
  for (const argumentsList of [
    ["invite", "tester@example.com", "extra-secret"], ["revoke-invite", "tester@example.com", "extra-secret"],
    ["invite"], ["revoke-invite"], ["invite", "not-an-email"], ["revoke-invite", "not-an-email"],
    ["unknown", "tester@example.com"], ["benchmark", "tester@example.com"],
  ]) await expect(runAdmin(argumentsList, environmentFor(path))).rejects.toThrow();
  const database = new NotesDatabase(path, { existingOnly: true });
  try { expect(database.getInvitation(hashToken(initial.token))?.email).toBe("tester@example.com"); }
  finally { database.close(); }
});

it("requires an existing initialized database and preserves populated legacy data", async () => {
  const missing = join(directory, "missing.db");
  await expect(issueInvitation(missing, "tester@example.com")).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
  const empty = join(directory, "empty.db");
  new Database(empty).close();
  await expect(issueInvitation(empty, "tester@example.com")).rejects.toThrow("not initialized");
  const legacy = join(directory, "legacy.db");
  const source = new Database(legacy);
  source.exec(await readFile(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8"));
  source.exec("INSERT INTO snippets VALUES (27, 'old name', 'cpp', 'old code', '[]', '2026-01-01')");
  source.close();
  await expect(issueInvitation(legacy, "tester@example.com")).rejects.toThrow("explicit");
  const preserved = new Database(legacy, { readonly: true, fileMustExist: true });
  try {
    expect(preserved.pragma("user_version", { simple: true })).toBe(1);
    expect(preserved.prepare("SELECT code FROM snippets WHERE id = 27").get()).toEqual({ code: "old code" });
  } finally { preserved.close(); }
});

it("propagates output failure after committing so the operator can issue a replacement", async () => {
  const path = initializeDatabase();
  await expect(runAdmin(["invite", "tester@example.com"], environmentFor(path), async () => {
    throw new Error("Output unavailable");
  })).rejects.toThrow("Output unavailable");
  const source = new Database(path, { readonly: true, fileMustExist: true });
  try { expect(source.prepare("SELECT COUNT(*) AS count FROM invitations").get()).toEqual({ count: 1 }); }
  finally { source.close(); }
  const replacement = await issueInvitation(path, "tester@example.com");
  const database = new NotesDatabase(path, { existingOnly: true });
  try { expect(database.getInvitation(hashToken(replacement.token))?.email).toBe("tester@example.com"); }
  finally { database.close(); }
});

it("reports stdout write failures and removes the temporary error listener", async () => {
  const path = initializeDatabase();
  const listenerCount = process.stdout.listenerCount("error");
  const output = vi.spyOn(process.stdout, "write").mockImplementation((...argumentsList) => {
    const error = new Error("Synthetic output failure");
    const callback = argumentsList.find((argument) => typeof argument === "function");
    if (typeof callback === "function") callback(error);
    process.stdout.emit("error", error);
    return false;
  });
  try {
    await expect(runAdmin(["invite", "tester@example.com"], environmentFor(path)))
      .rejects.toThrow("Invitation output failed. Issue a replacement invitation");
  } finally { output.mockRestore(); }
  expect(process.stdout.listenerCount("error")).toBe(listenerCount);
});
