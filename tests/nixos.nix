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
  legacyValues = {
    autoUpdateEnabled = true;
    telemetryOptOut = false;
    diablo2Directory = "~/Legacy D2";
  };
  legacy = evaluate (legacyValues // { enable = true; });
  legacyCanonical = evaluate {
    enable = true;
    settings = legacyValues;
  };
  legacyNull = evaluate {
    autoUpdateEnabled = null;
    telemetryOptOut = null;
    diablo2Directory = null;
  };
  traderWarnings = c: builtins.filter (lib.hasInfix "programs.pd2-trader.") c.warnings;
  enabled = evaluate {
    enable = true;
    inherit package;
    settings = {
      diablo2Directory = "/home/alice/Games/Diablo II";
      telemetryOptOut = true;
    };
    kde.PD2StartWindowed = true;
    kde.traderoverlay = true;
  };
  manual = evaluate {
    enable = true;
    inherit package;
    autostart = false;
    settings = {
      autoUpdateEnabled = true;
      telemetryOptOut = false;
    };
  };
  defaults = evaluate { enable = true; };
  alias = evaluate {
    enable = true;
    d2dir = "~/Alternate D2";
  };
  aliasNull = evaluate { d2dir = null; };
  aliasRelative =
    builtins.tryEval
      (evaluate { d2dir = "relative/path"; }).programs.pd2-trader.settings.diablo2Directory;
  removed = evaluate {
    enable = true;
    users.alice = { };
  };
  relative = evaluate {
    enable = true;
    settings.diablo2Directory = "relative/path";
  };
  nixPath = evaluate {
    enable = true;
    settings.diablo2Directory = ../.;
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
assert legacy.programs.pd2-trader.settings == legacyValues;
assert builtins.all (value: value == null) (
  builtins.attrValues legacyNull.programs.pd2-trader.settings
);
assert builtins.length (traderWarnings legacy) == 3;
assert builtins.length (traderWarnings legacyNull) == 3;
assert builtins.all (
  name:
  builtins.any (
    warning:
    lib.hasInfix "programs.pd2-trader.${name}" warning
    && lib.hasInfix "has been renamed" warning
    && lib.hasInfix "programs.pd2-trader.settings.${name}" warning
  ) (traderWarnings legacy)
) (builtins.attrNames legacyValues);
assert builtins.all (c: traderWarnings c == [ ]) [
  defaults
  enabled
  alias
  aliasNull
  legacyCanonical
];
assert
  legacy.systemd.user.services.pd2-trader.serviceConfig.ExecStart
  == legacyCanonical.systemd.user.services.pd2-trader.serviceConfig.ExecStart;
assert defaults.programs.pd2-trader.settings.telemetryOptOut == null;
assert enabled.programs.pd2-trader.settings.telemetryOptOut;
assert !manual.programs.pd2-trader.settings.telemetryOptOut;
assert assertionsPass enabled;
assert assertionsPass manual;
assert assertionsPass defaults;
# The per-user interface was removed in favor of system-wide settings.
assert !(assertionsPass removed);
assert defaults.programs.pd2-trader.settings.autoUpdateEnabled == null;
assert manual.programs.pd2-trader.settings.autoUpdateEnabled;
assert !defaults.programs.pd2-trader.kde.PD2StartWindowed;
assert !defaults.programs.pd2-trader.kde.traderoverlay;
assert
  defaults.programs.pd2-trader.settings.diablo2Directory
  == "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
assert alias.programs.pd2-trader.settings.diablo2Directory == "~/Alternate D2";
assert alias.programs.pd2-trader.d2dir == alias.programs.pd2-trader.settings.diablo2Directory;
assert aliasNull.programs.pd2-trader.settings.diablo2Directory == null;
assert !aliasRelative.success;
assert !(builtins.tryEval relative.programs.pd2-trader.settings.diablo2Directory).success;
assert !(builtins.tryEval nixPath.programs.pd2-trader.settings.diablo2Directory).success;
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
  grep -F -- '--telemetry-opt-out true' ${configured.package}/bin/pd2-trader
  grep -F -- '--windowed true' ${configured.applyRules}
  grep -F -- '--overlay true' ${configured.applyRules}
  touch "$out"
''
