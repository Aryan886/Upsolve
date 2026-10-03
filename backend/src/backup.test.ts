import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { NotesDatabase } from "./database.js";
import { createBackup, runBackup } from "./backup.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "cp-backup-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it("restores a live WAL backup with sessions, notes, search and ownership", async () => {
  const source = new NotesDatabase(join(directory, "source.db"));
  try {
    source.createUser("owner@example.com", "hash");
    source.createUser("other@example.com", "hash");
    source.createSession(1, "hash", "token hash", "extension", new Date(Date.now() + 60_000).toISOString());
    source.createPattern(1, { trigger: "saved", coreIdea: "idea", complexity: "O(1)" });
    const path = await createBackup(join(directory, "source.db"), join(directory, "backups"));
    const restored = new NotesDatabase(path, { existingOnly: true });
    try {
      expect(restored.getSession("token hash", "extension")?.email).toBe("owner@example.com");
      expect(restored.listPatterns(1, { page: 1, limit: 20, query: "saved" }).meta.total).toBe(1);
      expect(restored.listPatterns(2, { page: 1, limit: 20 }).meta.total).toBe(0);
    } finally { restored.close(); }
  } finally { source.close(); }
});

it("restores schema-4 invitations independently and revokes links revived by an older backup", async () => {
  const sourcePath = join(directory, "source.db");
  const source = new NotesDatabase(sourcePath);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    const owner = source.createUser("owner@example.com", "owner hash");
    source.createPattern(owner.id, { trigger: "saved before backup", coreIdea: "idea", complexity: "O(1)" });
    source.issueInvitation("accepted@example.com", "accepted invitation hash", expiresAt);
    source.issueInvitation("revoked@example.com", "revoked invitation hash", expiresAt);
    const backupPath = await createBackup(sourcePath, join(directory, "backups"));
    const snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      expect(snapshot.pragma("user_version", { simple: true })).toBe(4);
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(snapshot.pragma("foreign_key_check")).toEqual([]);
    } finally { snapshot.close(); }

    source.acceptInvitation("accepted invitation hash", "new user hash");
    expect(source.revokeInvitation("revoked@example.com")).toBe(true);
    expect(source.getInvitation("accepted invitation hash")).toBeNull();
    expect(source.getInvitation("revoked invitation hash")).toBeNull();

    const restored = new NotesDatabase(backupPath, { existingOnly: true });
    try {
      expect(restored.getUserByEmail("owner@example.com")?.passwordHash).toBe("owner hash");
      expect(restored.listPatterns(owner.id, { page: 1, limit: 20, query: "saved before backup" }).meta.total).toBe(1);
      expect(restored.getUserByEmail("accepted@example.com")).toBeNull();
      expect(restored.getInvitation("accepted invitation hash")).toEqual({ email: "accepted@example.com", expiresAt });
      expect(restored.getInvitation("revoked invitation hash")).toEqual({ email: "revoked@example.com", expiresAt });
      expect(restored.revokeInvitation("accepted@example.com")).toBe(true);
      expect(restored.revokeInvitation("revoked@example.com")).toBe(true);
      expect(restored.getInvitation("accepted invitation hash")).toBeNull();
      expect(restored.getInvitation("revoked invitation hash")).toBeNull();
    } finally { restored.close(); }

    expect(source.getUserByEmail("accepted@example.com")?.passwordHash).toBe("new user hash");
    expect(source.listPatterns(owner.id, { page: 1, limit: 20 }).meta.total).toBe(1);
  } finally { source.close(); }
});

it("does not report upload failure as success or create a missing source", async () => {
  await expect(createBackup(join(directory, "missing.db"), directory)).rejects.toThrow();
  const sourcePath = join(directory, "source.db");
  new NotesDatabase(sourcePath).close();
  const backups = join(directory, "backups");
  await expect(runBackup(sourcePath, backups, async () => { throw new Error("upload failed"); })).rejects.toThrow("upload failed");
  expect(await readdir(backups)).not.toContain("last-success.json");
  await runBackup(sourcePath, backups, async () => undefined);
  expect(JSON.parse(await readFile(join(backups, "last-success.json"), "utf8")).completedAt).toBeTruthy();
});


it("prevents overlapping backups and keeps the latest three uploaded copies", async () => {
  const path = join(directory, "source.db");
  new NotesDatabase(path).close();
  const backups = join(directory, "backups");
  let finish: () => void = () => undefined;
  let started: () => void = () => undefined;
  const uploading = new Promise<void>((resolve) => { started = resolve; });
  const upload = new Promise<void>((resolve) => { finish = resolve; });
  const first = runBackup(path, backups, async () => { started(); await upload; });
  await uploading;
  await expect(runBackup(path, backups, async () => undefined)).rejects.toThrow();
  finish(); await first;
  for (let index = 0; index < 3; index++) await runBackup(path, backups, async () => undefined);
  expect((await readdir(backups)).filter((file) => file.endsWith(".db"))).toHaveLength(3);
});
