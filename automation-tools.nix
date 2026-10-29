# Automation uses the locked nixpkgs toolchain, with nix-update pinned separately
# because 1.16.0 understands the Rust vendorStaging fixed-output derivation.
{ pkgs }:
{
  nix-update = pkgs.python3Packages.buildPythonApplication {
    pname = "nix-update";
    version = "1.16.0";
    pyproject = true;

    src = pkgs.fetchFromGitHub {
      owner = "Mic92";
      repo = "nix-update";
      rev = "1d1459b0de8a694246115180dbbc9c228eccedcf";
      hash = "sha256-NgYAZdo78bqx95HvUxYpLP/qcNE+2IPvzMOwPE8eVGU=";
    };

    build-system = [ pkgs.python3Packages.hatchling ];
    makeWrapperArgs = [
      "--prefix"
      "PATH"
      ":"
      (pkgs.lib.makeBinPath [
        pkgs.nix
        pkgs.nix-prefetch-git
      ])
    ];
    checkPhase = ''
      runHook preCheck
      $out/bin/nix-update --help > /dev/null
      runHook postCheck
    '';
    pythonImportsCheck = [ "nix_update" ];

    meta = {
      description = "Swiss-knife for updating Nix packages";
      homepage = "https://github.com/Mic92/nix-update";
      license = pkgs.lib.licenses.mit;
      mainProgram = "nix-update";
    };
  };
  inherit (pkgs) gh;
}
