import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { copyUpload, parseDeploymentInstance, waitForHealth } from "./deploy-release.mjs";

test("rollback operation IDs select the same installed release across distinct runs", () => {
  const release = `${"a".repeat(40)}-100-1`;
  assert.deepEqual(parseDeploymentInstance(`deploy-${release}`), { operation: "deploy", releaseName: release });
  for (const run of ["200-1", "201-2"]) {
    assert.deepEqual(parseDeploymentInstance(`rollback-${release}-${run}`), { operation: "rollback", releaseName: release });
  }
});

test("refuses ambiguous rollback IDs and unsafe deployment names", () => {
  const release = `${"a".repeat(40)}-100-1`;
  for (const instance of [`rollback-${release}`, `deploy-${release}-200-1`, `rollback-${release}-../-1`, `delete-${release}`]) {
    assert.equal(parseDeploymentInstance(instance), undefined);
  }
});

test("waits for a restarted application to finish becoming healthy", async () => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts++;
    response.writeHead(attempts < 3 ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: { status: attempts < 3 ? "starting" : "ok" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await waitForHealth(`http://127.0.0.1:${server.address().port}/health`, 4, 10);
    assert.equal(attempts, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fails within the retry limit when a restarted application remains unhealthy", async () => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: { status: "starting" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(waitForHealth(`http://127.0.0.1:${server.address().port}/health`, 2, 10), /did not become healthy/);
    assert.equal(attempts, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("copies a release upload to a private immutable input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cp-notes-upload-test-"));
  try {
    const source = join(directory, "upload.tar.gz");
    const destination = join(directory, "protected.tar.gz");
    writeFileSync(source, "release bytes");
    const size = await copyUpload(source, destination, 100);
    assert.equal(size, 13);
    assert.equal(readFileSync(destination, "utf8"), "release bytes");
    if (process.platform !== "win32") assert.equal(statSync(destination).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses an upload symlink before root reads it", { skip: process.platform === "win32" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "cp-notes-upload-link-test-"));
  try {
    const secret = join(directory, "private.db");
    const source = join(directory, "upload.tar.gz");
    writeFileSync(secret, "private notes");
    symlinkSync(secret, source);
    await assert.rejects(copyUpload(source, join(directory, "protected.tar.gz"), 100), /ELOOP|symbolic link/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
