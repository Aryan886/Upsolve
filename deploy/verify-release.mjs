import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { NotesDatabase } from "../backend/dist/database.js";
import { hashPassword } from "../backend/dist/auth.js";
import { createBackup } from "../backend/dist/backup.js";

const directory = await mkdtemp(join(tmpdir(), "cp-notes-release-"));
const databasePath = join(directory, "test.db");
const password = "release verification password";
const database = new NotesDatabase(databasePath);
const passwordHash = await hashPassword(password);
database.createUser("a@example.test", passwordHash);
database.createUser("b@example.test", passwordHash);
database.close();
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
async function api(path, token, body) {
  const response = await fetch(`${address}/api${path}`, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
try {
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
  const first = await api("/auth/extension-login", undefined, { email: "a@example.test", password });
  const second = await api("/auth/extension-login", undefined, { email: "b@example.test", password });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const token = first.body.data.token;
  assert.equal((await api("/missing", token)).body.error.code, "route_not_found");
  const saved = await api("/patterns", token, { trigger: "release check", coreIdea: "persist", complexity: "O(1)", problem: { name: "Two Sum", url: "https://leetcode.com/problems/two-sum/description", platform: "leetcode" } });
  assert.equal(saved.status, 201);
  assert.equal((await api("/feed", second.body.data.token)).body.meta.total, 0);
  const backup = await createBackup(databasePath, join(directory, "backups"));
  await stop();
  await start(databasePath);
  assert.equal((await api("/patterns?query=release", token)).body.meta.total, 1);
  await stop();
  await start(backup);
  assert.equal((await api("/feed", token)).body.meta.total, 1);
  assert.equal((await api("/feed", second.body.data.token)).body.meta.total, 0);
  const restoredLogin = await api("/auth/extension-login", undefined, { email: "a@example.test", password });
  assert.equal(restoredLogin.status, 200);
  await stop();
  const manifest = JSON.parse(await readFile(new URL("../extension/dist/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["https://notes.example.test/*"]);
  assert.ok(!manifest.permissions.includes("tabs"));
  console.log("Linux production smoke passed: compiled startup, static assets, authenticated save/search, isolation, restart, restore, SIGTERM and extension host permission.");
  console.log(`Temporary verification data: ${directory}`);
} finally { await stop(); }
