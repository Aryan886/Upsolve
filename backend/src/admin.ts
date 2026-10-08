import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitKeypressEvents } from "node:readline";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { EmailSchema } from "@cp-notes/shared";
import { hashPassword, hashToken } from "./auth.js";
import { createBackup } from "./backup.js";
import { NotesDatabase } from "./database.js";
import { defaultDatabasePath, readInvitationConfig } from "./config.js";

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
      if (version >= 2) throw new Error("Database is already initialized. Use invite, create, reset, or disable.");
    } finally { source.close(); }
    const backup = await createBackup(path, resolve(dirname(path), "backups"), "pre-migration");
    console.log(`Pre-migration backup completed: ${backup}`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new NotesDatabase(path, { legacyOwner: { email: EmailSchema.parse(email), passwordHash } });
  database.close();
}

function writeInvitation(message: string): Promise<void> {
  return new Promise((resolveOutput, reject) => {
    function fail(error: Error): void {
      reject(new Error("Invitation output failed. Issue a replacement invitation before sharing it.", { cause: error }));
    }
    function onError(error: Error): void {
      process.stdout.removeListener("error", onError);
      fail(error);
    }
    process.stdout.once("error", onError);
    try {
      process.stdout.write(`${message}\n`, (error) => {
        // A failed write also emits an error event; retain its listener until then.
        if (error) { fail(error); return; }
        process.stdout.removeListener("error", onError);
        resolveOutput();
      });
    } catch (error) {
      process.stdout.removeListener("error", onError);
      fail(error instanceof Error ? error : new Error("Unknown output error"));
    }
  });
}

export async function runAdmin(
  argumentsList: string[],
  environment: NodeJS.ProcessEnv = process.env,
  outputInvitation: (message: string) => Promise<void> = writeInvitation,
): Promise<void> {
  const [command, rawEmail, ...extra] = argumentsList;
  const accountCommands = ["init", "create", "reset", "disable", "invite", "revoke-invite"];
  const noArgumentCommands = ["benchmark", "beta-link", "beta-status", "revoke-beta-link"];
  const needsEmail = command !== undefined && accountCommands.includes(command);
  const takesNoArguments = command !== undefined && noArgumentCommands.includes(command);
  if (!command || (!needsEmail && !takesNoArguments) || (needsEmail && (!rawEmail || extra.length > 0)) || (takesNoArguments && rawEmail !== undefined)) {
    throw new Error("Usage: admin <init|create|reset|disable|invite|revoke-invite> <email>, or admin <benchmark|beta-link|beta-status|revoke-beta-link>. Passwords and tokens are never arguments.");
  }
  if (command === "benchmark") {
    if (rawEmail) throw new Error("benchmark takes no arguments");
    const start = performance.now();
    await hashPassword("benchmark only password");
    console.log(`scrypt N=32768 r=8 p=3: ${Math.round(performance.now() - start)} ms; memory limit 64 MiB/job; maximum two jobs`);
    return;
  }
  if (command === "beta-link") {
    throw new Error("Shared beta link issuance has retired. Share the website /signup URL instead. beta-status retains history; revoke-beta-link is available for cleanup.");
  }
  const path = resolve(environment.DATABASE_PATH ?? defaultDatabasePath);
  if (command === "beta-status" || command === "revoke-beta-link") {
    const database = new NotesDatabase(path, { existingOnly: true });
    try {
      if (command === "revoke-beta-link") console.log(database.revokeBetaSignup() ? "Shared beta signup link revoked" : "No active shared beta signup link");
      else {
        const status = database.getBetaStatus();
        console.log(`Historical shared beta signup (retired): ${status.state}; ${status.signupCount} / ${status.maxSignups} signups; expires: ${status.expiresAt ?? "not issued"}`);
      }
    } finally { database.close(); }
    return;
  }
  const email = EmailSchema.parse(rawEmail);
  if (command === "invite") {
    const config = readInvitationConfig(environment);
    const token = randomBytes(32).toString("base64url");
    const database = new NotesDatabase(path, { existingOnly: true });
    let invitation: { email: string; expiresAt: string };
    try {
      if (database.getUserByEmail(email)) {
        throw new Error("An account with this email already exists, including disabled accounts. Use reset for an existing account.");
      }
      const expiresAt = new Date(Date.now() + config.invitationHours * 3_600_000).toISOString();
      invitation = database.issueInvitation(email, hashToken(token), expiresAt);
    } finally { database.close(); }
    const link = `${config.appOrigin}/#invite=${token}`;
    await outputInvitation(`Invitation for ${invitation.email}\nExpires: ${invitation.expiresAt}\nPrivate setup link: ${link}\nShare privately with the intended tester. Reissuing replaces this link.`);
    return;
  }
  if (command === "revoke-invite") {
    const database = new NotesDatabase(path, { existingOnly: true });
    try {
      const removed = database.revokeInvitation(email);
      console.log(removed ? `Invitation revoked for ${email}` : `No outstanding invitation for ${email}`);
    } finally { database.close(); }
    return;
  }
  let passwordHash = "";
  if (["init", "create", "reset"].includes(command)) {
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
  runAdmin(process.argv.slice(2)).catch((error: unknown) => {
    console.error("Account command failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
