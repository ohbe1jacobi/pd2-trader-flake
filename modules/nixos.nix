{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pd2-trader;
  # configHome stays null: settings and KWin rules resolve against the
  # logged-in user's environment at runtime, never during activation.
  runtime = import ./runtime.nix { inherit lib pkgs cfg; };
in
{
  imports = [
    (lib.mkAliasOptionModule
      [ "programs" "pd2-trader" "d2dir" ]
      [ "programs" "pd2-trader" "diablo2Directory" ]
    )
    (lib.mkRemovedOptionModule [ "programs" "pd2-trader" "users" ] ''
      The NixOS module now installs PD2 Trader system-wide; move per-user
      settings up to programs.pd2-trader.*. For a single user or per-user
      settings, use the Home Manager module (homeManagerModules.default).
    '')
  ];
  options.programs.pd2-trader = import ./options.nix { inherit lib pkgs; };
  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        environment.systemPackages = [ runtime.package ];
        systemd.user.services.pd2-trader-kde-rules = {
          description = "Apply PD2 Trader KDE window-rule workarounds";
          wantedBy = [ "graphical-session.target" ];
          partOf = [ "graphical-session.target" ];
          after = [ "graphical-session.target" ];
          # All our commands use store paths; preserve the graphical session's
          # PATH so browser/desktop handoff retains the user's KDE helpers.
          enableDefaultPath = false;
          serviceConfig = {
            Type = "oneshot";
            ExecStart = "${runtime.applyRules}";
            RemainAfterExit = true;
          };
        };
      }
      (lib.mkIf cfg.autostart {
        systemd.user.services.pd2-trader = {
          description = "PD2 Trader";
          wantedBy = [ "graphical-session.target" ];
          partOf = [ "graphical-session.target" ];
          after = [
            "graphical-session.target"
            "pd2-trader-kde-rules.service"
          ];
          requires = [ "pd2-trader-kde-rules.service" ];
          # All our commands use store paths; preserve the graphical session's
          # PATH so browser/desktop handoff retains the user's KDE helpers.
          enableDefaultPath = false;
          serviceConfig = {
            ExecStart = "${runtime.package}/bin/pd2-trader";
            Restart = "on-failure";
            RestartSec = 5;
          };
        };
      })
    ]
  );
}
