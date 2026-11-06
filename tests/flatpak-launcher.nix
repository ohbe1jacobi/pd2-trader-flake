{ pkgs }:
let
  nativeLauncher = pkgs.writeShellScript "pd2-trader-launcher-fixture" ''
    printf '%s\0' "$@"
    exit 17
  '';
  launcher = pkgs.callPackage ../flatpak/launcher.nix { inherit nativeLauncher; };
in
pkgs.runCommand "pd2-trader-flatpak-launcher-contract" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  export TMPDIR="$PWD"
  python ${./flatpak-launcher.py} ${launcher}
  touch "$out"
''
