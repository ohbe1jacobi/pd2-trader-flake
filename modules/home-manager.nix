{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pd2-trader;
  runtime = import ./runtime.nix {
    inherit lib pkgs cfg;
    configHome = config.xdg.configHome;
  };
in
{
  imports = [
    (lib.mkAliasOptionModule
      [ "programs" "pd2-trader" "d2dir" ]
      [ "programs" "pd2-trader" "diablo2Directory" ]
    )
  ];
  options.programs.pd2-trader = import ./options.nix { inherit lib pkgs; };
  config = lib.mkMerge [
    {
      # Also runs when enable becomes false, to retire our existing owned rules.
      # Settings JSON is only merged by the launcher, never during activation.
      home.activation.pd2TraderKdeRules = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        run ${runtime.applyRules}
      '';
    }
    (lib.mkIf cfg.enable {
      home.packages = [ runtime.package ];
      systemd.user.services.pd2-trader-kde-rules = {
        Unit = {
          Description = "Apply PD2 Trader KDE window-rule workarounds";
          PartOf = [ "graphical-session.target" ];
          After = [ "graphical-session.target" ];
        };
        Service = {
          Type = "oneshot";
          ExecStart = "${runtime.applyRules}";
          RemainAfterExit = true;
        };
        Install.WantedBy = [ "graphical-session.target" ];
      };
    })
    (lib.mkIf (cfg.enable && cfg.autostart) {
      systemd.user.services.pd2-trader = {
        Unit = {
          Description = "PD2 Trader";
          PartOf = [ "graphical-session.target" ];
          After = [
            "graphical-session.target"
            "pd2-trader-kde-rules.service"
          ];
          Requires = [ "pd2-trader-kde-rules.service" ];
        };
        Service = {
          ExecStart = "${runtime.package}/bin/pd2-trader";
          Restart = "on-failure";
          RestartSec = 5;
        };
        Install.WantedBy = [ "graphical-session.target" ];
      };
    })
  ];
}
