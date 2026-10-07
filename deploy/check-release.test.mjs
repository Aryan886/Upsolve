import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { NotesDatabase } from "../backend/dist/database.js";
import { createBackup } from "../backend/dist/backup.js";

const release = resolve(".");
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const Sqlite = require("better-sqlite3");
const command = new URL("./check-release.mjs", import.meta.url);

function run(...args) {
  return spawnSync(process.execPath, [fileURLToPath(command), ...args], { encoding: "utf8", timeout: 30_000 });
}

function createRollbackRelease(directory, changesRows = false) {
  const fixture = join(directory, "release");
  const backend = join(fixture, "backend");
  mkdirSync(join(backend, "dist"), { recursive: true });
  writeFileSync(join(backend, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(join(release, "node_modules"), join(fixture, "node_modules"), "junction");
  writeFileSync(join(backend, "dist/backup.js"), `export { createBackup } from ${JSON.stringify(pathToFileURL(join(release, "backend/dist/backup.js")).href)};\n`);
  // This previous binary requires a row that has not yet been checkpointed from WAL.
  writeFileSync(join(backend, "dist/database.js"), `
    import { createRequire } from "node:module";
    const Sqlite = createRequire(import.meta.url)("better-sqlite3");
    export class NotesDatabase {
      constructor(path) {
        this.database = new Sqlite(path, { fileMustExist: true });
        if (${changesRows}) this.database.exec("UPDATE rollback_probe SET value = 'changed'");
      }
      health() {
        if (!this.database.prepare("SELECT value FROM rollback_probe").get()) throw new Error("Rollback data is missing");
      }
      close() { this.database.close(); }
    }
  `);
  return fixture;
}

for (const changesRows of [false, true]) {
  test(changesRows ? "code rollback refuses a previous binary that changes existing rows" : "code rollback includes uncheckpointed WAL data in its private copy", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cp-notes-rollback-wal-test-"));
    let database;
    try {
      const live = join(directory, "live.db");
      const initial = new NotesDatabase(live);
      initial.close();
      database = new Sqlite(live);
      database.pragma("journal_mode = WAL");
      database.pragma("wal_autocheckpoint = 0");
      database.exec("CREATE TABLE rollback_probe (value TEXT NOT NULL)");
      database.prepare("INSERT INTO rollback_probe (value) VALUES (?)").run("saved in WAL");
      const backup = await createBackup(live, directory, "before");
      const fixture = createRollbackRelease(directory, changesRows);
      const result = run("rollback", fixture, backup, live);
      if (changesRows) {
        assert.equal(result.status, 1);
        assert.match(result.stderr, /would change the rollback database/i);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout.trim()), { schema: 4, compatible: true });
      }
      assert.equal(database.prepare("SELECT value FROM rollback_probe").get().value, "saved in WAL");
    } finally {
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("a compatible release preserves all existing tables and rows on a private copy", () => {
  const directory = mkdtempSync(join(tmpdir(), "cp-notes-preflight-test-"));
  try {
    const path = join(directory, "notes.db");
    const database = new NotesDatabase(path);
    database.close();
    const result = run("preflight", release, release, path, "false");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { beforeSchema: 4, afterSchema: 4, migration: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("code rollback refuses a database whose schema changed", () => {
  const directory = mkdtempSync(join(tmpdir(), "cp-notes-rollback-test-"));
  try {
    const backup = join(directory, "before.db");
    const live = join(directory, "after.db");
    for (const path of [backup, live]) {
      const database = new NotesDatabase(path);
      database.close();
    }
    const changed = new Sqlite(live);
    changed.pragma("user_version = 5");
    changed.close();
    const result = run("rollback", release, backup, live);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /schema changed/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("code rollback refuses changed SQL definitions even without a version change", () => {
  const directory = mkdtempSync(join(tmpdir(), "cp-notes-rollback-ddl-test-"));
  try {
    const backup = join(directory, "before.db");
    const live = join(directory, "after.db");
    for (const path of [backup, live]) {
      const database = new NotesDatabase(path);
      database.close();
    }
    const changed = new Sqlite(live);
    changed.exec("CREATE TABLE unexpected_change (id INTEGER PRIMARY KEY)");
    changed.close();
    const result = run("rollback", release, backup, live);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /schema definitions changed/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
