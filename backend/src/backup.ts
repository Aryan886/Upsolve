import Database from "better-sqlite3";
import { chmod, mkdir, open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export async function createBackup(databasePath: string, directory: string, prefix = "daily"): Promise<string> {
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  const name = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.db`;
  const destination = join(resolve(directory), name);
  const temporary = `${destination}.partial`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await source.backup(temporary);
    const copy = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (copy.pragma("integrity_check", { simple: true }) !== "ok" || (copy.pragma("foreign_key_check") as unknown[]).length) {
        throw new Error("Backup integrity or foreign key verification failed");
      }
    } finally { copy.close(); }
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    throw new Error(`Could not create SQLite backup in ${directory}`, { cause: error });
  } finally { source.close(); }
}

export async function uploadBackup(path: string, destination: string): Promise<void> {
  if (!/^s3:\/\/[a-z0-9][a-z0-9.-]+\/[A-Za-z0-9/_-]*$/.test(destination)) throw new Error("BACKUP_S3_URI must be an S3 bucket/prefix URI");
  try {
    await runFile("aws", ["s3", "cp", path, `${destination.replace(/\/$/, "")}/${basename(path)}`, "--sse", "AES256", "--only-show-errors"], { timeout: 120_000 });
  } catch {
    // CLI output can include credential configuration; keep logs specific but secret-free.
    throw new Error(`S3 upload failed for ${basename(path)}. Check backup credentials, region, network and bucket policy.`);
  }
}

export async function runBackup(databasePath: string, directory: string, upload: (path: string) => Promise<void>): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "backup.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    const path = await createBackup(databasePath, directory);
    await upload(path);
    // Only uploaded files count toward local retention; failed uploads never advance this marker.
    await writeFile(`${path}.uploaded`, "uploaded\n", { mode: 0o600 });
    const marker = join(directory, "last-success.json");
    await writeFile(`${marker}.partial`, JSON.stringify({ completedAt: new Date().toISOString(), file: basename(path) }) + "\n", { mode: 0o600 });
    await rename(`${marker}.partial`, marker);
    const successful = (await readdir(directory)).filter((file) => /^daily-.*\.db\.uploaded$/.test(file)).sort().reverse();
    for (const file of successful.slice(3)) {
      await unlink(join(directory, file.replace(/\.uploaded$/, "")));
      await unlink(join(directory, file));
    }
    return path;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { DATABASE_PATH, BACKUP_DIRECTORY, BACKUP_S3_URI } = process.env;
    if (!DATABASE_PATH || !BACKUP_DIRECTORY || !BACKUP_S3_URI) throw new Error("DATABASE_PATH, BACKUP_DIRECTORY and BACKUP_S3_URI are required");
    const path = await runBackup(DATABASE_PATH, BACKUP_DIRECTORY, (file) => uploadBackup(file, BACKUP_S3_URI));
    console.log(`Backup uploaded successfully: ${basename(path)}`);
  } catch (error) {
    console.error("Backup failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
