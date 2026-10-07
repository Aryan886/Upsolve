import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyUpload } from "./deploy-release.mjs";

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
