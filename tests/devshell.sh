#!/usr/bin/env bash
# Exercise the developer tools using only temporary state, never a live profile.
set -euo pipefail
tests=${1:-tests}
modules=${2:-modules}
for tool in python python3 ruff node npm nix nixfmt nixd statix deadnix shellcheck shfmt git jq \
	pre-commit cz git-flow actionlint \
	pkg-config cc cargo rustc rustfmt cargo-clippy rust-analyzer \
	kreadconfig6 kwriteconfig6 qdbus gst-inspect-1.0 Xvfb xwininfo \
	dbus-run-session readelf patchelf desktop-file-validate; do
	command -v "$tool" >/dev/null || {
		printf 'Missing development tool: %s\n' "$tool" >&2
		exit 1
	}
done

cz version >/dev/null
git flow version >/dev/null

python "$tests/settings.py" "$modules/settings.py"
python "$tests/source-contract.py" "$tests/source-contract.sh"
python "$tests/kde-rules.py" "$modules/kde-rules.py" \
	"$(command -v kreadconfig6)" "$(command -v kwriteconfig6)"
node --check "$tests/headless-smoke.mjs"
ruff check --no-cache --select E9,F63,F7,F82 "$modules" "$tests"
pkg-config --exists gtk+-3.0 webkit2gtk-4.1 openssl x11 xtst xi xrandr xext xkbcommon ayatana-appindicator3-0.1

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cc "$tests/tray-dlopen.c" -ldl \
	-Wl,-rpath,"$(pkg-config --variable=libdir ayatana-appindicator3-0.1)" -o "$scratch/tray-probe"
"$scratch/tray-probe"
printf 'fn main() { println!("Rust compiler works"); }\n' >"$scratch/probe.rs"
rustc "$scratch/probe.rs" -o "$scratch/rust-probe"
"$scratch/rust-probe"
GST_REGISTRY_1_0="$scratch/gstreamer-registry.bin" gst-inspect-1.0 appsink >/dev/null
GST_REGISTRY_1_0="$scratch/gstreamer-registry.bin" gst-inspect-1.0 autoaudiosink >/dev/null
printf 'PASS: dev shell Python/KDE tests, JS syntax, native dependencies, C/tray, Rust, and GStreamer\n'
