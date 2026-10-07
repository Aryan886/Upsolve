#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

release_commit=${RELEASE_COMMIT:-$(git rev-parse HEAD)}
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "RELEASE_COMMIT must be a full Git SHA" >&2; exit 1; }
test "$(git rev-parse HEAD)" = "$release_commit"
if [[ ${CP_NOTES_ALLOW_DIRTY_BUILD:-false} != true && -n $(git status --porcelain) ]]; then
  echo "Release builds require a clean checkout of the tested commit" >&2
  exit 1
fi
test "$(node --version)" = "v$(tr -d '\r\n' < .nvmrc)"
test "$(npm --version)" = "10.9.9"

if [[ ${CP_NOTES_ALLOW_NON_AMAZON_LINUX:-false} != true ]]; then
  source /etc/os-release
  [[ ${ID:-} == amzn && ${VERSION_ID:-} == 2023 ]] || { echo "Release must be built on Amazon Linux 2023" >&2; exit 1; }
fi

for setting in VITE_BACKEND_URL VITE_FEEDBACK_URL VITE_EXTENSION_ID VITE_EXTENSION_INSTALL_URL; do
  [[ -n ${!setting:-} ]] || { echo "Missing $setting" >&2; exit 1; }
done
[[ ${VITE_BACKEND_URL} == https://*/api ]]
[[ ${VITE_FEEDBACK_URL} == https://* ]]
[[ ${VITE_EXTENSION_ID} =~ ^[a-p]{32}$ ]]
[[ ${VITE_EXTENSION_INSTALL_URL} == https://* ]]

npm ci
env -u VITE_BACKEND_URL -u VITE_FEEDBACK_URL -u VITE_EXTENSION_ID \
  -u VITE_EXTENSION_KEY -u VITE_EXTENSION_INSTALL_URL -u VITE_API_BASE_URL npm run check
node --test deploy/check-release.test.mjs deploy/deploy-release.test.mjs
python3 deploy/test_deployment.py
npm run build:release
npm prune --omit=dev

expected_origin=${VITE_BACKEND_URL%/api}
EXPECTED_EXTENSION_ORIGIN="$expected_origin" node deploy/verify-release.mjs

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync("website/dist/googleae6bb7febf88fddb.html", "utf8");
assert.equal(html.trim(), "google-site-verification: googleae6bb7febf88fddb.html");
const manifest = JSON.parse(readFileSync("extension/dist/manifest.json", "utf8"));
assert.deepEqual(manifest.host_permissions, [`${process.env.VITE_BACKEND_URL.slice(0, -4)}/*`]);
NODE

release_directory=${RELEASE_OUTPUT_DIRECTORY:-release-artifacts}
mkdir -p "$release_directory"
release_directory=$(realpath "$release_directory")
release_name="${release_commit}-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
archive="$release_directory/${release_name}.tar.gz"
manifest="$release_directory/release-manifest.json"

RELEASE_COMMIT="$release_commit" RELEASE_NAME="$release_name" RELEASE_MANIFEST_PATH="$manifest" node --input-type=module <<'NODE'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { NotesDatabase } from "./backend/dist/database.js";

const directory = mkdtempSync(join(tmpdir(), "cp-notes-schema-"));
try {
  const path = join(directory, "schema.db");
  const database = new NotesDatabase(path);
  database.close();
  const require = createRequire(new URL("./backend/package.json", import.meta.url));
  const Sqlite = require("better-sqlite3");
  const stored = new Sqlite(path, { readonly: true, fileMustExist: true });
  const schema = stored.pragma("user_version", { simple: true });
  stored.close();
  const release = {
    commit: process.env.RELEASE_COMMIT,
    name: process.env.RELEASE_NAME,
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    node: process.version,
    architecture: process.arch,
    os: "amazonlinux-2023",
    schema,
    websiteOrigin: process.env.VITE_BACKEND_URL.slice(0, -4),
  };
  writeFileSync(process.env.RELEASE_MANIFEST_PATH, `${JSON.stringify(release, null, 2)}\n`);
  writeFileSync("website/dist/release.json", `${JSON.stringify({ commit: release.commit, runId: release.runId, runAttempt: release.runAttempt })}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
NODE

cp "$manifest" release-manifest.json
printf '%s\n' "$release_commit" > SOURCE_COMMIT
files=(package.json package-lock.json SOURCE_COMMIT release-manifest.json node_modules)
for workspace in shared backend website extension; do
  files+=("$workspace/package.json" "$workspace/dist")
  if [[ -d "$workspace/node_modules" ]]; then files+=("$workspace/node_modules"); fi
done
tar --create --gzip --file "$archive" -- "${files[@]}"
(cd "$release_directory" && sha256sum "$(basename "$archive")") > "$archive.sha256"
rm -f SOURCE_COMMIT release-manifest.json "$manifest"
printf 'Release archive: %s\n' "$archive"
