#!/usr/bin/env bash
# Exercise packaging on disposable Linux data without touching the working checkout.
set -euo pipefail

source_directory=$(realpath "$(dirname "$0")/..")
verification_directory=$(mktemp -d /tmp/cp-notes-package.XXXXXX)
trap 'echo "Packaging verification files: $verification_directory"' EXIT
mkdir -p "$verification_directory/source" "$verification_directory/runtime"

tar -C "$source_directory" --exclude=node_modules --exclude=dist --exclude=release-artifacts \
  --exclude=backend/data --exclude=.env --exclude=.env.local --exclude=__pycache__ \
  --exclude='*.db*' -cf - . | tar -C "$verification_directory/source" -xf -

cd "$verification_directory/runtime"
node_version=$(tr -d '\r\n' < "$source_directory/.nvmrc")
archive="node-v${node_version}-linux-x64.tar.xz"
curl --fail --silent --show-error --location --retry 2 --output "$archive" "https://nodejs.org/dist/v${node_version}/${archive}"
curl --fail --silent --show-error --location --retry 2 --output SHASUMS256.txt "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
awk -v archive="$archive" '$2 == archive { print }' SHASUMS256.txt > checksum.txt
test -s checksum.txt
sha256sum --check checksum.txt
tar -xf "$archive"
export PATH="$verification_directory/runtime/node-v${node_version}-linux-x64/bin:$PATH"

cd "$verification_directory/source"
export CP_NOTES_ALLOW_NON_AMAZON_LINUX=true
export CP_NOTES_ALLOW_DIRTY_BUILD=true
export VITE_BACKEND_URL=https://notes.example.test/api
export VITE_FEEDBACK_URL=https://feedback.example.test/form
export VITE_EXTENSION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export VITE_EXTENSION_INSTALL_URL=https://chromewebstore.google.com/detail/cp-notes/gdfdnapanhndofblljbgfppndhdlioko

if ! bash deploy/build-release.sh > "$verification_directory/build.log" 2>&1; then
  tail -n 80 "$verification_directory/build.log"
  exit 1
fi
tail -n 8 "$verification_directory/build.log"

release_archive=$(find release-artifacts -maxdepth 1 -name '*.tar.gz' -print -quit)
test -n "$release_archive"
python3 deploy/extract-release.py "$release_archive" "$verification_directory/extracted"
mkdir -p "$verification_directory/extracted/deploy"
cp deploy/verify-release.mjs "$verification_directory/extracted/deploy/verify-release.mjs"
cp deploy/check-release.mjs deploy/check-release.test.mjs deploy/deploy-release.mjs deploy/deploy-release.test.mjs "$verification_directory/extracted/deploy/"
cd "$verification_directory/extracted"
node deploy/verify-release.mjs
node --test deploy/check-release.test.mjs deploy/deploy-release.test.mjs
echo "Release archive extracted and passed compiled checks."
