{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pd2-trader;
  names = builtins.attrNames cfg.users;
  autoNames = builtins.filter (name: cfg.users.${name}.enable && cfg.users.${name}.autostart) names;
  runtimes = lib.mapAttrs (
    _: user:
    import ./runtime.nix {
      inherit lib pkgs;
      cfg = user;
    }
  ) cfg.users;
  dispatch =
    name: selected: command:
    pkgs.writeShellScript name ''
      set -eu
      case "$(${pkgs.coreutils}/bin/id -un)" in
      ${lib.concatMapStringsSep "\n" (user: ''
        ${lib.escapeShellArg user}) exec ${command runtimes.${user}} ;;
      '') selected}
        *) exit 0 ;;
      esac
    '';
  launch = dispatch "pd2-trader-user-launch" autoNames (runtime: "${runtime.package}/bin/pd2-trader");
  applyRules = dispatch "pd2-trader-user-kde-rules" names (runtime: "${runtime.applyRules}");
  conditions = selected: map (name: "|${name}") selected;
in
{
  options.programs.pd2-trader = {
    enable = lib.mkEnableOption "standalone per-user PD2 Trader integration";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ../package.nix { }";
      description = "Default PD2 Trader package for selected users.";
    };
    users = lib.mkOption {
      default = { };
      type = lib.types.attrsOf (
        lib.types.submodule {
          imports = [ (lib.mkAliasOptionModule [ "d2dir" ] [ "diablo2Directory" ]) ];
          options = import ./options.nix {
            inherit lib pkgs;
            defaultPackage = cfg.package;
          };
          config.enable = lib.mkDefault true;
        }
      );
      description = ''
        PD2 Trader settings for existing normal NixOS users. Retain an entry
        with enable = false until its user rules service has run to remove
        owned KDE rules; removing an entry cannot clean an existing home.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = map (name: {
          assertion = builtins.hasAttr name config.users.users && config.users.users.${name}.isNormalUser;
          message = "programs.pd2-trader.users.${name} must name an existing normal NixOS user.";
        }) names;
        users.users = lib.mapAttrs (name: user: {
          packages = lib.optional user.enable runtimes.${name}.package;
        }) cfg.users;
      }
      (lib.mkIf (names != [ ]) {
        systemd.user.services.pd2-trader-kde-rules = {
          description = "Apply PD2 Trader KDE window-rule workarounds";
          wantedBy = [ "graphical-session.target" ];
          partOf = [ "graphical-session.target" ];
          after = [ "graphical-session.target" ];
          # All our commands use store paths; preserve the graphical session's
          # PATH so browser/desktop handoff retains the user's KDE helpers.
          enableDefaultPath = false;
          unitConfig.ConditionUser = conditions names;
          serviceConfig = {
            Type = "oneshot";
            ExecStart = "${applyRules}";
            RemainAfterExit = true;
          };
        };
      })
      (lib.mkIf (autoNames != [ ]) {
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
          unitConfig.ConditionUser = conditions autoNames;
          serviceConfig = {
            ExecStart = "${launch}";
            Restart = "on-failure";
            RestartSec = 5;
          };
        };
      })
    ]
  );
}
