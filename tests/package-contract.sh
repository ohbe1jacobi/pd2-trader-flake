#!/usr/bin/env bash
set -euo pipefail
package=${1:?usage: package-contract.sh PACKAGE_PATH}
fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}
[[ -x "$package/bin/pd2-trader" ]] || fail 'pd2-trader executable is missing'
desktop="$package/share/applications/pd2-trader.desktop"
[[ -f $desktop ]] || fail 'desktop entry is missing'
grep -qx 'Exec=pd2-trader' "$desktop" || fail 'desktop entry bypasses the fixed launcher'
grep -qx 'Icon=pd2-trader-installer' "$desktop" || fail 'desktop icon name is wrong'
[[ -f "$package/share/icons/hicolor/32x32/apps/pd2-trader-installer.png" ]] || fail 'desktop icon is missing'
printf 'PASS: executable, desktop launcher, and icon\n'
