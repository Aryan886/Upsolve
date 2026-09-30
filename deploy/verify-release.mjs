import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { NotesDatabase } from "../backend/dist/database.js";
import { hashToken } from "../backend/dist/auth.js";
import { createBackup } from "../backend/dist/backup.js";

const directory = await mkdtemp(join(tmpdir(), "cp-notes-release-"));
const databasePath = join(directory, "test.db");
const password = "release verification password";
const database = new NotesDatabase(databasePath);
database.close();
const origin = "https://notes.example.test";

async function admin(argumentsList, path = databasePath, extraEnvironment = {}) {
  return await new Promise((resolve, reject) => {
    const command = spawn(process.execPath, [fileURLToPath(new URL("../backend/dist/admin.js", import.meta.url)), ...argumentsList], {
      cwd: directory,
      env: { ...process.env, NODE_ENV: "production", LOCAL_DEVELOPMENT: "false", DATABASE_PATH: path, APP_ORIGIN: origin, INVITATION_HOURS: "72", ...extraEnvironment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    command.stdout.on("data", (data) => { stdout += data; });
    // Do not include invitation output in errors or release evidence.
    command.stderr.resume();
    command.once("error", reject);
    command.once("close", (code) => {
      if (code !== 0) reject(new Error(`Compiled admin ${argumentsList[0]} failed with exit ${code}`));
      else resolve(stdout);
    });
  });
}

async function issue(email, extraEnvironment = {}) {
  const stdout = await admin(["invite", email], databasePath, extraEnvironment);
  const link = /Private setup link: (\S+)/.exec(stdout)?.[1];
  assert.ok(link, "Compiled invitation command must print a setup link");
  let url;
  try { url = new URL(link); }
  catch { throw new Error("Compiled invitation command returned an invalid setup link"); }
  assert.equal(url.origin, origin);
  assert.ok(/^#invite=[A-Za-z0-9_-]{43}$/.test(url.hash), "Expected a fragment invitation");
  const token = url.hash.slice("#invite=".length);
  const stored = new NotesDatabase(databasePath, { existingOnly: true });
  try {
    assert.ok(stored.getUserByEmail(email) === null, "Issuance must not create a user");
    assert.equal(stored.getInvitation(hashToken(token))?.email, email);
  } finally { stored.close(); }
  return token;
}
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
const address = `http://127.0.0.1:${port}`;
let child;
let exit;
let output = "";
async function start(path) {
  output = "";
  child = spawn(process.execPath, [fileURLToPath(new URL("../backend/dist/index.js", import.meta.url))], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: "production", LOCAL_DEVELOPMENT: "false", PORT: String(port), DATABASE_PATH: path, APP_ORIGIN: "https://notes.example.test", EXTENSION_ORIGINS: `chrome-extension://${"a".repeat(32)}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  exit = once(child, "exit");
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Startup failed: ${output}`);
    try { if ((await fetch(`${address}/health`)).ok) return; } catch (error) { if (!(error instanceof TypeError)) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timed out: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const [code] = await exit;
  assert.equal(code, 0, output);
}
async function api(path, token, body, requestOrigin) {
  const response = await fetch(`${address}/api${path}`, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(requestOrigin ? { Origin: requestOrigin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
}
try {
  const invitationA = await issue("a@example.test");
  const oldInvitationB = await issue("b@example.test", { INVITATION_HOURS: "2" });
  const invitationB = await issue("b@example.test");
  const revoked = await issue("revoked@example.test");
  await admin(["revoke-invite", "revoked@example.test"]);
  assert.match(await admin(["revoke-invite", "revoked@example.test"]), /No outstanding invitation/);
  await start(databasePath);
  const homepage = await fetch(address);
  assert.equal(homepage.status, 200);
  const html = await homepage.text();
  assert.match(html, /CP Notes/);
  const script = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(script);
  assert.equal((await fetch(`${address}${script}`)).status, 200);
  for (const path of ["/.env", "/backend/data/cp-notes.db", "/package.json", "/backend/src/index.ts"]) assert.equal((await fetch(`${address}${path}`)).status, 404);
  assert.equal((await api("/feed")).status, 401);
  for (const token of [oldInvitationB, revoked]) {
    const invalid = await api("/auth/invitations/inspect", undefined, { token }, origin);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "invitation_invalid");
  }
  for (const [token, email] of [[invitationA, "a@example.test"], [invitationB, "b@example.test"]]) {
    for (let count = 0; count < 2; count++) {
      const inspected = await api("/auth/invitations/inspect", undefined, { token }, origin);
      assert.equal(inspected.status, 200);
      assert.ok(inspected.body.data?.email === email, "Inspection must return the invited email");
    }
    const accepted = await api("/auth/invitations/accept", undefined, { token, password }, origin);
    assert.equal(accepted.status, 201);
    assert.ok(JSON.stringify(accepted.body) === JSON.stringify({ data: { email } }), "Acceptance must return only the invited email");
    assert.ok(accepted.cookie === null, "Acceptance must not set a session cookie");
    assert.equal((await api("/auth/me", token)).status, 401);
    assert.equal((await api("/auth/invitations/accept", undefined, { token, password }, origin)).status, 400);
  }
  const websiteLogin = await api("/auth/login", undefined, { email: "a@example.test", password }, origin);
  assert.equal(websiteLogin.status, 200);
  assert.ok(websiteLogin.cookie?.includes("Secure"));
  assert.ok(websiteLogin.cookie?.includes("HttpOnly"));
  const first = await api("/auth/extension-login", undefined, { email: "a@example.test", password });
  const second = await api("/auth/extension-login", undefined, { email: "b@example.test", password });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const token = first.body.data.token;
  assert.equal((await api("/missing", token)).body.error.code, "route_not_found");
  const saved = await api("/patterns", token, { trigger: "release check", coreIdea: "persist", complexity: "O(1)", problem: { name: "Two Sum", url: "https://leetcode.com/problems/two-sum/description", platform: "leetcode" } });
  assert.equal(saved.status, 201);
  assert.equal((await api("/feed", second.body.data.token)).body.meta.total, 0);
  const outstanding = await issue("restore@example.test");
  const backup = await createBackup(databasePath, join(directory, "backups"));
  await stop();
  await start(databasePath);
  assert.equal((await api("/patterns?query=release", token)).body.meta.total, 1);
  assert.equal((await api("/auth/invitations/inspect", undefined, { token: outstanding }, origin)).status, 200);
  await admin(["revoke-invite", "restore@example.test"]);
  assert.equal((await api("/auth/invitations/inspect", undefined, { token: outstanding }, origin)).status, 400);
  await stop();
  await start(backup);
  assert.equal((await api("/feed", token)).body.meta.total, 1);
  assert.equal((await api("/feed", second.body.data.token)).body.meta.total, 0);
  const restoredLogin = await api("/auth/extension-login", undefined, { email: "a@example.test", password });
  assert.equal(restoredLogin.status, 200);
  assert.equal((await api("/auth/invitations/inspect", undefined, { token: invitationA }, origin)).status, 400);
  // Restoring an older snapshot can revive a later-revoked invitation.
  assert.equal((await api("/auth/invitations/inspect", undefined, { token: outstanding }, origin)).status, 200);
  await admin(["revoke-invite", "restore@example.test"], backup);
  assert.equal((await api("/auth/invitations/inspect", undefined, { token: outstanding }, origin)).status, 400);
  await stop();
  const manifest = JSON.parse(await readFile(new URL("../extension/dist/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["https://notes.example.test/*"]);
  assert.ok(!manifest.permissions.includes("tabs"));
  console.log("Linux production smoke passed: compiled invitation issue/reissue/revoke, acceptance, website/extension login, startup/static assets, authenticated save/search, isolation, invitation/session restart persistence, schema-3 restore/revocation, SIGTERM and extension host permission.");
  console.log(`Temporary verification data: ${directory}`);
} finally { await stop(); }
