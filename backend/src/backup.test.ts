import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
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
