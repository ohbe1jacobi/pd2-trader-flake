# Use git-hooks.nix's built-in hooks and the flake's existing test graph.
{ pkgs }:
{
  default_stages = [ "pre-commit" ];
  excludes = [ "^(upstream|private|legacy-appimage|diagnostics)/" ];
  hooks = {
    nixfmt = {
      enable = true;
      package = pkgs.nixfmt;
      args = [ "--check" ];
    };
    # The built-in Statix hook scans the tree, not its triggering filenames.
    # Preserve the existing package lint scope using its native ignore option.
    statix = {
      enable = true;
      files = "^(native-package|package)\\.nix$";
      settings.ignore = [
        "flake.nix"
        "devshell.nix"
        "git-hooks.nix"
        "modules/*"
        "tests/*"
      ];
    };
    deadnix = {
      enable = true;
      files = "^(native-package|package)\\.nix$";
    };
    ruff = {
      enable = true;
      args = [
        "--no-cache"
        "--select"
        "E9,F63,F7,F82"
      ];
    };
    shellcheck.enable = true;
    shfmt.enable = true;
    actionlint.enable = true;
    check-python.enable = true;
    check-json.enable = true;
    check-toml.enable = true;
    check-yaml.enable = true;
    check-merge-conflicts.enable = true;
    end-of-file-fixer.enable = true;
    trim-trailing-whitespace = {
      enable = true;
      stages = [ "pre-commit" ];
    };
    commitizen.enable = true;
    update-automation = {
      enable = true;
      name = "Offline upstream-update and release contracts";
      entry = "${pkgs.nodejs}/bin/node --test tests/upstream-release.mjs tests/prepare-update.mjs tests/update-integration.mjs tests/release-lifecycle.mjs tests/release-scenarios.mjs";
      files = "^(\\.github/(scripts|workflows)/|tests/(upstream-release|prepare-update|update-integration|release-lifecycle|release-scenarios)\\.mjs$|automation-tools\\.nix$)";
      pass_filenames = false;
    };
    flake-check = {
      enable = true;
      name = "Nix flake checks (including application build and tests)";
      entry = "${pkgs.nix}/bin/nix flake check --no-update-lock-file --max-jobs 1 --cores 1 --print-build-logs";
      stages = [
        "pre-push"
        "manual"
      ];
      pass_filenames = false;
      always_run = true;
    };
  };
}
