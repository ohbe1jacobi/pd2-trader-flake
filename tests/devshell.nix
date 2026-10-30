{ pkgs, shell }:
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
