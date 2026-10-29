{
  pkgs,
  nixpkgs,
  module,
  package,
}:
let
  lib = nixpkgs.lib;
  evaluate =
    settings:
    (nixpkgs.lib.nixosSystem {
      system = pkgs.stdenv.hostPlatform.system;
      modules = [
        module
        {
          boot.isContainer = true;
          system.stateVersion = "26.05";
          users.users.alice.isNormalUser = true;
          programs.pd2-trader = settings;
        }
      ];
    }).config;
  disabled = evaluate { };
  enabled = evaluate {
    enable = true;
    inherit package;
    diablo2Directory = "/home/alice/Games/Diablo II";
    kde.PD2StartWindowed = true;
    kde.traderoverlay = true;
  };
  manual = evaluate {
    enable = true;
    inherit package;
    autostart = false;
    autoUpdateEnabled = true;
  };
  defaults = evaluate { enable = true; };
  alias = evaluate {
    enable = true;
    d2dir = "~/Alternate D2";
  };
  removed = evaluate {
    enable = true;
    users.alice = { };
  };
  relative = evaluate {
    enable = true;
    diablo2Directory = "relative/path";
  };
  nixPath = evaluate {
    enable = true;
    diablo2Directory = ../.;
  };
  configured = import ../modules/runtime.nix {
    inherit lib pkgs;
    cfg = enabled.programs.pd2-trader;
  };
  unit = enabled.systemd.user.services.pd2-trader;
  rules = enabled.systemd.user.services.pd2-trader-kde-rules;
  assertionsPass = c: builtins.all (a: a.assertion) c.assertions;
  rendered = name: enabled.systemd.user.units.${name}.unit;
in
assert assertionsPass disabled;
assert assertionsPass enabled;
assert assertionsPass manual;
assert assertionsPass defaults;
# The per-user interface was removed in favor of system-wide settings.
assert !(assertionsPass removed);
assert defaults.programs.pd2-trader.autoUpdateEnabled == false;
assert manual.programs.pd2-trader.autoUpdateEnabled;
assert !defaults.programs.pd2-trader.kde.PD2StartWindowed;
assert !defaults.programs.pd2-trader.kde.traderoverlay;
assert
  defaults.programs.pd2-trader.diablo2Directory
  == "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
assert alias.programs.pd2-trader.diablo2Directory == "~/Alternate D2";
assert !(builtins.tryEval relative.programs.pd2-trader.diablo2Directory).success;
assert !(builtins.tryEval nixPath.programs.pd2-trader.diablo2Directory).success;
assert !(disabled.systemd.user.services ? pd2-trader);
assert !(disabled.systemd.user.services ? pd2-trader-kde-rules);
assert !(builtins.elem disabled.programs.pd2-trader.package disabled.environment.systemPackages);
assert !(enabled.systemd.services ? pd2-trader);
assert !(enabled.systemd.services ? pd2-trader-kde-rules);
assert !(manual.systemd.user.services ? pd2-trader);
assert manual.systemd.user.services ? pd2-trader-kde-rules;
assert builtins.elem configured.package enabled.environment.systemPackages;
# Users are no longer selected individually.
assert enabled.users.users.alice.packages == [ ];
assert !(unit.unitConfig ? ConditionUser);
assert !(rules.unitConfig ? ConditionUser);
assert unit.wantedBy == [ "graphical-session.target" ];
assert unit.partOf == [ "graphical-session.target" ];
assert unit.requires == [ "pd2-trader-kde-rules.service" ];
assert
  unit.after == [
    "graphical-session.target"
    "pd2-trader-kde-rules.service"
  ];
assert rules.after == [ "graphical-session.target" ];
assert rules.partOf == [ "graphical-session.target" ];
assert rules.wantedBy == [ "graphical-session.target" ];
assert rules.serviceConfig.Type == "oneshot";
assert unit.serviceConfig.Restart == "on-failure";
assert unit.serviceConfig.ExecStart == "${configured.package}/bin/pd2-trader";
assert rules.serviceConfig.ExecStart == "${configured.applyRules}";
# Graphical apps must inherit desktop helpers, not a tools-only NixOS service PATH.
assert !(unit.environment ? PATH);
assert !(rules.environment ? PATH);
pkgs.runCommand "pd2-trader-nixos-contract" { } ''
  # Build actual NixOS-rendered user units, never a system closure or VM.
  test -f ${rendered "pd2-trader.service"}/pd2-trader.service
  test -f ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service
  if grep -F 'ConditionUser=' ${rendered "pd2-trader.service"}/pd2-trader.service; then exit 1; fi
  if grep -F 'ConditionUser=' ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service; then exit 1; fi
  grep -Fx 'After=graphical-session.target pd2-trader-kde-rules.service' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'Requires=pd2-trader-kde-rules.service' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'PartOf=graphical-session.target' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'WantedBy=graphical-session.target' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx ${lib.escapeShellArg "ExecStart=${unit.serviceConfig.ExecStart}"} ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx ${lib.escapeShellArg "ExecStart=${rules.serviceConfig.ExecStart}"} ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service
  test -x ${configured.package}/bin/pd2-trader
  test -x ${configured.applyRules}
  grep -F ${lib.escapeShellArg "/home/alice/Games/Diablo II"} ${configured.package}/bin/pd2-trader
  grep -F -- '--windowed true' ${configured.applyRules}
  grep -F -- '--overlay true' ${configured.applyRules}
  touch "$out"
''
