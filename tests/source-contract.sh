#!/usr/bin/env bash
set -euo pipefail
package=${1:?package output required}
binary="$package/bin/.pd2-trader-wrapped"
[[ -f $binary ]] || {
	echo 'FAIL: no native wrapped executable'
	exit 1
}
readelf -h "$binary" | grep -q 'ELF64'
if grep -Eq 'LD_PRELOAD|LD_LIBRARY_PATH|APPIMAGE|APPDIR|host-xdg-open|/usr/lib' "$package/bin/pd2-trader"; then
	echo 'FAIL: launcher contains private library or AppImage overrides' >&2
	exit 1
fi
grep -q 'GDK_BACKEND.*x11' "$package/bin/pd2-trader"
ldd "$binary" >dependencies.txt
if grep -q 'not found' dependencies.txt; then
	echo 'FAIL: native executable has unresolved dependencies' >&2
	exit 1
fi
grep -q '/nix/store/.*libwebkit2gtk-4.1' dependencies.txt
grep -q '/nix/store/.*libgtk-3' dependencies.txt
[[ ! -d "$package/lib" ]] # no private copied runtime libraries
echo 'PASS: native ELF, Nix GTK/WebKit, no AppImage environment or preload'
