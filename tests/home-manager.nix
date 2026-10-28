{
  pkgs,
  home-manager,
  module,
  package,
}:
let
  evaluate =
    settings:
    (home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        module
        {
          home.username = "pd2-test";
          home.homeDirectory = "/home/pd2-test";
          home.stateVersion = "26.05";
          programs.pd2-trader = settings;
        }
      ];
    }).config;
  disabled = evaluate { };
  enabled = evaluate {
    enable = true;
    diablo2Directory = null;
    autoUpdateEnabled = null;
    kde.PD2StartWindowed = true;
    kde.traderoverlay = true;
  };
  manual = evaluate {
    enable = true;
    autostart = false;
    autoUpdateEnabled = true;
  };
  configured = evaluate {
    enable = true;
    diablo2Directory = "/home/pd2-test/Program Files (x86)/Diablo II";
  };
  relative =
    builtins.tryEval
      (evaluate {
        enable = true;
        diablo2Directory = "relative/Diablo II";
      }).programs.pd2-trader.diablo2Directory;
  unit = enabled.systemd.user.services.pd2-trader;
  defaults = evaluate { enable = true; };
  alias = evaluate {
    enable = true;
    d2dir = "~/Custom D2";
  };
  custom = evaluate {
    enable = true;
    kde.gameWindowTitle = "Custom Diablo II";
    kde.gameWindowClass = "custom-wine-class";
    kde.traderWindowTitle = "Custom Trader";
  };
  rulesScript = builtins.head custom.systemd.user.services.pd2-trader-kde-rules.Service.ExecStart;
in
assert defaults.programs.pd2-trader.autoUpdateEnabled == false;
assert manual.programs.pd2-trader.autoUpdateEnabled;
assert enabled.programs.pd2-trader.autoUpdateEnabled == null;
assert !defaults.programs.pd2-trader.kde.PD2StartWindowed;
assert !defaults.programs.pd2-trader.kde.traderoverlay;
assert enabled.programs.pd2-trader.kde.PD2StartWindowed;
assert enabled.programs.pd2-trader.kde.traderoverlay;
assert
  defaults.programs.pd2-trader.diablo2Directory
  == "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
assert alias.programs.pd2-trader.diablo2Directory == "~/Custom D2";
assert
  configured.programs.pd2-trader.diablo2Directory == "/home/pd2-test/Program Files (x86)/Diablo II";
assert !relative.success;
assert !(builtins.elem package configured.home.packages);
assert builtins.any (p: (p.unconfiguredPackage or null) == package) configured.home.packages;
assert configured.systemd.user.services.pd2-trader.Service.ExecStart != unit.Service.ExecStart;
assert !(disabled.systemd.user.services ? pd2-trader);
assert !(manual.systemd.user.services ? pd2-trader);
assert builtins.elem package enabled.home.packages;
assert unit.Install.WantedBy == [ "graphical-session.target" ];
assert unit.Unit.PartOf == [ "graphical-session.target" ];
assert unit.Unit.Requires == [ "pd2-trader-kde-rules.service" ];
assert
  unit.Unit.After == [
    "graphical-session.target"
    "pd2-trader-kde-rules.service"
  ];
assert unit.Service.ExecStart == [ "${package}/bin/pd2-trader" ];
assert unit.Service.Restart == "on-failure";
assert enabled.systemd.user.services.pd2-trader-kde-rules.Service.Type == "oneshot";
assert enabled.home.activation ? pd2TraderKdeRules;
pkgs.runCommand "pd2-trader-home-manager-contract" { } ''
  # Build the actual Home Manager-rendered units without activating anything.
  test -f ${enabled.xdg.configFile."systemd/user/pd2-trader.service".source}
  test -f ${enabled.xdg.configFile."systemd/user/pd2-trader-kde-rules.service".source}
  test -f ${configured.xdg.configFile."systemd/user/pd2-trader.service".source}
  grep -F -- "--game-title 'Custom Diablo II'" ${rulesScript}
  grep -F -- '--game-class custom-wine-class' ${rulesScript}
  grep -F -- "--trader-title 'Custom Trader'" ${rulesScript}
  touch "$out"
''
