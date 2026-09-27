import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { hashToken } from "./auth.js";
it("serves only public assets and keeps API failures JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cp-static-test-"));
  const website = join(directory, "website");
  await mkdir(website);
  await writeFile(join(website, "index.html"), "<h1>CP Notes</h1>");
  await writeFile(join(directory, ".env"), "must not be served");
  const context = createApp({ databasePath: ":memory:", websiteDirectory: website });
  try {
    context.database.createUser("a@example.com", "test");
    const token = "a".repeat(43);
    context.database.createSession(1, "test", hashToken(token), "extension", new Date(Date.now() + 60_000).toISOString());
    await request(context.app).get("/").expect(200).expect(/CP Notes/);
    for (const path of ["/.env", "/backend/data/cp-notes.db", "/backend/src/app.ts", "/package.json"]) await request(context.app).get(path).expect(404);
    const missing = await request(context.app).get("/api/unknown").auth(token, { type: "bearer" }).expect(404);
    expect(missing.body.error.code).toBe("route_not_found");
  } finally { context.close(); await rm(directory, { recursive: true, force: true }); }
});
it("fails startup without the website build", () => {
  expect(() => createApp({ databasePath: ":memory:", websiteDirectory: join(tmpdir(), "cp-notes-absent-build") })).toThrow("Built website is missing");
});
