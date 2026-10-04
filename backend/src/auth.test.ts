import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { hashPassword, hashToken, verifyPassword } from "./auth.js";

const password = "correct horse battery staple";
const origin = "http://localhost:5173";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });

describe("authentication and ownership", () => {
  let context: ReturnType<typeof createApp>;
  let tokenA: string;
  let tokenB: string;
  beforeEach(() => {
    context = createApp({ databasePath: ":memory:", localDevelopment: true });
    for (const email of ["a@example.com", "b@example.com"]) {
      const user = context.database.createUser(email, passwordHash);
      const token = randomBytes(32).toString("base64url");
      context.database.createSession(user.id, passwordHash, hashToken(token), "extension", new Date(Date.now() + 60_000).toISOString());
      if (email.startsWith("a")) tokenA = token; else tokenB = token;
    }
  });
  afterEach(() => context.close());

  it("hashes with random salt and rejects incorrect passwords", async () => {
    expect(await hashPassword(password)).not.toBe(passwordHash);
    expect(await verifyPassword(password, passwordHash)).toBe(true);
    expect(await verifyPassword("incorrect", passwordHash)).toBe(false);
    expect(await verifyPassword(password, undefined)).toBe(false);
  });

  it("requires authentication on all data endpoints", async () => {
    for (const path of ["problems", "patterns", "mistakes", "mistakes/stats", "snippets", "editorial", "feed"]) {
      await request(context.app).get(`/api/${path}`).expect(401);
      await request(context.app).post(`/api/${path}`).send({}).expect(401);
    }
    await request(context.app).patch("/api/patterns/1").send({ trigger: "x" }).expect(401);
    await request(context.app).delete("/api/snippets/1").expect(401);
  });

  it("keeps search, counts, feed, edits, deletes and links private across all note types", async () => {
    const problem = { name: "Private puzzle", platform: "other", url: "https://example.com/private", tags: ["secret"] };
    const firstProblem = await request(context.app).post("/api/problems").auth(tokenA, { type: "bearer" }).send(problem).expect(201);
    const secondProblem = await request(context.app).post("/api/problems").auth(tokenB, { type: "bearer" }).send({ ...problem, name: "B puzzle" }).expect(201);
    expect(firstProblem.body.data.id).not.toBe(secondProblem.body.data.id);
    const notes = [
      { path: "patterns", body: { trigger: "secret", coreIdea: "secret", complexity: "O(1)", tags: ["secret"] }, patch: { trigger: "changed" } },
      { path: "mistakes", body: { rootCause: "other", notes: "secret" }, patch: { notes: "changed" } },
      { path: "snippets", body: { name: "secret", language: "cpp", code: "secret", tags: ["secret"] }, patch: { code: "changed" } },
      { path: "editorial", body: { oneLiner: "secret" }, patch: { oneLiner: "changed" } },
    ];
    for (const note of notes) {
      const created = await request(context.app).post(`/api/${note.path}`).auth(tokenA, { type: "bearer" }).send({ ...note.body, userId: 2, ...(note.path !== "snippets" ? { problemId: firstProblem.body.data.id } : {}) }).expect(201);
      const id = created.body.data.id;
      const privateList = await request(context.app).get(`/api/${note.path}?query=secret`).auth(tokenB, { type: "bearer" }).expect(200);
      expect(privateList.body.meta.total).toBe(0);
      await request(context.app).patch(`/api/${note.path}/${id}`).auth(tokenB, { type: "bearer" }).send(note.patch).expect(404);
      await request(context.app).delete(`/api/${note.path}/${id}`).auth(tokenB, { type: "bearer" }).expect(404);
      if (note.path !== "snippets") {
        await request(context.app).post(`/api/${note.path}`).auth(tokenB, { type: "bearer" }).send({ ...note.body, problemId: firstProblem.body.data.id }).expect(404);
        await request(context.app).patch(`/api/${note.path}/${id}`).auth(tokenA, { type: "bearer" }).send({ problemId: secondProblem.body.data.id }).expect(404);
      }
    }
    const feed = await request(context.app).get("/api/feed").auth(tokenB, { type: "bearer" });
    expect(feed.body.meta.total).toBe(0);
    const ownFeed = await request(context.app).get("/api/feed").auth(tokenA, { type: "bearer" });
    expect(ownFeed.body.meta.total).toBe(4);
    const stats = await request(context.app).get("/api/mistakes/stats").auth(tokenB, { type: "bearer" });
    expect(Object.values(stats.body.data).every((count) => count === 0)).toBe(true);
    const search = await request(context.app).get("/api/problems?query=private").auth(tokenB, { type: "bearer" });
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe("B puzzle");
  });

  it("uses independent session types and protects browser mutations from other origins", async () => {
    const browser = request.agent(context.app);
    await browser.post("/api/auth/login").send({ email: "a@example.com", password }).expect(403);
    const login = await browser.post("/api/auth/login").set("Origin", origin).send({ email: "A@example.com", password }).expect(200);
    expect(login.body.data.email).toBe("a@example.com");
    expect(Object.keys(login.body.data).sort()).toEqual(["createdAt", "email", "id"]);
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Lax");
    await browser.get("/api/auth/me").expect(200);
    await browser.post("/api/snippets").send({ name: "n", language: "cpp", code: "c" }).expect(403);
    await browser.post("/api/snippets").set("Origin", origin).send({ name: "n", language: "cpp", code: "c" }).expect(201);
    const cookieToken = login.headers["set-cookie"][0].split(";")[0].split("=")[1];
    await request(context.app).get("/api/auth/me").auth(cookieToken, { type: "bearer" }).expect(401);
    await request(context.app).get("/api/auth/me").set("Cookie", `cp_notes_dev=${tokenA}`).expect(401);
    await browser.post("/api/auth/logout").set("Origin", origin).expect(204);
    await browser.get("/api/auth/me").expect(401);
    await request(context.app).get("/api/auth/me").auth(tokenA, { type: "bearer" }).expect(200);
  });

  it("revokes every session after password change, reset and disable", async () => {
    const login = await request(context.app).post("/api/auth/extension-login").send({ email: "a@example.com", password }).expect(200);
    await request(context.app).post("/api/auth/change-password").auth(tokenA, { type: "bearer" }).send({ currentPassword: password, newPassword: "a different strong password" }).expect(204);
    for (const token of [tokenA, login.body.data.token]) await request(context.app).get("/api/auth/me").auth(token, { type: "bearer" }).expect(401);
    context.database.setPassword(2, passwordHash);
    await request(context.app).get("/api/auth/me").auth(tokenB, { type: "bearer" }).expect(401);
    context.database.disableUser(2);
    await request(context.app).post("/api/auth/extension-login").send({ email: "b@example.com", password }).expect(401);
  });

  it("expires sessions, restricts CORS, and throttles account attempts", async () => {
    const expired = "x".repeat(43);
    context.database.createSession(1, passwordHash, hashToken(expired), "extension", new Date(0).toISOString());
    await request(context.app).get("/api/auth/me").auth(expired, { type: "bearer" }).expect(401);
    await request(context.app).get("/api/feed").set("Origin", "chrome-extension://unconfigured").auth(tokenA, { type: "bearer" }).expect(403);
    for (let count = 0; count < 10; count++) {
      await request(context.app).post("/api/auth/extension-login").send({ email: "absent@example.com", password: "wrong" }).expect(401);
    }
    await request(context.app).post("/api/auth/extension-login").send({ email: "absent@example.com", password: "wrong" }).expect(429);
  });
});

it("sets Secure production cookies and leaves health minimal", async () => {
  const context = createApp({ databasePath: ":memory:", websiteOrigins: ["https://notes.example.com"] });
  try {
    context.database.createUser("a@example.com", passwordHash);
    const result = await request(context.app).post("/api/auth/login").set("Origin", "https://notes.example.com").send({ email: "a@example.com", password }).expect(200);
    expect(result.headers["set-cookie"][0]).toContain("__Host-cp_notes=");
    expect(result.headers["set-cookie"][0]).toContain("Secure");
    expect((await request(context.app).get("/health").expect(200)).body).toEqual({ data: { status: "ok" } });
  } finally { context.close(); }
});


it("bounds expensive password jobs instead of queuing unbounded work", async () => {
  const results = await Promise.allSettled([verifyPassword(password, passwordHash), verifyPassword(password, passwordHash), verifyPassword(password, passwordHash)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({ status: "rejected", reason: { status: 429, code: "auth_busy" } });
});
