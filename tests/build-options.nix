{ pkgs, package }:
assert package.native.doCheck;
assert package.frontend.doCheck;
assert package.meta.mainProgram == "pd2-trader";
assert package.native.enableParallelBuilding == false;
assert (package.override { enableParallelBuilding = true; }).native.enableParallelBuilding;
pkgs.runCommand "pd2-trader-build-options-contract" { } ''
  touch "$out"
''
