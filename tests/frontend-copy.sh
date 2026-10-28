#!/usr/bin/env bash
# Run the real package preBuild against stale local frontend output.
set -euo pipefail
hook=${1:?usage: frontend-copy.sh PREBUILD_SCRIPT FRONTEND}
frontend=${2:?frontend output}
state=$(mktemp -d)
trap 'chmod -R u+w "$state"; rm -rf "$state"' EXIT
mkdir "$state/dist"
printf 'STALE FRONTEND\n' >"$state/dist/index.html"
(
	cd "$state"
	bash "$hook"
)
cmp "$state/dist/index.html" "$frontend/index.html"
[[ ! -f "$state/dist/$(basename "$frontend")/index.html" ]]
echo 'PASS: stale dist replaced, current frontend embedded at the correct level'
