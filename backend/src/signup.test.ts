import { randomBytes, scrypt } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createThrottle, hashPassword, hashToken, verifyPassword } from "./auth.js";
import { NotesDatabase } from "./database.js";

vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal<typeof import("node:crypto")>();
  return { ...crypto, scrypt: vi.fn(crypto.scrypt) };
});

const origin = "http://localhost:5173";
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const password = "  a strong signup password  ";
let directory: string;
let path: string;
let context: ReturnType<typeof createApp>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cp-signup-test-"));
  path = join(directory, "notes.db");
  context = createApp({ databasePath: path, localDevelopment: true, extensionOrigins: [extensionOrigin] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  context.close();
  rmSync(directory, { recursive: true, force: true });
});

function signup(email = "tester@example.com", chosenPassword = password) {
  return request(context.app).post("/api/auth/signup").set("Origin", origin).send({ email, password: chosenPassword });
}

it("creates an ordinary user without beta data or sessions and preserves the exact password", async () => {
  const accepted = await signup("  TESTER@Example.com  ").expect(201);
  expect(accepted.body).toEqual({ data: { email: "tester@example.com" } });
  expect(accepted.headers["set-cookie"]).toBeUndefined();
  expect(accepted.headers["cache-control"]).toBe("no-store");
  expect(accepted.headers["referrer-policy"]).toBe("no-referrer");
  const user = context.database.getUserByEmail("tester@example.com")!;
  expect(user.active).toBe(true);
  expect(await verifyPassword(password, user.passwordHash)).toBe(true);
  expect(await verifyPassword(password.trim(), user.passwordHash)).toBe(false);
  await request(context.app).get("/api/auth/me").expect(401);
  await request(context.app).get("/api/feed").expect(401);
  await request(context.app).post("/api/auth/login").set("Origin", origin).send({ email: user.email, password }).expect(200);
  await request(context.app).post("/api/auth/extension-login").send({ email: user.email, password }).expect(200);
  const source = new Database(path, { readonly: true });
  try {
    expect(source.pragma("user_version", { simple: true })).toBe(4);
    expect(source.prepare("SELECT COUNT(*) AS count FROM beta_signup").get()).toEqual({ count: 0 });
  } finally { source.close(); }
});

it("creates more than 30 ordinary accounts independent of full, expired or revoked beta history", async () => {
  const source = new Database(path);
  try {
    context.database.issueBetaSignup(hashToken("historical"), new Date(Date.now() - 1).toISOString());
    source.exec("UPDATE beta_signup SET signup_count = 30");
    const before = source.prepare("SELECT * FROM beta_signup").get();
    const passwordHash = await hashPassword(password);
    for (let number = 0; number < 35; number++) context.database.createSignupUser(`public${number}@example.com`, passwordHash);
    await signup("full@example.com").expect(201);
    expect(source.prepare("SELECT * FROM beta_signup").get()).toEqual(before);
    context.database.revokeBetaSignup();
    const revoked = source.prepare("SELECT * FROM beta_signup").get();
    await signup("revoked@example.com").expect(201);
    expect(source.prepare("SELECT * FROM beta_signup").get()).toEqual(revoked);
    source.exec("UPDATE beta_signup SET signup_count = 0, token_hash = 'expired'");
    const expired = source.prepare("SELECT * FROM beta_signup").get();
    await signup("expired@example.com").expect(201);
    expect(source.prepare("SELECT * FROM beta_signup").get()).toEqual(expired);
  } finally { source.close(); }
});

it("checks exact website origin before hashing or writing regardless of credentials", async () => {
  const hashing = vi.mocked(scrypt);
  hashing.mockClear();
  for (const forbidden of [undefined, "null", "https://hostile.test", extensionOrigin, `${origin}/`, `${origin}.hostile.test`]) {
    for (const header of ["Cookie", "Authorization"]) {
      const attempt = request(context.app).post("/api/auth/signup").set(header, header === "Cookie" ? `cp_notes_dev=${"a".repeat(43)}` : `Bearer ${"b".repeat(43)}`);
      if (forbidden !== undefined) attempt.set("Origin", forbidden);
      const result = await attempt.send({ email: "tester@example.com", password }).expect(403);
      expect(result.body.error.code).toBe("origin_not_allowed");
    }
  }
  expect(hashing).not.toHaveBeenCalled();
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
});

it("rejects invalid and identity/token fields safely before hashing", async () => {
  const hashing = vi.mocked(scrypt);
  hashing.mockClear();
  for (const body of [{}, { email: null, password }, { email: 1, password }, { email: "invalid", password },
    { email: "tester@example.com", password: null }, { email: "tester@example.com", password: "a".repeat(11) },
    { email: "tester@example.com", password: "a".repeat(129) },
    { email: "tester@example.com", password, token: "secret" }, { email: "tester@example.com", password, userId: 1 }]) {
    const result = await request(context.app).post("/api/auth/signup").set("Origin", origin).send(body).expect(400);
    expect(result.body.error.code).toBe("validation_error");
    expect(JSON.stringify(result.body)).not.toContain(password);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  }
  expect(hashing).not.toHaveBeenCalled();
  for (const length of [12, 128]) await signup(`length${length}@example.com`, "a".repeat(length)).expect(201);
});

it("preserves existing users, disabled status, sessions, notes and outstanding invitations on conflict", async () => {
  const passwordHash = await hashPassword(password);
  const active = context.database.createUser("active@example.com", passwordHash);
  const disabled = context.database.createUser("disabled@example.com", passwordHash);
  context.database.disableUser(disabled.id);
  context.database.createSession(active.id, passwordHash, hashToken("a".repeat(43)), "extension", new Date(Date.now() + 60_000).toISOString());
  context.database.createSnippet(active.id, { name: "private", language: "cpp", code: "private code" });
  const invitationHash = hashToken("invitation");
  context.database.issueInvitation("invited@example.com", invitationHash, new Date(Date.now() + 60_000).toISOString());
  const source = new Database(path, { readonly: true });
  try {
    const snapshot = source.prepare("SELECT * FROM users").all();
    for (const email of ["  ACTIVE@Example.com  ", "disabled@example.com"]) {
      const result = await signup(email).expect(409);
      expect(result.body.error).toEqual({ code: "signup_unavailable", message: "Account setup is unavailable for this email. Try signing in or contact support." });
    }
    expect(source.prepare("SELECT * FROM users").all()).toEqual(snapshot);
    expect(context.database.getSession(hashToken("a".repeat(43)), "extension")?.id).toBe(active.id);
    expect(context.database.listSnippets(active.id, { page: 1, limit: 20 }).meta.total).toBe(1);
    await signup("invited@example.com").expect(201);
    expect(context.database.getInvitation(invitationHash)).toBeNull();
    expect(() => context.database.acceptInvitation(invitationHash, "replacement hash")).toThrowError(expect.objectContaining({ code: "invitation_invalid" }));
    expect(source.prepare("SELECT COUNT(*) AS count FROM invitations").get()).toEqual({ count: 1 });
  } finally { source.close(); }
});

it("has exactly one winner for case/whitespace variants across two connections", async () => {
  const second = createApp({ databasePath: path, localDevelopment: true });
  try {
    const results = await Promise.all([
      signup(" Same@Example.com ").then((result) => result),
      request(second.app).post("/api/auth/signup").set("Origin", origin).send({ email: "same@example.com", password }).then((result) => result),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe("signup_unavailable");
  } finally { second.close(); }
});

it.each(["admin", "invitation"])("does not overwrite %s account creation during hashing", async (workflow) => {
  const second = new NotesDatabase(path, { existingOnly: true });
  const invitationHash = hashToken("outstanding");
  if (workflow === "invitation") second.issueInvitation("race@example.com", invitationHash, new Date(Date.now() + 60_000).toISOString());
  const crypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  vi.mocked(scrypt).mockImplementationOnce((input, salt, length, options, callback) => {
    if (workflow === "admin") {
      const user = second.createUser("race@example.com", "admin hash");
      second.disableUser(user.id);
    } else second.acceptInvitation(invitationHash, "invitation hash");
    crypto.scrypt(input, salt, length, options, callback);
  });
  try {
    expect((await signup("race@example.com").expect(409)).body.error.code).toBe("signup_unavailable");
    expect(second.getUserByEmail("race@example.com")).toMatchObject({ passwordHash: `${workflow} hash`, active: workflow !== "admin" });
  } finally { second.close(); }
});

it("rolls back writes and keeps unrelated constraints and lock failures visible", async () => {
  const source = new Database(path);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    source.exec("CREATE TRIGGER block_user AFTER INSERT ON users BEGIN SELECT RAISE(ABORT, 'private failure detail'); END;");
    expect(() => context.database.createSignupUser("blocked@example.com", "hash")).toThrow("private failure detail");
    const failure = await signup("blocked@example.com").expect(500);
    expect(failure.body).toEqual({ error: { code: "internal_error", message: "An unexpected error occurred" } });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private failure detail");
    expect(context.database.getUserByEmail("blocked@example.com")).toBeNull();
    source.exec("DROP TRIGGER block_user");
    const transaction = vi.spyOn(Database.prototype, "transaction");
    transaction.mockImplementationOnce(() => { throw new Database.SqliteError("database is locked", "SQLITE_BUSY"); });
    expect(() => context.database.createSignupUser("locked@example.com", "hash")).toThrowError(expect.objectContaining({ code: "SQLITE_BUSY" }));
    transaction.mockRestore();
    expect(context.database.getUserByEmail("locked@example.com")).toBeNull();
  } finally { source.close(); }
});

it("limits malformed requests per IP and supports a fresh window on a shared network", async () => {
  for (let count = 0; count < 20; count++) {
    await request(context.app).post("/api/auth/signup").set("Origin", origin).set("X-Forwarded-For", "192.0.2.1").send({}).expect(400);
  }
  expect((await signup().set("X-Forwarded-For", "192.0.2.1").expect(429)).body.error.code).toBe("too_many_attempts");
  await signup("another-network@example.com").set("X-Forwarded-For", "192.0.2.2").expect(201);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15 * 60_000 + 1);
  await signup().set("X-Forwarded-For", "192.0.2.1").expect(201);
});

it("limits normalized email attempts separately from login", async () => {
  context.database.createUser("existing@example.com", await hashPassword(password));
  for (let count = 0; count < 5; count++) await signup(" EXISTING@Example.com ").expect(409);
  await signup("existing@example.com").expect(429);
  await request(context.app).post("/api/auth/login").set("Origin", origin).send({ email: "existing@example.com", password }).expect(200);
});

it("bounds throttle memory and expires keys", () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const throttle = createThrottle();
  for (let number = 0; number < 10_000; number++) throttle(`signup:${number}`, 20);
  expect(() => throttle("new key", 20)).toThrowError(expect.objectContaining({ code: "too_many_attempts" }));
  throttle("signup:0", 20);
  now += 15 * 60_000;
  expect(() => throttle("new key", 20)).not.toThrow();
});

it("shares hash capacity with login, releases jobs after failure, and never inserts a busy request", async () => {
  const jobs = [hashPassword(password), hashPassword(password)];
  const busy = await signup().expect(429);
  expect(busy.body.error.code).toBe("auth_busy");
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
  await Promise.all(jobs);
  vi.mocked(scrypt).mockImplementationOnce((_input, _salt, _length, _options, callback) => callback(new Error("Synthetic hashing failure"), Buffer.alloc(0)));
  await expect(hashPassword(password)).rejects.toThrow("Synthetic hashing failure");
  await signup().expect(201);
});

it("maps only the users.email unique constraint to a signup conflict", () => {
  context.database.createUser("existing@example.com", "existing hash");
  const lookup = vi.spyOn(context.database, "getUserByEmail").mockReturnValue(null);
  expect(() => context.database.createSignupUser("existing@example.com", "replacement hash"))
    .toThrowError(expect.objectContaining({ status: 409, code: "signup_unavailable" }));
  lookup.mockRestore();
  expect(context.database.getUserByEmail("existing@example.com")?.passwordHash).toBe("existing hash");
});

it("does not create an account when another connection holds the write lock", () => {
  const source = new Database(path);
  try {
    source.exec("BEGIN IMMEDIATE");
    expect(() => context.database.createSignupUser("locked@example.com", "hash"))
      .toThrowError(expect.objectContaining({ code: "SQLITE_BUSY" }));
    source.exec("ROLLBACK");
    expect(context.database.getUserByEmail("locked@example.com")).toBeNull();
    expect(context.database.createSignupUser("locked@example.com", "hash")).toEqual({ email: "locked@example.com" });
  } finally { source.close(); }
}, 15_000);

it("ignores forwarded IP headers when the connection is not a trusted proxy", async () => {
  context.app.set("trust proxy", false);
  for (let count = 0; count < 20; count++) {
    await request(context.app).post("/api/auth/signup").set("Origin", origin).set("X-Forwarded-For", `192.0.2.${count + 1}`).send({}).expect(400);
  }
  await signup().set("X-Forwarded-For", "198.51.100.1").expect(429);
});

it("keeps all four note types, counts, feeds and links private between two public users", async () => {
  const tokens: string[] = [];
  for (const email of ["public-a@example.com", "public-b@example.com"]) {
    await signup(email).expect(201);
    const login = await request(context.app).post("/api/auth/extension-login").send({ email, password }).expect(200);
    tokens.push(login.body.data.token);
  }
  const [firstToken, secondToken] = tokens;
  if (!firstToken || !secondToken) throw new Error("Expected both public login tokens");
  const firstProblem = await request(context.app).post("/api/problems").auth(firstToken, { type: "bearer" })
    .send({ name: "private puzzle", url: "https://example.com/puzzle", platform: "other" }).expect(201);
  const secondProblem = await request(context.app).post("/api/problems").auth(secondToken, { type: "bearer" })
    .send({ name: "other puzzle", url: "https://example.com/puzzle", platform: "other" }).expect(201);
  const notes = [
    { path: "patterns", body: { trigger: "private", coreIdea: "private", complexity: "O(1)" }, patch: { trigger: "changed" } },
    { path: "mistakes", body: { rootCause: "other", notes: "private" }, patch: { notes: "changed" } },
    { path: "snippets", body: { name: "private", language: "cpp", code: "private" }, patch: { code: "changed" } },
    { path: "editorial", body: { oneLiner: "private" }, patch: { oneLiner: "changed" } },
  ];
  for (const note of notes) {
    const problemLink = note.path === "snippets" ? {} : { problemId: firstProblem.body.data.id };
    const saved = await request(context.app).post(`/api/${note.path}`).auth(firstToken, { type: "bearer" }).send({ ...note.body, ...problemLink }).expect(201);
    const otherList = await request(context.app).get(`/api/${note.path}?query=private`).auth(secondToken, { type: "bearer" }).expect(200);
    expect(otherList.body.meta.total).toBe(0);
    await request(context.app).patch(`/api/${note.path}/${saved.body.data.id}`).auth(secondToken, { type: "bearer" }).send(note.patch).expect(404);
    await request(context.app).delete(`/api/${note.path}/${saved.body.data.id}`).auth(secondToken, { type: "bearer" }).expect(404);
    if (note.path !== "snippets") {
      await request(context.app).post(`/api/${note.path}`).auth(secondToken, { type: "bearer" }).send({ ...note.body, ...problemLink }).expect(404);
      await request(context.app).patch(`/api/${note.path}/${saved.body.data.id}`).auth(firstToken, { type: "bearer" }).send({ problemId: secondProblem.body.data.id }).expect(404);
    }
  }
  expect((await request(context.app).get("/api/problems?query=private").auth(secondToken, { type: "bearer" }).expect(200)).body.meta.total).toBe(0);
  expect((await request(context.app).get("/api/feed").auth(firstToken, { type: "bearer" }).expect(200)).body.meta.total).toBe(4);
  expect((await request(context.app).get("/api/feed").auth(secondToken, { type: "bearer" }).expect(200)).body.meta.total).toBe(0);
  const stats = await request(context.app).get("/api/mistakes/stats").auth(secondToken, { type: "bearer" }).expect(200);
  expect(Object.values(stats.body.data).every((count) => count === 0)).toBe(true);
});
