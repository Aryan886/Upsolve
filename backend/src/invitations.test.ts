import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { INVITATION_INVALID_MESSAGE } from "@cp-notes/shared";
import { createApp } from "./app.js";
import { createThrottle, hashPassword, hashToken, verifyPassword } from "./auth.js";

const passwordControl = vi.hoisted(() => ({
  paused: false,
  callbacks: [] as Array<(error: Error | null, key: Buffer) => void>,
  onStart: () => undefined as void,
}));
vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal<typeof import("node:crypto")>();
  return {
    ...crypto,
    scrypt: (...argumentsList: unknown[]) => {
      if (!passwordControl.paused) return Reflect.apply(crypto.scrypt, undefined, argumentsList);
      const callback = argumentsList.at(-1);
      if (typeof callback !== "function") throw new Error("Expected a password callback");
      passwordControl.callbacks.push(callback as (error: Error | null, key: Buffer) => void);
      passwordControl.onStart();
    },
  };
});

const origin = "http://localhost:5173";
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const password = "invited user's strong password";
let passwordHash: string;
let context: ReturnType<typeof createApp>;
let pendingResponses: Array<Promise<request.Response>>;
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(() => {
  context = createApp({ databasePath: ":memory:", localDevelopment: true, extensionOrigins: [extensionOrigin] });
  pendingResponses = [];
});
afterEach(async () => {
  for (const callback of passwordControl.callbacks.splice(0)) callback(new Error("Test password job cancelled"), Buffer.alloc(0));
  await Promise.allSettled(pendingResponses);
  passwordControl.paused = false;
  context.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function invite(email = "tester@example.com", expiresAt = new Date(Date.now() + 60_000).toISOString()): string {
  const token = randomBytes(32).toString("base64url");
  context.database.issueInvitation(email, hashToken(token), expiresAt);
  return token;
}

function submit(action: "inspect" | "accept", body: unknown) {
  return request(context.app).post(`/api/auth/invitations/${action}`).set("Origin", origin).send(body);
}

async function holdAcceptance(token: string): Promise<{ response: Promise<request.Response> }> {
  passwordControl.paused = true;
  const started = new Promise<void>((resolve) => { passwordControl.onStart = resolve; });
  const response = submit("accept", { token, password }).then((result) => result);
  pendingResponses.push(response);
  await started;
  return { response };
}

function finishPassword(): void {
  const callback = passwordControl.callbacks.shift();
  if (!callback) throw new Error("No pending password job");
  callback(null, Buffer.alloc(64));
}

it.each(["rotate", "revoke", "expire", "existing", "full"] as const)("rechecks shared beta %s after password hashing", async (change) => {
  const betaToken = randomBytes(32).toString("base64url");
  context.database.issueBetaSignup(hashToken(betaToken), new Date(Date.now() + 60_000).toISOString());
  passwordControl.paused = true;
  const started = new Promise<void>((resolve) => { passwordControl.onStart = resolve; });
  const response = request(context.app).post("/api/auth/beta/accept").set("Origin", origin)
    .send({ token: betaToken, email: "pending@example.com", password }).then((result) => result);
  pendingResponses.push(response);
  await started;
  if (change === "rotate") context.database.issueBetaSignup(hashToken(randomBytes(32).toString("base64url")), new Date(Date.now() + 60_000).toISOString());
  if (change === "revoke") context.database.revokeBetaSignup();
  if (change === "expire") context.database.issueBetaSignup(hashToken(betaToken), new Date(Date.now() - 1).toISOString());
  if (change === "existing") context.database.createUser("pending@example.com", "manual hash");
  if (change === "full") {
    for (let number = 1; number <= 30; number++) context.database.acceptBetaSignup(hashToken(betaToken), `earlier${number}@example.com`, "stored hash");
  }
  finishPassword();
  const result = await response;
  expect(result.status).toBe(400);
  expect(result.body.error.code).toBe(change === "existing" ? "beta_account_unavailable" : change === "full" ? "beta_full" : "beta_unavailable");
  expect(context.database.getUserByEmail("pending@example.com")?.passwordHash).toBe(change === "existing" ? "manual hash" : undefined);
  expect(context.database.getBetaStatus().signupCount).toBe(change === "full" ? 30 : 0);
});

it("inspects repeatedly, accepts without a session, and supports ordinary website/extension login", async () => {
  const token = invite();
  for (let count = 0; count < 2; count++) {
    const response = await submit("inspect", { token }).expect(200);
    expect(response.body.data).toEqual(context.database.getInvitation(hashToken(token)));
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["set-cookie"]).toBeUndefined();
  }
  const accepted = await submit("accept", { token, password }).expect(201);
  expect(accepted.body).toEqual({ data: { email: "tester@example.com" } });
  expect(accepted.headers["set-cookie"]).toBeUndefined();
  const user = context.database.getUserByEmail("tester@example.com");
  expect(user?.active).toBe(true);
  expect(await verifyPassword(password, user?.passwordHash)).toBe(true);
  await request(context.app).get("/api/auth/me").expect(401);
  for (const path of ["/api/auth/me", "/api/feed"]) {
    await request(context.app).get(path).auth(token, { type: "bearer" }).expect(401);
    await request(context.app).get(path).set("Cookie", `cp_notes_dev=${token}`).expect(401);
  }
  const browser = request.agent(context.app);
  await browser.post("/api/auth/login").set("Origin", origin).send({ email: "tester@example.com", password }).expect(200);
  await browser.get("/api/auth/me").expect(200);
  await request(context.app).post("/api/auth/extension-login").set("Origin", extensionOrigin).send({ email: "tester@example.com", password }).expect(200);
  await submit("inspect", { token }).expect(400, { error: { code: "invitation_invalid", message: INVITATION_INVALID_MESSAGE } });
  await submit("accept", { token, password }).expect(400);
});

it("requires the website Origin even when a cookie or bearer credential is supplied", async () => {
  const token = invite();
  for (const action of ["inspect", "accept"] as const) {
    for (const requestOrigin of [undefined, "https://hostile.example", extensionOrigin]) {
      let call = request(context.app).post(`/api/auth/invitations/${action}`).auth(token, { type: "bearer" }).set("Cookie", `cp_notes_dev=${token}`);
      if (requestOrigin) call = call.set("Origin", requestOrigin);
      const response = await call.send({ token, ...(action === "accept" ? { password } : {}) }).expect(403);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  }
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
  expect(context.database.getInvitation(hashToken(token))).not.toBeNull();
});

it("rejects malformed requests and identity overrides without echoing secrets", async () => {
  const token = invite();
  const cases: unknown[] = [{}, { token: null }, { token: "short" }, { token: "!".repeat(43) }, { token: `${token} ` }];
  for (const body of cases) {
    await submit("inspect", body).expect(400, { error: { code: "validation_error", message: "The request is invalid" } });
    await submit("accept", body).expect(400);
  }
  for (const extra of [{ email: "private-override@example.com" }, { userId: 9 }, { active: false }, { passwordHash: "private hash" }]) {
    for (const action of ["inspect", "accept"] as const) {
      const response = await submit(action, { token, ...(action === "accept" ? { password } : {}), ...extra }).expect(400);
      expect(response.body.error.code).toBe("validation_error");
      for (const value of [token, password, "private-override@example.com", "private hash"]) expect(JSON.stringify(response.body)).not.toContain(value);
    }
  }
  for (const invalidPassword of ["short", "p".repeat(129)]) {
    await submit("accept", { token, password: invalidPassword }).expect(400);
  }
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
});

it("uses the same generic response for unknown, revoked, expired and ineligible invitations before hashing", async () => {
  const revoked = invite("revoked@example.com");
  context.database.revokeInvitation("revoked@example.com");
  const expired = invite("expired@example.com", new Date(0).toISOString());
  const existing = invite("existing@example.com");
  context.database.createUser("existing@example.com", passwordHash);
  context.database.disableUser(1);
  passwordControl.paused = true;
  for (const token of [randomBytes(32).toString("base64url"), revoked, expired, existing]) {
    for (const action of ["inspect", "accept"] as const) {
      await submit(action, { token, ...(action === "accept" ? { password } : {}) }).expect(400, {
        error: { code: "invitation_invalid", message: INVITATION_INVALID_MESSAGE },
      });
    }
  }
  expect(passwordControl.callbacks).toHaveLength(0);
  expect(context.database.getUserByEmail("existing@example.com")).toMatchObject({ passwordHash, active: false });
});

it("keeps an authenticated caller's identity and sessions unchanged during setup", async () => {
  const user = context.database.createUser("current@example.com", passwordHash);
  const sessionToken = randomBytes(32).toString("base64url");
  context.database.createSession(user.id, passwordHash, hashToken(sessionToken), "website", new Date(Date.now() + 60_000).toISOString());
  const token = invite();
  const response = await request(context.app).post("/api/auth/invitations/accept").set("Origin", origin).set("Cookie", `cp_notes_dev=${sessionToken}`).send({ token, password }).expect(201);
  expect(response.headers["set-cookie"]).toBeUndefined();
  const current = await request(context.app).get("/api/auth/me").set("Cookie", `cp_notes_dev=${sessionToken}`).expect(200);
  expect(current.body.data).toEqual(user);
});

it("allows exactly one simultaneous acceptance and shares password capacity with login", async () => {
  const token = invite();
  const first = await holdAcceptance(token);
  const second = await holdAcceptance(token);
  const anotherToken = invite("another@example.com");
  await submit("accept", { token: anotherToken, password }).expect(429);
  await request(context.app).post("/api/auth/login").set("Origin", origin).send({ email: "absent@example.com", password }).expect(429);
  expect(passwordControl.callbacks).toHaveLength(2);
  finishPassword();
  finishPassword();
  const responses = await Promise.all([first.response, second.response]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
  expect(context.database.getUserByEmail("tester@example.com")?.id).toBe(1);
  expect(context.database.getUserByEmail("another@example.com")).toBeNull();
});

it.each(["revoke", "reissue", "manual account", "expiry"])("rechecks %s while password hashing is pending", async (change) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  const token = invite();
  const pending = await holdAcceptance(token);
  let replacement: string | undefined;
  if (change === "revoke") context.database.revokeInvitation("tester@example.com");
  else if (change === "reissue") replacement = invite();
  else if (change === "manual account") context.database.createUser("tester@example.com", passwordHash);
  else vi.setSystemTime(new Date("2026-09-29T12:01:00Z"));
  finishPassword();
  const response = await pending.response;
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: { code: "invitation_invalid", message: INVITATION_INVALID_MESSAGE } });
  if (change === "manual account") expect(context.database.getUserByEmail("tester@example.com")?.passwordHash).toBe(passwordHash);
  else expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
  if (replacement) expect(context.database.getInvitation(hashToken(replacement))?.email).toBe("tester@example.com");
  if (change === "expiry") expect(context.database.revokeInvitation("tester@example.com")).toBe(true);
});

it("limits IP requests before validation and combines inspect/accept without consuming invitations", async () => {
  const token = invite();
  for (let count = 0; count < 40; count++) await submit(count % 2 ? "inspect" : "accept", {}).expect(400);
  await submit("inspect", { token }).expect(429);
  expect(context.database.getInvitation(hashToken(token))).not.toBeNull();
});

it("limits acceptance by token hash and expires limiter entries at 15 minutes", async () => {
  const token = randomBytes(32).toString("base64url");
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  for (let count = 0; count < 10; count++) await submit("accept", { token, password }).expect(400);
  await submit("accept", { token, password }).expect(429);
  await submit("inspect", { token }).expect(400);
  now += 15 * 60_000;
  await submit("accept", { token, password }).expect(400);
});

it("bounds throttle storage, keeps existing keys usable, and frees expired entries", () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const throttle = createThrottle();
  for (let count = 0; count < 10_000; count++) throttle(`key:${count}`, 3);
  expect(() => throttle("overflow", 3)).toThrowError(expect.objectContaining({ code: "too_many_attempts" }));
  throttle("key:0", 3);
  throttle("key:0", 3);
  expect(() => throttle("key:0", 3)).toThrowError(expect.objectContaining({ status: 429 }));
  now = 15 * 60_000;
  expect(() => throttle("overflow", 3)).not.toThrow();
}, 15_000);

it("surfaces unexpected database failures with safe logs and leaves the invitation usable", async () => {
  const token = invite();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fail = vi.spyOn(context.database, "acceptInvitation").mockImplementation(() => { throw new Error(`${token} ${password} private failure`); });
  const pending = await holdAcceptance(token);
  finishPassword();
  const response = await pending.response;
  expect(response.status).toBe(500);
  expect(response.body.error.code).toBe("internal_error");
  expect(log).toHaveBeenCalled();
  for (const value of [token, password, "private failure"]) {
    expect(JSON.stringify(log.mock.calls)).not.toContain(value);
    expect(JSON.stringify(response.body)).not.toContain(value);
  }
  fail.mockRestore();
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
  expect(context.database.getInvitation(hashToken(token))).not.toBeNull();
});

it("leaves an invitation usable after a password job failure and releases the hashing slot", async () => {
  const token = invite();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const accept = vi.spyOn(context.database, "acceptInvitation");
  const pending = await holdAcceptance(token);
  const callback = passwordControl.callbacks.shift();
  if (!callback) throw new Error("No pending password job");
  callback(new Error("Synthetic password job failure"), Buffer.alloc(0));
  const failed = await pending.response;
  expect(failed.status).toBe(500);
  expect(failed.body.error.code).toBe("internal_error");
  expect(log).toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  expect(context.database.getUserByEmail("tester@example.com")).toBeNull();
  expect(context.database.getInvitation(hashToken(token))).not.toBeNull();

  const first = await holdAcceptance(token);
  const secondToken = invite("another@example.com");
  const second = await holdAcceptance(secondToken);
  expect(passwordControl.callbacks).toHaveLength(2);
  finishPassword();
  finishPassword();
  expect((await first.response).status).toBe(201);
  expect((await second.response).status).toBe(201);
});

it("keeps all note types private for two accounts created through invitation acceptance", async () => {
  const sessions: string[] = [];
  for (const email of ["a@example.com", "b@example.com"]) {
    await submit("accept", { token: invite(email), password }).expect(201);
    const login = await request(context.app).post("/api/auth/extension-login").send({ email, password }).expect(200);
    sessions.push(login.body.data.token as string);
  }
  const [first, second] = sessions;
  if (!first || !second) throw new Error("Missing test sessions");
  const problem = await request(context.app).post("/api/problems").auth(first, { type: "bearer" }).send({ name: "private", url: "https://example.com/private", platform: "other" }).expect(201);
  const notes = [
    { path: "patterns", body: { trigger: "private", coreIdea: "private", complexity: "O(1)", problemId: problem.body.data.id }, patch: { trigger: "changed" } },
    { path: "mistakes", body: { rootCause: "other", notes: "private", problemId: problem.body.data.id }, patch: { notes: "changed" } },
    { path: "snippets", body: { name: "private", language: "cpp", code: "private" }, patch: { code: "changed" } },
    { path: "editorial", body: { oneLiner: "private", problemId: problem.body.data.id }, patch: { oneLiner: "changed" } },
  ];
  for (const note of notes) {
    const saved = await request(context.app).post(`/api/${note.path}`).auth(first, { type: "bearer" }).send(note.body).expect(201);
    const other = await request(context.app).get(`/api/${note.path}?query=private`).auth(second, { type: "bearer" }).expect(200);
    expect(other.body.meta.total).toBe(0);
    await request(context.app).patch(`/api/${note.path}/${saved.body.data.id}`).auth(second, { type: "bearer" }).send(note.patch).expect(404);
    await request(context.app).delete(`/api/${note.path}/${saved.body.data.id}`).auth(second, { type: "bearer" }).expect(404);
    if (note.path !== "snippets") await request(context.app).post(`/api/${note.path}`).auth(second, { type: "bearer" }).send(note.body).expect(404);
  }
  expect((await request(context.app).get("/api/problems?query=private").auth(second, { type: "bearer" }).expect(200)).body.meta.total).toBe(0);
  expect((await request(context.app).get("/api/feed").auth(first, { type: "bearer" }).expect(200)).body.meta.total).toBe(4);
  expect((await request(context.app).get("/api/feed").auth(second, { type: "bearer" }).expect(200)).body.meta.total).toBe(0);
  expect(Object.values((await request(context.app).get("/api/mistakes/stats").auth(second, { type: "bearer" }).expect(200)).body.data).every((count) => count === 0)).toBe(true);
});
