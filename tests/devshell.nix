{ pkgs, shell }:
let
  hooks = (import ../git-hooks.nix { inherit pkgs; }).hooks;
  moduleFiles = map (name: "modules/${name}") (
    builtins.filter (pkgs.lib.hasSuffix ".nix") (builtins.attrNames (builtins.readDir ../modules))
  );
in
assert builtins.match hooks.statix.files "flake.nix" != null;
assert builtins.match hooks.deadnix.files "flake.nix" != null;
assert !(builtins.elem "flake.nix" hooks.statix.settings.ignore);
assert builtins.all (file: builtins.match hooks.statix.files file != null) moduleFiles;
assert builtins.all (file: builtins.match hooks.deadnix.files file != null) moduleFiles;
assert !(builtins.elem "modules/*" hooks.statix.settings.ignore);
assert !(shell ? LD_LIBRARY_PATH);
assert !(shell ? LD_PRELOAD);
assert builtins.elem pkgs.commitizen shell.nativeBuildInputs;
assert builtins.elem pkgs.gitflow shell.nativeBuildInputs;
pkgs.runCommandCC "pd2-trader-devshell-contract"
  {
    inherit (shell)
      nativeBuildInputs
      buildInputs
      GDK_BACKEND
      PD2_TRADER_DBUS_SESSION_CONFIG
      PD2_TRADER_TEST_FONTCONFIG_FILE
      GIO_EXTRA_MODULES
      GST_PLUGIN_SYSTEM_PATH_1_0
      RUSTFLAGS
      ;
  }
  ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    bash ${./devshell.sh} ${./.} ${../modules}
    touch "$out"
  ''
