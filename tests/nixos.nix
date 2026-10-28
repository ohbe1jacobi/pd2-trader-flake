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
          users.users.other.isNormalUser = true;
          users.users.retired.isNormalUser = true;
          programs.pd2-trader = settings;
        }
      ];
    }).config;
  disabled = evaluate { users.alice = { }; };
  enabled = evaluate {
    enable = true;
    inherit package;
    users = {
      alice = {
        diablo2Directory = "/home/alice/Games/Diablo II";
        kde.PD2StartWindowed = true;
        kde.traderoverlay = true;
      };
      other = {
        autostart = false;
        diablo2Directory = null;
      };
      retired.enable = false;
    };
  };
  manual = evaluate {
    enable = true;
    inherit package;
    users.alice.autostart = false;
  };
  bothAuto = evaluate {
    enable = true;
    users = {
      alice = { };
      other = { };
    };
  };
  empty = evaluate { enable = true; };
  alias = evaluate {
    enable = true;
    users.alice.d2dir = "~/Alternate D2";
  };
  cleanup = evaluate {
    enable = true;
    users.alice.enable = false;
  };
  unknown = evaluate {
    enable = true;
    users.missing = { };
  };
  rootUser = evaluate {
    enable = true;
    users.root = { };
  };
  relative = evaluate {
    enable = true;
    users.alice.diablo2Directory = "relative/path";
  };
  nixPath = evaluate {
    enable = true;
    users.alice.diablo2Directory = ../.;
  };
  configured = import ../modules/runtime.nix {
    inherit lib pkgs;
    cfg = enabled.programs.pd2-trader.users.alice;
  };
  retiredRuntime = import ../modules/runtime.nix {
    inherit lib pkgs;
    cfg = enabled.programs.pd2-trader.users.retired;
  };
  unit = enabled.systemd.user.services.pd2-trader;
  rules = enabled.systemd.user.services.pd2-trader-kde-rules;
  assertionsPass = c: builtins.all (a: a.assertion) c.assertions;
  rendered = name: enabled.systemd.user.units.${name}.unit;
in
assert assertionsPass disabled;
assert assertionsPass enabled;
assert assertionsPass manual;
assert assertionsPass empty;
assert assertionsPass cleanup;
assert assertionsPass bothAuto;
assert !bothAuto.programs.pd2-trader.users.alice.kde.PD2StartWindowed;
assert !bothAuto.programs.pd2-trader.users.alice.kde.traderoverlay;
assert enabled.programs.pd2-trader.users.alice.kde.PD2StartWindowed;
assert enabled.programs.pd2-trader.users.alice.kde.traderoverlay;
assert
  bothAuto.programs.pd2-trader.users.alice.diablo2Directory
  == "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
assert alias.programs.pd2-trader.users.alice.diablo2Directory == "~/Alternate D2";
assert
  bothAuto.systemd.user.services.pd2-trader.unitConfig.ConditionUser == [
    "|alice"
    "|other"
  ];
assert disabled.programs.pd2-trader.package == package;
assert !(empty.systemd.user.services ? pd2-trader);
assert !(empty.systemd.user.services ? pd2-trader-kde-rules);
assert !(cleanup.systemd.user.services ? pd2-trader);
assert cleanup.systemd.user.services.pd2-trader-kde-rules.unitConfig.ConditionUser == [ "|alice" ];
assert cleanup.users.users.alice.packages == [ ];
assert !(assertionsPass unknown);
assert !(assertionsPass rootUser);
assert !(builtins.tryEval relative.programs.pd2-trader.users.alice.diablo2Directory).success;
assert !(builtins.tryEval nixPath.programs.pd2-trader.users.alice.diablo2Directory).success;
assert !(disabled.systemd.user.services ? pd2-trader);
assert !(disabled.systemd.user.services ? pd2-trader-kde-rules);
assert disabled.users.users.alice.packages == [ ];
assert !(enabled.systemd.services ? pd2-trader);
assert !(enabled.systemd.services ? pd2-trader-kde-rules);
assert !(manual.systemd.user.services ? pd2-trader);
assert manual.systemd.user.services ? pd2-trader-kde-rules;
assert enabled.programs.pd2-trader.users.alice.enable;
assert enabled.programs.pd2-trader.users.other.package == package;
assert builtins.elem configured.package enabled.users.users.alice.packages;
assert builtins.elem package enabled.users.users.other.packages;
assert enabled.users.users.retired.packages == [ ];
assert !(builtins.elem package enabled.environment.systemPackages);
assert unit.wantedBy == [ "graphical-session.target" ];
assert unit.partOf == [ "graphical-session.target" ];
assert unit.requires == [ "pd2-trader-kde-rules.service" ];
assert
  unit.after == [
    "graphical-session.target"
    "pd2-trader-kde-rules.service"
  ];
assert unit.unitConfig.ConditionUser == [ "|alice" ];
assert
  rules.unitConfig.ConditionUser == [
    "|alice"
    "|other"
    "|retired"
  ];
assert rules.after == [ "graphical-session.target" ];
assert rules.partOf == [ "graphical-session.target" ];
assert rules.wantedBy == [ "graphical-session.target" ];
assert rules.serviceConfig.Type == "oneshot";
assert unit.serviceConfig.Restart == "on-failure";
# Graphical apps must inherit desktop helpers, not a tools-only NixOS service PATH.
assert !(unit.environment ? PATH);
assert !(rules.environment ? PATH);
pkgs.runCommand "pd2-trader-nixos-contract" { } ''
  # Build actual NixOS-rendered user units, never a system closure or VM.
  test -f ${rendered "pd2-trader.service"}/pd2-trader.service
  test -f ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service
  grep -F 'ConditionUser=|alice' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -F 'ConditionUser=|retired' ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service
  grep -Fx 'After=graphical-session.target pd2-trader-kde-rules.service' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'Requires=pd2-trader-kde-rules.service' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'PartOf=graphical-session.target' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx 'WantedBy=graphical-session.target' ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx ${lib.escapeShellArg "ExecStart=${unit.serviceConfig.ExecStart}"} ${rendered "pd2-trader.service"}/pd2-trader.service
  grep -Fx ${lib.escapeShellArg "ExecStart=${rules.serviceConfig.ExecStart}"} ${rendered "pd2-trader-kde-rules.service"}/pd2-trader-kde-rules.service
  test -x ${unit.serviceConfig.ExecStart}
  test -x ${rules.serviceConfig.ExecStart}
  test -x ${configured.package}/bin/pd2-trader
  test -x ${configured.applyRules}
  test -x ${retiredRuntime.applyRules}
  grep -F ${lib.escapeShellArg "${configured.package}/bin/pd2-trader"} ${unit.serviceConfig.ExecStart}
  grep -F ${lib.escapeShellArg "/home/alice/Games/Diablo II"} ${configured.package}/bin/pd2-trader
  grep -F ${lib.escapeShellArg "${configured.applyRules}"} ${rules.serviceConfig.ExecStart}
  grep -F ${lib.escapeShellArg "${retiredRuntime.applyRules}"} ${rules.serviceConfig.ExecStart}
  grep -F -- '--windowed true' ${configured.applyRules}
  grep -F -- '--overlay true' ${configured.applyRules}
  grep -F -- '--windowed false' ${retiredRuntime.applyRules}
  grep -F -- '--overlay false' ${retiredRuntime.applyRules}
  touch "$out"
''
