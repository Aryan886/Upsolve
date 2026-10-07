import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const runFile = promisify(execFile);

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest("hex");
}

function openDatabase(release, path) {
  const require = createRequire(`${release}/backend/package.json`);
  const Sqlite = require("better-sqlite3");
  return new Sqlite(path, { readonly: true, fileMustExist: true });
}

function inspectDatabase(release, path) {
  const database = openDatabase(release, path);
  try {
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok", "SQLite integrity check failed");
    assert.deepEqual(database.pragma("foreign_key_check"), [], "SQLite foreign keys failed");
    const definitions = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const definitionHash = createHash("sha256").update(JSON.stringify(definitions)).digest("hex");
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
    const tables = {};
    for (const name of names) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const digest = createHash("sha256");
      let count = 0;
      for (const row of database.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).iterate()) {
        digest.update(JSON.stringify(row));
        digest.update("\n");
        count++;
      }
      tables[name] = { count, hash: digest.digest("hex") };
    }
    return { schema: database.pragma("user_version", { simple: true }), definitionHash, tables };
  } finally {
    database.close();
  }
}

async function testCandidate(previousRelease, candidateRelease, databasePath, allowMigration) {
  const directory = await mkdtemp(join(tmpdir(), "cp-notes-deploy-check-"));
  const { createBackup } = await import(pathToFileURL(join(previousRelease, "backend/dist/backup.js")).href);
  try {
    const backup = await createBackup(databasePath, directory, "preflight");
    const before = inspectDatabase(previousRelease, backup);
    const copy = join(directory, "candidate.db");
    await copyFile(backup, copy);
    const { NotesDatabase } = await import(pathToFileURL(join(candidateRelease, "backend/dist/database.js")).href);
    const candidate = new NotesDatabase(copy, { existingOnly: true });
    try {
      candidate.health();
    } finally {
      candidate.close();
    }
    const after = inspectDatabase(candidateRelease, copy);
    assert.ok(after.schema >= before.schema, "Candidate downgraded the database schema");
    if (!allowMigration) {
      assert.deepEqual(after, before, "Unattended release would change database schema or rows");
      const { NotesDatabase: PreviousDatabase } = await import(pathToFileURL(join(previousRelease, "backend/dist/database.js")).href);
      const previous = new PreviousDatabase(copy, { existingOnly: true });
      try {
        previous.health();
      } finally {
        previous.close();
      }
    } else {
      for (const [name, table] of Object.entries(before.tables)) {
        assert.ok(after.tables[name], `Migration removed table ${name}`);
        assert.ok(after.tables[name].count >= table.count, `Migration lost rows from ${name}`);
      }
    }
    console.log(JSON.stringify({ beforeSchema: before.schema, afterSchema: after.schema, migration: after.schema !== before.schema }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createReleaseBackup(previousRelease, databasePath, backupDirectory, destination) {
  if (!/^s3:\/\/[a-z0-9][a-z0-9.-]+\/[A-Za-z0-9/_-]+$/.test(destination)) throw new Error("PRE_RELEASE_S3_URI must be a private S3 bucket/prefix URI");
  const { createBackup, uploadBackup } = await import(pathToFileURL(join(previousRelease, "backend/dist/backup.js")).href);
  const backup = await createBackup(databasePath, backupDirectory, "pre-release");
  const localHash = await hashFile(backup);
  await uploadBackup(backup, destination);
  const remote = `${destination.replace(/\/$/, "")}/${basename(backup)}`;
  const directory = await mkdtemp(join(backupDirectory, "verify-upload-"));
  try {
    const download = join(directory, basename(backup));
    await runFile("aws", ["s3", "cp", remote, download, "--only-show-errors"], { timeout: 120_000 });
    const remoteHash = await hashFile(download);
    assert.equal(remoteHash, localHash, "Uploaded backup checksum differs from local backup");
    inspectDatabase(previousRelease, download);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ backup, sha256: localHash, remote }));
}

async function checkRollback(previousRelease, backupPath, databasePath) {
  const before = inspectDatabase(previousRelease, backupPath);
  const current = inspectDatabase(previousRelease, databasePath);
  assert.equal(current.schema, before.schema, "Database schema changed; code rollback is unsafe");
  assert.equal(current.definitionHash, before.definitionHash, "Database schema definitions changed; code rollback is unsafe");
  const directory = await mkdtemp(join(tmpdir(), "cp-notes-rollback-"));
  try {
    const { createBackup } = await import(pathToFileURL(join(previousRelease, "backend/dist/backup.js")).href);
    const copy = await createBackup(databasePath, directory, "rollback-check");
    const snapshot = inspectDatabase(previousRelease, copy);
    const { NotesDatabase } = await import(pathToFileURL(join(previousRelease, "backend/dist/database.js")).href);
    const previous = new NotesDatabase(copy, { existingOnly: true });
    try {
      previous.health();
    } finally {
      previous.close();
    }
    assert.deepEqual(inspectDatabase(previousRelease, copy), snapshot, "Previous release would change the rollback database");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ schema: current.schema, compatible: true }));
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "inspect" && args.length === 2) console.log(JSON.stringify(inspectDatabase(args[0], args[1])));
  else if (command === "preflight" && args.length === 4) await testCandidate(args[0], args[1], args[2], args[3] === "true");
  else if (command === "backup" && args.length === 4) await createReleaseBackup(...args);
  else if (command === "rollback" && args.length === 3) await checkRollback(...args);
  else throw new Error("Expected inspect, preflight, backup or rollback command with required arguments");
} catch (error) {
  console.error("Release check failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}
