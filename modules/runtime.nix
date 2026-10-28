# Desktop-user runtime only. Never run settings/KDE mutations in a root service.
{
  lib,
  pkgs,
  cfg,
  configHome ? null,
}:
let
  bool = value: if value then "true" else "false";
  configHomeSetup =
    if configHome == null then
      ''
        configHome="''${XDG_CONFIG_HOME:-$HOME/.config}"
      ''
    else
      ''
        configHome=${lib.escapeShellArg configHome}
      '';
  launcher = pkgs.writeShellScript "pd2-trader-configured-launcher" ''
    set -eu
    ${configHomeSetup}
    export XDG_CONFIG_HOME="$configHome"
    ${pkgs.python3}/bin/python ${./settings.py} \
      --config "$configHome/com.pd2-trader.app/settings.json" \
      --diablo2-directory ${lib.escapeShellArg cfg.diablo2Directory}
    exec ${cfg.package}/bin/pd2-trader "$@"
  '';
in
{
  package =
    if cfg.diablo2Directory == null then
      cfg.package
    else
      pkgs.symlinkJoin {
        name = "pd2-trader-configured";
        paths = [ cfg.package ];
        postBuild = ''
          rm "$out/bin/pd2-trader"
          ln -s ${launcher} "$out/bin/pd2-trader"
        '';
        meta = cfg.package.meta or { };
        passthru.unconfiguredPackage = cfg.package;
      };
  applyRules = pkgs.writeShellScript "pd2-trader-kde-rules" ''
    set -eu
    ${configHomeSetup}
    ${pkgs.python3}/bin/python ${./kde-rules.py} \
      --config "$configHome/kwinrulesrc" \
      --kread ${pkgs.kdePackages.kconfig}/bin/kreadconfig6 \
      --kwrite ${pkgs.kdePackages.kconfig}/bin/kwriteconfig6 \
      --windowed ${bool (cfg.enable && cfg.kde.PD2StartWindowed)} \
      --overlay ${bool (cfg.enable && cfg.kde.traderoverlay)} \
      --game-title ${lib.escapeShellArg (cfg.kde.gameWindowTitle or "Diablo II")} \
      --game-class ${lib.escapeShellArg (cfg.kde.gameWindowClass or "steam_app_default")} \
      --trader-title ${lib.escapeShellArg (cfg.kde.traderWindowTitle or "PD2Trader")}
    if [ -n "''${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
      ${pkgs.kdePackages.qttools}/bin/qdbus org.kde.KWin /KWin reconfigure || \
        printf '%s\n' 'KWin unavailable; PD2 rules will take effect in the next Plasma session.' >&2
    fi
  '';
}
