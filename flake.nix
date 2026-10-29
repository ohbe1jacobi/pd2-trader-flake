{
  description = "PD2 Trader compiled from pinned Rust and frontend source, without AppImage runtimes";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  # Used by the module evaluation tests; consumers need not import this HM instance.
  inputs.home-manager.url = "github:nix-community/home-manager/release-26.05";
  inputs.home-manager.inputs.nixpkgs.follows = "nixpkgs";
  inputs.git-hooks.url = "github:cachix/git-hooks.nix";
  inputs.git-hooks.inputs.nixpkgs.follows = "nixpkgs";
  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      git-hooks,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      package = pkgs.callPackage ./package.nix { };
      automationTools = import ./automation-tools.nix { inherit pkgs; };
      preCommitCheck = git-hooks.lib.${system}.run (
        (import ./git-hooks.nix { inherit pkgs; })
        // {
          src = ./.;
        }
      );
      devShell = import ./devshell.nix { inherit pkgs package preCommitCheck; };
    in
    {
      packages.${system} = {
        pd2-trader = package;
        default = package;
        frontend = package.frontend;
        # Maintainer tooling uses the same locked package set, with nix-update
        # pinned independently to the revision verified for the native target.
        nix-update = automationTools.nix-update;
      };
      apps.${system} = {
        pd2-trader = {
          type = "app";
          program = "${package}/bin/pd2-trader";
          meta.description = package.meta.description;
        };
        default = self.apps.${system}.pd2-trader;
      };
      overlays.default = final: prev: { pd2-trader = final.callPackage ./package.nix { }; };
      devShells.${system}.default = devShell;
      homeManagerModules.pd2-trader = import ./modules/home-manager.nix;
      homeManagerModules.default = self.homeManagerModules.pd2-trader;
      nixosModules.pd2-trader = import ./modules/nixos.nix;
      nixosModules.default = self.nixosModules.pd2-trader;
      checks.${system} = {
        pre-commit = preCommitCheck;

        upstream-release =
          pkgs.runCommand "pd2-trader-upstream-release-contract" { nativeBuildInputs = [ pkgs.nodejs ]; }
            ''
              mkdir -p .github/scripts tests
              cp ${./.github/scripts}/*.mjs .github/scripts/
              cp ${./tests/upstream-release.mjs} tests/upstream-release.mjs
              cp ${./tests/prepare-update.mjs} tests/prepare-update.mjs
              cp ${./tests/update-integration.mjs} tests/update-integration.mjs
              cp ${./tests/release-lifecycle.mjs} tests/release-lifecycle.mjs
              cp ${./tests/release-scenarios.mjs} tests/release-scenarios.mjs
              node --test tests/upstream-release.mjs tests/prepare-update.mjs \
                tests/update-integration.mjs tests/release-lifecycle.mjs tests/release-scenarios.mjs
              touch "$out"
            '';

        devshell = import ./tests/devshell.nix {
          inherit pkgs;
          shell = devShell;
        };
        build-options = import ./tests/build-options.nix { inherit pkgs package; };
        nixos = import ./tests/nixos.nix {
          inherit pkgs nixpkgs package;
          module = self.nixosModules.default;
        };
        home-manager = import ./tests/home-manager.nix {
          inherit pkgs home-manager package;
          module = self.homeManagerModules.default;
        };
        runtime = import ./tests/runtime.nix { inherit pkgs; };
        settings =
          pkgs.runCommand "pd2-trader-settings-contract" { nativeBuildInputs = [ pkgs.python3 ]; }
            ''
              python ${./tests/settings.py} ${./modules/settings.py}
              touch "$out"
            '';
        kde-rules =
          pkgs.runCommand "pd2-trader-kde-rules-contract"
            {
              nativeBuildInputs = [
                pkgs.python3
                pkgs.kdePackages.kconfig
              ];
            }
            ''
              export HOME="$TMPDIR/home"
              mkdir -p "$HOME"
              python ${./tests/kde-rules.py} ${./modules/kde-rules.py} \
                ${pkgs.kdePackages.kconfig}/bin/kreadconfig6 \
                ${pkgs.kdePackages.kconfig}/bin/kwriteconfig6
              touch "$out"
            '';
        media =
          pkgs.runCommand "pd2-trader-media-contract"
            {
              nativeBuildInputs = [
                pkgs.bash
                pkgs.gnugrep
                pkgs.gst_all_1.gstreamer
              ];
            }
            ''
              bash ${./tests/media-contract.sh} ${package} \
                ${pkgs.lib.escapeShellArg package.mediaPluginPath} \
                ${package.upstreamSource}/src/assets/poe_whisper.mp3
              touch "$out"
            '';

        frontend-copy =
          pkgs.runCommand "pd2-trader-frontend-copy"
            {
              nativeBuildInputs = [
                pkgs.bash
                pkgs.coreutils
                pkgs.diffutils
              ];
            }
            ''
              cat > prebuild.sh <<'PREBUILD'
              ${package.preBuild}
              PREBUILD
              bash ${./tests/frontend-copy.sh} "$PWD/prebuild.sh" ${package.frontend}
              touch "$out"
            '';
        package-contract =
          pkgs.runCommand "pd2-trader-source-contract"
            {
              nativeBuildInputs = [
                pkgs.bash
                pkgs.gnugrep
                pkgs.binutils
                pkgs.glibc.bin
                pkgs.desktop-file-utils
                pkgs.gcc
                pkgs.patchelf
              ];
            }
            ''
              bash ${./tests/package-contract.sh} ${package}
              bash ${./tests/source-contract.sh} ${package}
              desktop-file-validate ${package}/share/applications/pd2-trader.desktop
              cc ${./tests/tray-dlopen.c} -ldl -o tray-dlopen
              patchelf --set-rpath "$(patchelf --print-rpath ${package}/bin/.pd2-trader-wrapped)" tray-dlopen
              env -u LD_LIBRARY_PATH -u LD_PRELOAD ./tray-dlopen
              touch "$out"
            '';
      };
      formatter.${system} = pkgs.writeShellApplication {
        name = "format-pd2-trader";
        runtimeInputs = [ pkgs.nixfmt ];
        text = ''
          if [ "$#" -eq 0 ]; then set -- flake.nix package.nix native-package.nix devshell.nix git-hooks.nix modules/*.nix tests/*.nix; fi
          exec nixfmt "$@"
        '';
      };
    };
}
