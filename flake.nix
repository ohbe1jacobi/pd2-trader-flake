{
  description = "PD2 Trader compiled from pinned Rust and frontend source, without AppImage runtimes";
  nixConfig = {
    extra-substituters = [ "https://pd2-trader-flake.cachix.org" ];
    extra-trusted-public-keys = [
      "pd2-trader-flake.cachix.org-1:rg+7WukdJd8/1+Ky8c7kUHivrvfcmOPVlGUxz4CqLM4="
    ];
  };
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    # Used by the module evaluation tests; consumers need not import this HM instance.
    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Track the converter branch while flake.lock fixes its reviewed revision.
    nix2flatpak = {
      url = "github:neobrain/nix2flatpak/main";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      git-hooks,
      nix2flatpak,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      package = pkgs.callPackage ./package.nix { };
      flatpakPrototype = pkgs.callPackage ./flatpak/prototype.nix {
        inherit package;
        mkFlatpak = nix2flatpak.lib.${system}.mkFlatpak;
      };
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
        inherit (package) frontend;
        # Explicit opt-in targets, not part of the default application build.
        flatpak-prototype = flatpakPrototype.bundle;
        flatpak-repo-prototype = flatpakPrototype.repository;
        # Inventory tooling follows the committed nixpkgs pin, not a new input.
        inherit (pkgs) sbomnix;
        # Maintainer tooling uses the same locked package set, with nix-update
        # pinned independently to the revision verified for the native target.
        inherit (automationTools) nix-update;
      };
      apps.${system} = {
        pd2-trader = {
          type = "app";
          program = "${package}/bin/pd2-trader";
          meta.description = package.meta.description;
        };
        default = self.apps.${system}.pd2-trader;
      };
      overlays.default = final: _: { pd2-trader = final.callPackage ./package.nix { }; };
      devShells.${system}.default = devShell;
      # Export cache-compatible defaults without changing direct module-file imports.
      homeManagerModules.pd2-trader =
        { lib, ... }:
        {
          imports = [ ./modules/home-manager.nix ];
          programs.pd2-trader.package = lib.mkDefault package;
        };
      homeManagerModules.default = self.homeManagerModules.pd2-trader;
      nixosModules.pd2-trader =
        { lib, ... }:
        {
          imports = [ ./modules/nixos.nix ];
          programs.pd2-trader.package = lib.mkDefault package;
        };
      nixosModules.default = self.nixosModules.pd2-trader;
      checks.${system} = {
        pre-commit = preCommitCheck;
        # Isolated settings/launcher test; does not build or launch the Flatpak app.
        flatpak-launcher = import ./tests/flatpak-launcher.nix { inherit pkgs; };
        # Exercise real bundle metadata, including missing/incorrect URLs.
        flatpak-runtime-repo = import ./tests/flatpak-runtime-repo.nix {
          inherit pkgs;
          inherit (flatpakPrototype) bundle;
        };
        dependency-graph =
          pkgs.runCommand "pd2-trader-dependency-graph-contract" { nativeBuildInputs = [ pkgs.nodejs ]; }
            ''
              mkdir -p .github/scripts .github/workflows tests
              cp ${./.github/dependabot.yml} .github/dependabot.yml
              cp ${./.github/scripts/flake-lock-sbom.mjs} .github/scripts/flake-lock-sbom.mjs
              cp ${./.github/scripts/prepare-nix-sbom.mjs} .github/scripts/prepare-nix-sbom.mjs
              cp ${./.github/scripts/cache-ci.mjs} .github/scripts/cache-ci.mjs
              cp ${./.github/workflows/ci.yml} .github/workflows/ci.yml
              cp ${./.github/workflows/dependency-graph.yml} .github/workflows/dependency-graph.yml
              cp ${./tests/dependency-graph.mjs} tests/dependency-graph.mjs
              cp ${./flake.lock} flake.lock
              node --test tests/dependency-graph.mjs
              touch "$out"
            '';
        module-packages = import ./tests/module-packages.nix {
          inherit pkgs nixpkgs home-manager;
          flake = self;
        };
        cache-smoke = import ./tests/cache-smoke.nix { inherit pkgs package; };
        cache-ci =
          pkgs.runCommand "pd2-trader-cache-ci-contract" { nativeBuildInputs = [ pkgs.nodejs ]; }
            ''
              mkdir -p .github/scripts .github/workflows tests
              cp ${./.github/scripts/cache-ci.mjs} .github/scripts/cache-ci.mjs
              cp ${./.github/scripts/cache-transfer.mjs} .github/scripts/cache-transfer.mjs
              cp ${./.github/scripts/cache-generated.mjs} .github/scripts/cache-generated.mjs
              cp ${./.github/scripts/check-upstream.mjs} .github/scripts/check-upstream.mjs
              cp ${./.github/scripts/update-integration.mjs} .github/scripts/update-integration.mjs
              cp ${./.github/workflows/ci.yml} .github/workflows/ci.yml
              cp ${./.github/workflows/cache-generated.yml} .github/workflows/cache-generated.yml
              cp ${./.github/workflows/prepare-update.yml} .github/workflows/prepare-update.yml
              cp ${./tests/cache-ci.mjs} tests/cache-ci.mjs
              cp ${./flake.nix} flake.nix
              cp ${./git-hooks.nix} git-hooks.nix
              node --test tests/cache-ci.mjs
              touch "$out"
            '';

        upstream-release =
          pkgs.runCommand "pd2-trader-upstream-release-contract" { nativeBuildInputs = [ pkgs.nodejs ]; }
            ''
              mkdir -p .github/scripts .github/workflows tests
              cp ${./.github/scripts}/*.mjs .github/scripts/
              cp ${./.github/workflows/release-lifecycle.yml} .github/workflows/release-lifecycle.yml
              cp ${./tests/upstream-release.mjs} tests/upstream-release.mjs
              cp ${./tests/prepare-update.mjs} tests/prepare-update.mjs
              cp ${./tests/update-integration.mjs} tests/update-integration.mjs
              cp ${./tests/release-lifecycle.mjs} tests/release-lifecycle.mjs
              cp ${./tests/release-scenarios.mjs} tests/release-scenarios.mjs
              cp ${./tests/flatpak-release.mjs} tests/flatpak-release.mjs
              node --test tests/upstream-release.mjs tests/prepare-update.mjs \
                tests/update-integration.mjs tests/release-lifecycle.mjs tests/release-scenarios.mjs \
                tests/flatpak-release.mjs
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
              inherit (devShell) PD2_TRADER_TEST_FONTCONFIG_FILE;
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
          if [ "$#" -eq 0 ]; then set -- flake.nix package.nix native-package.nix devshell.nix git-hooks.nix modules/*.nix tests/*.nix flatpak/*.nix; fi
          exec nixfmt "$@"
        '';
      };
    };
}
