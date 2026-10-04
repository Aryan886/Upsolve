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

function inspect(signupToken = token) {
  return request(context.app).post("/api/auth/beta/inspect").set("Origin", origin).send({ token: signupToken });
}

function accept(email: string, signupToken = token) {
  return request(context.app).post("/api/auth/beta/accept").set("Origin", origin).send({ token: signupToken, email, password });
}

it("inspects without using a spot, accepts a normalized email, and requires normal login", async () => {
  const first = await inspect().expect(200);
  expect(first.body).toEqual({ data: { expiresAt: expect.any(String), remainingSignups: 30 } });
  expect(first.headers["cache-control"]).toBe("no-store");
  expect(first.headers["set-cookie"]).toBeUndefined();
  await inspect().expect(200);
  expect(database.getBetaStatus().signupCount).toBe(0);
  const accepted = await accept("  TESTER@Example.com  ").expect(201);
  expect(accepted.body).toEqual({ data: { email: "tester@example.com" } });
  expect(accepted.headers["set-cookie"]).toBeUndefined();
  expect(database.getBetaStatus().signupCount).toBe(1);
  await request(context.app).get("/api/auth/me").expect(401);
  await request(context.app).post("/api/auth/login").set("Origin", origin)
    .send({ email: "tester@example.com", password }).expect(200);
  await request(context.app).post("/api/auth/extension-login")
    .send({ email: "tester@example.com", password }).expect(200);
});

it("rejects wrong origin, malformed and extra input, existing accounts, and unavailable tokens without using spots", async () => {
  await request(context.app).post("/api/auth/beta/inspect").send({ token }).expect(403);
  await request(context.app).post("/api/auth/beta/accept").set("Origin", "https://elsewhere.test")
    .send({ token, email: "test@example.com", password }).expect(403);
  for (const body of [
    { token, email: "invalid", password },
    { token, email: "test@example.com", password: "short" },
    { token, email: "test@example.com", password, userId: 1 },
    { token, email: "test@example.com", password, maxSignups: 100 },
  ]) {
    const response = await request(context.app).post("/api/auth/beta/accept").set("Origin", origin).send(body).expect(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(JSON.stringify(response.body)).not.toContain(password);
  }
  const unknown = await inspect(randomBytes(32).toString("base64url")).expect(400);
  expect(unknown.body.error.code).toBe("beta_unavailable");
  database.createUser("existing@example.com", "stored hash");
  database.createUser("disabled@example.com", "stored hash");
  database.disableUser(2);
  for (const email of ["existing@example.com", "disabled@example.com"]) {
    const response = await accept(email).expect(400);
    expect(response.body.error.code).toBe("beta_account_unavailable");
  }
  expect(database.getBetaStatus().signupCount).toBe(0);
});

it("allows 30 signups from the same IP and closes before the 31st", async () => {
  for (let number = 1; number <= 30; number++) {
    await inspect().expect(200);
    await accept(`tester${number}@example.com`).expect(201);
  }
  const full = await inspect().expect(400);
  expect(full.body.error.code).toBe("beta_full");
  expect((await accept("tester31@example.com").expect(400)).body.error.code).toBe("beta_full");
  expect(database.getBetaStatus()).toMatchObject({ state: "full", signupCount: 30, remainingSignups: 0 });
  expect(() => database.issueBetaSignup(hashToken("replacement"), new Date(Date.now() + 60_000).toISOString()))
    .toThrowError(expect.objectContaining({ code: "beta_full" }));
}, 90_000);

it("preserves capacity and blocks old tokens when rotated, revoked, or expired", async () => {
  await accept("first@example.com").expect(201);
  const original = token;
  token = randomBytes(32).toString("base64url");
  database.issueBetaSignup(hashToken(token), new Date(Date.now() + 60_000).toISOString());
  expect(database.getBetaStatus()).toMatchObject({ signupCount: 1, remainingSignups: 29 });
  expect((await inspect(original).expect(400)).body.error.code).toBe("beta_unavailable");
  expect(database.revokeBetaSignup()).toBe(true);
  expect(database.revokeBetaSignup()).toBe(false);
  expect((await inspect().expect(400)).body.error.code).toBe("beta_unavailable");
  database.issueBetaSignup(hashToken(token), new Date(Date.now() - 1).toISOString());
  expect(database.getBetaStatus().state).toBe("expired");
  expect((await inspect().expect(400)).body.error.code).toBe("beta_unavailable");
  const stored = new Database(path, { readonly: true });
  try { expect(JSON.stringify(stored.prepare("SELECT * FROM beta_signup").all())).not.toContain(token); }
  finally { stored.close(); }
  context.close();
  context = createApp({ databasePath: path, localDevelopment: true });
  expect(database.getBetaStatus().signupCount).toBe(1);
});

it("admits only one of two distinct requests for the final spot across separate connections", async () => {
  for (let number = 1; number <= 29; number++) database.acceptBetaSignup(hashToken(token), `earlier${number}@example.com`, "stored hash");
  const second = createApp({ databasePath: path, localDevelopment: true });
  try {
    const responses = await Promise.all([
      accept("last-a@example.com").then((response) => response),
      request(second.app).post("/api/auth/beta/accept").set("Origin", origin)
        .send({ token, email: "last-b@example.com", password }).then((response) => response),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    expect(responses.find((response) => response.status === 400)?.body.error.code).toBe("beta_full");
    expect(database.getBetaStatus().signupCount).toBe(30);
    expect(Number(database.getUserByEmail("last-a@example.com") !== null) + Number(database.getUserByEmail("last-b@example.com") !== null)).toBe(1);
  } finally { second.close(); }
}, 30_000);

it("creates one account for concurrent requests with the same email", async () => {
  const responses = await Promise.all([
    accept("same@example.com").then((response) => response),
    accept("same@example.com").then((response) => response),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
  expect(responses.find((response) => response.status === 400)?.body.error.code).toBe("beta_account_unavailable");
  expect(database.getBetaStatus().signupCount).toBe(1);
}, 30_000);

it("rolls back the account when the counter update fails", () => {
  const source = new Database(path);
  try {
    source.exec("CREATE TRIGGER block_beta_count BEFORE UPDATE OF signup_count ON beta_signup BEGIN SELECT RAISE(ABORT, 'counter failed'); END;");
    expect(() => database.acceptBetaSignup(hashToken(token), "tester@example.com", "stored hash")).toThrow("counter failed");
    expect(database.getUserByEmail("tester@example.com")).toBeNull();
    expect(database.getBetaStatus().signupCount).toBe(0);
  } finally { source.close(); }
});
