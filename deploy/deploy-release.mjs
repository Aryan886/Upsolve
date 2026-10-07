import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createReadStream, createWriteStream, existsSync, realpathSync, statSync, statfsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const runFile = promisify(execFile);
const root = "/opt/cp-notes";
const releases = join(root, "releases");
const currentLink = join(root, "current");
const workRoot = "/var/lib/cp-notes-deploy";
const uploads = join(workRoot, "uploads");
const states = join(workRoot, "state");
const databasePath = "/var/lib/cp-notes/cp-notes.db";
const backupDirectory = "/var/lib/cp-notes/backups";
const checker = "/usr/local/libexec/cp-notes/check-release.mjs";
const extractor = "/usr/local/libexec/cp-notes/extract-release.py";
const node = "/opt/node/bin/node";
const instance = process.argv[2] ?? "";
const match = /^(deploy|migrate|rollback)-([a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4})$/.exec(instance);
const operation = match?.[1];
const releaseName = match?.[2] ?? "";
const candidatePath = join(releases, releaseName);
const statusPath = join(states, `${instance}.json`);
const appOrigin = process.env.APP_ORIGIN;
const remoteBackup = process.env.PRE_RELEASE_S3_URI;
const appEnvironment = { PATH: "/opt/node/bin:/usr/local/bin:/usr/bin:/bin", HOME: "/var/lib/cp-notes", NODE_ENV: "production" };
let previousPath;
let backupPath;
let timerWasActive = false;
let timerStopped = false;
let appStopped = false;
let switched = false;
let result = { operation, releaseName, status: "running", stage: "starting", startedAt: new Date().toISOString() };

async function command(file, args, options = {}) {
  const response = await runFile(file, args, { timeout: 120_000, maxBuffer: 1024 * 1024, ...options });
  return response.stdout.trim();
}

async function asApp(args, includeBackupCredentials = false) {
  const environment = { ...appEnvironment };
  if (includeBackupCredentials) {
    for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION", "AWS_REGION", "AWS_EC2_METADATA_DISABLED"]) {
      if (process.env[name]) environment[name] = process.env[name];
    }
  }
  return command("/usr/sbin/runuser", ["-u", "cp-notes", "--", node, checker, ...args], { env: environment, timeout: 600_000 });
}

async function updateStatus(stage, extra = {}) {
  result = { ...result, ...extra, stage, updatedAt: new Date().toISOString() };
  const temporary = `${statusPath}.partial`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, statusPath);
}

function releaseAt(path) {
  const actual = realpathSync(path);
  if (!actual.startsWith(`${releases}/`) || actual === releases) throw new Error("Active release is outside the release directory");
  if (!statSync(join(actual, "backend/dist/index.js")).isFile()) throw new Error("Release backend is missing");
  return actual;
}

async function readManifest(path) {
  const manifest = JSON.parse(await readFile(join(path, "release-manifest.json"), "utf8"));
  if (manifest.name !== releaseName || manifest.commit !== releaseName.slice(0, 40)) throw new Error("Release identity does not match archive name");
  if (manifest.node !== "v22.23.3" || manifest.os !== "amazonlinux-2023" || manifest.architecture !== process.arch) throw new Error("Release runtime does not match server");
  if (manifest.websiteOrigin !== appOrigin) throw new Error("Release website origin differs from runtime configuration");
  if (!Number.isInteger(manifest.schema) || manifest.schema < 1) throw new Error("Release schema metadata is invalid");
  const identity = JSON.parse(await readFile(join(path, "website/dist/release.json"), "utf8"));
  if (identity.commit !== manifest.commit || identity.runId !== manifest.runId || identity.runAttempt !== manifest.runAttempt) throw new Error("Public release identity differs from manifest");
  if ((await readFile(join(path, "SOURCE_COMMIT"), "utf8")).trim() !== manifest.commit) throw new Error("SOURCE_COMMIT differs from manifest");
  if ((await readFile(join(path, "website/dist/googleae6bb7febf88fddb.html"), "utf8")).trim() !== "google-site-verification: googleae6bb7febf88fddb.html") throw new Error("Google verification file is missing or changed");
  return manifest;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest("hex");
}

async function checkArchive(archive) {
  const checksum = (await readFile(`${archive}.sha256`, "utf8")).trim();
  const expected = /^([a-f0-9]{64})  ([a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}\.tar\.gz)$/.exec(checksum);
  if (!expected || expected[2] !== basename(archive)) throw new Error("Release checksum file is invalid");
  if (await hashFile(archive) !== expected[1]) throw new Error("Release checksum mismatch");
}

export async function copyUpload(source, destination, maximumSize) {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const information = await input.stat();
    if (!information.isFile() || information.size > maximumSize) throw new Error("Uploaded release file is invalid or too large");
    const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await pipeline(
        createReadStream(source, { fd: input.fd, autoClose: false }),
        createWriteStream(destination, { fd: output.fd, autoClose: false }),
      );
    } finally {
      await output.close();
    }
    if (statSync(destination).size !== information.size) throw new Error("Uploaded release file changed during transfer");
    return information.size;
  } finally {
    await input.close();
  }
}

async function stageRelease() {
  if (existsSync(candidatePath)) throw new Error("Release directory already exists; refusing overwrite");
  const archive = join(uploads, `${releaseName}.tar.gz`);
  const initialSpace = statfsSync(workRoot);
  if (initialSpace.bavail * initialSpace.bsize < 1536 * 1024 * 1024) throw new Error("Not enough disk to copy and inspect release archive");
  const protectedArchive = join(workRoot, `${releaseName}.tar.gz`);
  if (existsSync(protectedArchive)) throw new Error("Protected upload copy already exists");
  await copyUpload(archive, protectedArchive, 1024 * 1024 * 1024);
  await copyUpload(`${archive}.sha256`, `${protectedArchive}.sha256`, 256);
  await checkArchive(protectedArchive);
  const databaseSize = statSync(databasePath).size;
  const available = statfsSync(workRoot);
  const freeBytes = available.bavail * available.bsize;
  if (freeBytes < 1024 * 1024 * 1024 + databaseSize * 3 + 512 * 1024 * 1024) throw new Error("Not enough free disk for release and backups");
  const staging = join(releases, `.staging-${releaseName}`);
  if (existsSync(staging)) throw new Error("A staging directory already exists; inspect it before retrying");
  await command("/usr/bin/python3", [extractor, protectedArchive, staging], { timeout: 180_000 });
  await readManifest(staging);
  await rename(staging, candidatePath);
  return readManifest(candidatePath);
}

async function switchTo(path) {
  const nextLink = join(root, `.next-${instance}`);
  if (existsSync(nextLink)) throw new Error("A temporary release link already exists");
  await symlink(path, nextLink);
  await rename(nextLink, currentLink);
}

async function isActive(service) {
  const state = await command("/usr/bin/systemctl", ["show", service, "--property=ActiveState", "--value"]);
  if (!["active", "inactive", "failed", "activating", "deactivating"].includes(state)) throw new Error(`Unexpected ${service} state: ${state}`);
  return ["active", "activating", "deactivating"].includes(state);
}

async function requireInstalled(service) {
  const state = await command("/usr/bin/systemctl", ["show", service, "--property=LoadState", "--value"]);
  if (state !== "loaded") throw new Error(`Required ${service} unit is not installed`);
}

async function waitForBackupService() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await command("/usr/bin/systemctl", ["show", "cp-notes-backup.service", "--property=ActiveState", "--value"]);
    if (!["active", "activating", "deactivating"].includes(state)) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Backup service did not finish within five minutes");
}

async function startApp() {
  await command("/usr/bin/systemctl", ["reset-failed", "cp-notes"]);
  await command("/usr/bin/systemctl", ["start", "cp-notes"]);
  appStopped = false;
}

async function fetchText(path, options = {}) {
  const response = await fetch(`${appOrigin}${path}`, { signal: AbortSignal.timeout(10_000), ...options });
  return { response, body: await response.text() };
}

export async function waitForHealth(url, maximumAttempts = 20, retryDelay = 1000) {
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok && (await response.json()).data?.status === "ok") return;
    } catch (error) {
      if (!(error instanceof TypeError) && error?.name !== "TimeoutError") throw error;
    }
    if (attempt + 1 < maximumAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  throw new Error("Application did not become healthy on loopback");
}

async function verifyRelease(manifest) {
  await waitForHealth("http://127.0.0.1:3000/health");
  const publicHealth = await fetchText("/health");
  if (!publicHealth.response.ok || JSON.parse(publicHealth.body).data?.status !== "ok") throw new Error("Public HTTPS health failed");
  const identity = await fetchText("/release.json");
  if (!identity.response.ok || JSON.parse(identity.body).commit !== manifest.commit) throw new Error("Public release identity does not match candidate");
  const homepage = await fetchText("/");
  if (!homepage.response.ok || !homepage.body.includes("CP Notes")) throw new Error("Homepage failed");
  const script = /src="([^"]+\.js)"/.exec(homepage.body)?.[1];
  if (!script || !(await fetchText(script)).response.ok) throw new Error("Website asset failed");
  if (!(await fetchText("/privacy")).response.ok) throw new Error("Privacy page failed");
  const google = await fetchText("/googleae6bb7febf88fddb.html");
  if (!google.response.ok || google.body.trim() !== "google-site-verification: googleae6bb7febf88fddb.html") throw new Error("Google verification failed");
  const privateApi = await fetchText("/api/feed");
  if (privateApi.response.status !== 401) throw new Error("Unauthenticated feed did not reject access");
}

async function restoreTimer() {
  if (timerStopped && timerWasActive) await command("/usr/bin/systemctl", ["start", "cp-notes-backup.timer"]);
  timerStopped = false;
}

async function recover() {
  if (!switched) {
    if (!appStopped && await isActive("cp-notes")) return { recovery: "old release remained active" };
    await startApp();
    await waitForHealth("http://127.0.0.1:3000/health");
    return { recovery: "old release restarted" };
  }
  try {
    if (operation === "migrate") {
      await command("/usr/bin/systemctl", ["stop", "cp-notes"]);
      appStopped = true;
      throw new Error("Migration may have changed live data; application stopped for manual recovery");
    }
    await asApp(["rollback", previousPath, backupPath, databasePath]);
    await command("/usr/bin/systemctl", ["stop", "cp-notes"]);
    appStopped = true;
    await switchTo(previousPath);
    switched = false;
    await startApp();
    await waitForHealth("http://127.0.0.1:3000/health");
    return { recovery: "previous compatible code restored" };
  } catch (recoveryError) {
    let stopError;
    try {
      await command("/usr/bin/systemctl", ["stop", "cp-notes"]);
      appStopped = true;
    } catch (error) {
      stopError = error instanceof Error ? error.message : "Could not stop the failed application";
    }
    return { recovery: "manual recovery required", recoveryError: recoveryError instanceof Error ? recoveryError.message : "Unknown recovery failure", ...(stopError ? { stopError } : {}) };
  }
}

async function main() {
  if (!match) throw new Error("Invalid deployment operation or release name");
  if (process.getuid?.() !== 0) throw new Error("Deployment worker must run as root through its installed systemd unit");
  if (!appOrigin || !/^https:\/\//.test(appOrigin) || !remoteBackup) throw new Error("APP_ORIGIN and PRE_RELEASE_S3_URI are required");
  if (!existsSync(databasePath)) throw new Error("Production database is missing");
  await mkdir(states, { recursive: true, mode: 0o755 });
  const oldStates = await readdir(states);
  for (const name of oldStates.filter((value) => value.endsWith(".json"))) {
    const stored = JSON.parse(await readFile(join(states, name), "utf8"));
    if (stored.status === "running") throw new Error(`Incomplete deployment ${name}; reconcile it before continuing`);
  }
  await writeFile(statusPath, `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o644 });
  let manifest;
  try {
    previousPath = releaseAt(currentLink);
    await updateStatus("preflight", { previousRelease: basename(previousPath) });
    if (operation === "rollback") {
      if (!existsSync(join(candidatePath, "READY"))) throw new Error("Rollback target was not a verified installed release");
      const installedStatePath = join(states, `deploy-${releaseName}.json`);
      const migrationStatePath = join(states, `migrate-${releaseName}.json`);
      const completedStatePath = existsSync(installedStatePath) ? installedStatePath : migrationStatePath;
      const completedState = JSON.parse(await readFile(completedStatePath, "utf8"));
      if (completedState.status !== "complete" || completedState.releaseName !== releaseName) {
        throw new Error("Rollback target did not complete its original deployment");
      }
      if (candidatePath === previousPath) throw new Error("Selected release is already active");
      manifest = await readManifest(candidatePath);
    } else {
      manifest = await stageRelease();
      const currentSchema = JSON.parse(await asApp(["inspect", previousPath, databasePath])).schema;
      if (operation === "deploy" && manifest.schema !== currentSchema) throw new Error("Schema migration requires explicit migration release");
      const preflight = JSON.parse(await asApp(["preflight", previousPath, candidatePath, databasePath, String(operation === "migrate")]));
      if (preflight.afterSchema !== manifest.schema) throw new Error("Candidate schema differs from release manifest");
    }
    await requireInstalled("cp-notes-backup.service");
    await requireInstalled("cp-notes-backup.timer");
    timerWasActive = await isActive("cp-notes-backup.timer");
    if (timerWasActive) {
      await command("/usr/bin/systemctl", ["stop", "cp-notes-backup.timer"]);
      timerStopped = true;
    }
    await waitForBackupService();
    await command("/usr/bin/systemctl", ["stop", "cp-notes"]);
    appStopped = true;
    if (await isActive("cp-notes")) throw new Error("Application did not stop");
    await updateStatus("backing_up");
    const backup = JSON.parse(await asApp(["backup", previousPath, databasePath, backupDirectory, remoteBackup], true));
    backupPath = backup.backup;
    await updateStatus("backup_verified", { backup: basename(backupPath), backupSha256: backup.sha256, remoteBackup: backup.remote });
    if (operation === "rollback") await asApp(["rollback", candidatePath, backupPath, databasePath]);
    if (operation === "migrate") await asApp(["preflight", previousPath, candidatePath, backupPath, "true"]);
    await switchTo(candidatePath);
    switched = true;
    await updateStatus("activating");
    await startApp();
    await verifyRelease(manifest);
    await restoreTimer();
    if (operation !== "rollback") {
      await writeFile(join(candidatePath, "READY"), `${new Date().toISOString()}\n`, { flag: "wx", mode: 0o644 });
    }
    await updateStatus("complete", { status: "complete", commit: manifest.commit, schema: manifest.schema, completedAt: new Date().toISOString() });
  } catch (error) {
    let recovered;
    try {
      recovered = await recover();
    } catch (recoveryError) {
      recovered = { recovery: "manual recovery required", recoveryError: recoveryError instanceof Error ? recoveryError.message : "Unknown recovery failure" };
    }
    try {
      await restoreTimer();
    } catch (timerError) {
      recovered.timerError = timerError instanceof Error ? timerError.message : "Timer restart failed";
    }
    await updateStatus("failed", { status: "failed", error: error instanceof Error ? error.message : "Unknown deployment failure", ...recovered, failedAt: new Date().toISOString() });
    throw error;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Deployment failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
