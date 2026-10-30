{
  pkgs,
  nixpkgs,
  home-manager,
  flake,
}:
let
  # Give the consumer a visibly different runtime dependency without compiling it.
  consumerPkgs = pkgs.extend (
    _: prev: {
      gst_all_1 = prev.gst_all_1 // {
        gst-plugins-good = prev.gst_all_1.gst-plugins-good.overrideAttrs (old: {
          pname = "${old.pname}-module-consumer-test";
        });
      };
    }
  );
  lockedPackage = flake.packages.x86_64-linux.default;
  consumerPackage = consumerPkgs.callPackage ../package.nix { };
  overridePackage = pkgs.writeShellScriptBin "pd2-trader" "exit 0";
  evaluateNixos =
    module: settings:
    (nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        module
        {
          nixpkgs.pkgs = consumerPkgs;
          boot.isContainer = true;
          system.stateVersion = "26.05";
          programs.pd2-trader = settings;
        }
      ];
    }).config.programs.pd2-trader.package;
  evaluateHomeManager =
    module: settings:
    (home-manager.lib.homeManagerConfiguration {
      pkgs = consumerPkgs;
      modules = [
        module
        {
          home.username = "pd2-test";
          home.homeDirectory = "/home/pd2-test";
          home.stateVersion = "26.05";
          programs.pd2-trader = settings;
        }
      ];
    }).config.programs.pd2-trader.package;
  checkAdapter =
    evaluate: modules: directModule:
    assert evaluate modules.default { enable = true; } == lockedPackage;
    assert evaluate modules.pd2-trader { enable = true; } == lockedPackage;
    assert evaluate modules.default { } == lockedPackage;
    assert
      evaluate modules.default {
        enable = true;
        package = overridePackage;
      } == overridePackage;
    assert evaluate directModule { enable = true; } == consumerPackage;
    true;
in
assert lockedPackage != consumerPackage;
assert checkAdapter evaluateNixos flake.nixosModules ../modules/nixos.nix;
assert checkAdapter evaluateHomeManager flake.homeManagerModules ../modules/home-manager.nix;
assert (flake.overlays.default consumerPkgs consumerPkgs).pd2-trader == consumerPackage;
# Assertions evaluate package selection only; never build the application or activate modules.
pkgs.runCommand "pd2-trader-module-packages-contract" { } ''
  touch "$out"
''
