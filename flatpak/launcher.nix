{
  writeShellScript,
  python3,
  nativeLauncher,
}:
writeShellScript "pd2-trader-flatpak-launcher" ''
  set -eu
  if [ -n "''${PD2_TRADER_D2_DIR:-}" ]; then
    # Flatpak supplies app-private XDG paths. Never replace the whole profile.
    ${python3}/bin/python ${../modules/settings.py} \
      --config "''${XDG_CONFIG_HOME:-$HOME/.config}/com.pd2-trader.app/settings.json" \
      --diablo2-directory "$PD2_TRADER_D2_DIR"
  fi
  exec ${nativeLauncher} "$@"
''
