import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashToken } from "./auth.js";
import { NotesDatabase } from "./database.js";

const origin = "http://localhost:5173";
const password = "a strong beta password";
let directory: string;
let path: string;
let token: string;
let database: NotesDatabase;
let context: ReturnType<typeof createApp>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cp-beta-test-"));
  path = join(directory, "notes.db");
  token = randomBytes(32).toString("base64url");
  database = new NotesDatabase(path);
  database.issueBetaSignup(hashToken(token), new Date(Date.now() + 60_000).toISOString());
  context = createApp({ databasePath: path, localDevelopment: true });
});

afterEach(() => {
  context.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

it("retires inspect and accept with fixed guidance, no lookup, hashes, sessions or writes", async () => {
  const source = new Database(path, { readonly: true });
  try {
    const history = source.prepare("SELECT * FROM beta_signup").get();
    for (const body of [{}, { token }, { token: "expired", email: "new@example.com", password }, { token: "", userId: 1 }]) {
      for (const action of ["inspect", "accept"]) {
        const result = await request(context.app).post(`/api/auth/beta/${action}`).set("Origin", origin).send(body).expect(410);
        expect(result.body.error.code).toBe("beta_signup_retired");
        expect(result.body.error.message).toContain(`${origin}/signup`);
        expect(result.headers["cache-control"]).toBe("no-store");
        expect(result.headers["set-cookie"]).toBeUndefined();
      }
    }
    expect(source.prepare("SELECT * FROM beta_signup").get()).toEqual(history);
    expect(source.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    expect(source.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
  } finally { source.close(); }
});

it("retains website-only origin checks for retired endpoints", async () => {
  for (const action of ["inspect", "accept"]) {
    await request(context.app).post(`/api/auth/beta/${action}`).send({ token }).expect(403);
    await request(context.app).post(`/api/auth/beta/${action}`).set("Origin", "https://hostile.test").send({ token }).expect(403);
  }
});

it("retains historical beta accounting across rotation, revocation and restart", () => {
  database.acceptBetaSignup(hashToken(token), "historical@example.com", "stored hash");
  database.issueBetaSignup(hashToken("replacement"), new Date(Date.now() + 60_000).toISOString());
  expect(database.getBetaSignup(hashToken(token))).toBeNull();
  expect(database.revokeBetaSignup()).toBe(true);
  expect(database.getBetaStatus()).toMatchObject({ state: "revoked", signupCount: 1 });
  context.close();
  context = createApp({ databasePath: path, localDevelopment: true });
  expect(context.database.getBetaStatus()).toMatchObject({ state: "revoked", signupCount: 1 });
});

it("rolls back the account when the counter update fails", () => {
  const source = new Database(path);
  try {
    source.exec("CREATE TRIGGER block_beta_count BEFORE UPDATE OF signup_count ON beta_signup BEGIN SELECT RAISE(ABORT, 'counter failed'); END;");
    expect(() => database.acceptBetaSignup(hashToken(token), "tester@example.com", "stored hash")).toThrow("counter failed");
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getBetaStatus().signupCount).toBe(0);
  } finally { source.close(); }
});
