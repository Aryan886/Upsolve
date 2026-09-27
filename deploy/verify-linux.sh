#!/usr/bin/env bash
# Run in Ubuntu: bash deploy/verify-linux.sh /path/to/repository
set -euo pipefail
source_directory=$(realpath "${1:-.}")
verification_directory=$(mktemp -d /tmp/cp-notes-linux.XXXXXX)
trap 'echo "Verification files retained at $verification_directory"' EXIT
mkdir -p "$verification_directory/source" "$verification_directory/runtime"
tar -C "$source_directory" --exclude=.git --exclude=.cache --exclude=node_modules --exclude=dist --exclude=release-artifacts --exclude=backend/data --exclude='.env' --exclude='.env.local' --exclude='*.db*' --exclude='*.tsbuildinfo' -cf - . | tar -C "$verification_directory/source" -xf -
cd "$verification_directory/runtime"
node_version=$(tr -d "\r\n" < "$source_directory/.nvmrc")
archive="node-v${node_version}-linux-x64.tar.xz"
curl --fail --location --retry 2 --connect-timeout 20 --max-time 180 --output "$archive" "https://nodejs.org/dist/v${node_version}/${archive}"
curl --fail --location --connect-timeout 20 --max-time 60 --output SHASUMS256.txt "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
awk -v archive="$archive" '$2 == archive { print }' SHASUMS256.txt > checksum.txt
test -s checksum.txt
sha256sum --check checksum.txt
tar -xf "$archive"
export PATH="$verification_directory/runtime/node-v${node_version}-linux-x64/bin:/usr/local/bin:/usr/bin:/bin"
cd "$verification_directory/source"
export npm_config_devdir="$verification_directory/node-gyp"
node --version
npm --version
npm ci --cache "$verification_directory/npm-cache"
npm run check
VITE_BACKEND_URL=https://notes.example.test/api VITE_FEEDBACK_URL=https://feedback.example.test/form VITE_EXTENSION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa npm run build:release
npm prune --omit=dev
node deploy/verify-release.mjs
node backend/dist/admin.js benchmark
