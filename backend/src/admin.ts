import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitKeypressEvents } from "node:readline";
import Database from "better-sqlite3";
import { EmailSchema } from "@cp-notes/shared";
import { hashPassword } from "./auth.js";
import { createBackup } from "./backup.js";
import { NotesDatabase } from "./database.js";
import { defaultDatabasePath } from "./config.js";

function readPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Use an interactive terminal for the hidden password prompt");
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePassword, reject) => {
    let password = "";
    function finish(error?: Error): void {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.stdout.write("\n");
      if (error) reject(error); else resolvePassword(password);
    }
    function onKey(text: string | undefined, key: { name?: string; ctrl?: boolean }): void {
      if (key.ctrl && key.name === "c") { finish(new Error("Account command cancelled")); return; }
      if (key.name === "return" || key.name === "enter") { finish(); return; }
      if (key.name === "backspace") password = Array.from(password).slice(0, -1).join("");
      else if (text && !key.ctrl && !/[\x00-\x1f\x7f]/.test(text)) password += text;
      if (password.length > 128) finish(new Error("Password exceeds 128 characters"));
    }
    process.stdin.on("keypress", onKey);
  });
}

export async function initializeOwner(path: string, email: string, passwordHash: string): Promise<void> {
  EmailSchema.parse(email);
  if (existsSync(path)) {
    const source = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const version = Number(source.pragma("user_version", { simple: true }));
      if (version >= 2) throw new Error("Database is already initialized. Use create, reset, or disable.");
    } finally { source.close(); }
    const backup = await createBackup(path, resolve(dirname(path), "backups"), "pre-migration");
    console.log(`Pre-migration backup completed: ${backup}`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new NotesDatabase(path, { legacyOwner: { email: EmailSchema.parse(email), passwordHash } });
  database.close();
}

async function main(): Promise<void> {
  const [command, rawEmail, ...extra] = process.argv.slice(2);
  if (!command || !["init", "create", "reset", "disable", "benchmark"].includes(command) || extra.length) {
    throw new Error("Usage: admin <init|create|reset|disable> <email>, or admin benchmark. Passwords are prompted, never arguments.");
  }
  if (command === "benchmark") {
    if (rawEmail) throw new Error("benchmark takes no arguments");
    const start = performance.now();
    await hashPassword("benchmark only password");
    console.log(`scrypt N=32768 r=8 p=3: ${Math.round(performance.now() - start)} ms; memory limit 64 MiB/job; maximum two jobs`);
    return;
  }
  const email = EmailSchema.parse(rawEmail);
  const path = resolve(process.env.DATABASE_PATH ?? defaultDatabasePath);
  let passwordHash = "";
  if (command !== "disable") {
    const password = await readPassword("Password (12–128 characters): ");
    if (password !== await readPassword("Confirm password: ")) throw new Error("Passwords did not match");
    passwordHash = await hashPassword(password);
  }
  if (command === "init") await initializeOwner(path, email, passwordHash);
  else {
    const database = new NotesDatabase(path, { existingOnly: true });
    try {
      if (command === "create") database.createUser(email, passwordHash);
      else {
        const user = database.getUserByEmail(email);
        if (!user) throw new Error("Account was not found");
        if (command === "reset") database.setPassword(user.id, passwordHash);
        else database.disableUser(user.id);
      }
    } finally { database.close(); }
  }
  console.log(`Account command ${command} completed`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Account command failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
