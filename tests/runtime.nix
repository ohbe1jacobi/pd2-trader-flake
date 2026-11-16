{ pkgs }:
let
  fake = pkgs.writeShellScriptBin "pd2-trader" ''
    cp "$XDG_CONFIG_HOME/com.pd2-trader.app/settings.json" "$HOME/observed.json"
    printf '%s\n' "$@" > "$HOME/arguments"
  '';
  cfg = {
    enable = true;
    package = fake;
    settings = {
      autoUpdateEnabled = false;
      telemetryOptOut = null;
      diablo2Directory = "/home/test/Games/Program Files (x86)/Diablo II";
    };
    kde.PD2StartWindowed = false;
    kde.traderoverlay = false;
  };
  runtime = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs cfg;
  };
  defaults = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs;
    cfg =
      (pkgs.lib.evalModules {
        modules = [
          {
            options = import ../modules/options.nix {
              inherit (pkgs) lib;
              inherit pkgs;
              defaultPackage = fake;
            };
          }
        ];
      }).config;
  };
  unmanaged = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs;
    cfg = cfg // {
      settings = cfg.settings // {
        diablo2Directory = null;
        autoUpdateEnabled = null;
      };
    };
  };
  homeRelative = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs;
    cfg = cfg // {
      settings = cfg.settings // {
        diablo2Directory = "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
      };
    };
  };
  updaterOnly = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs;
    cfg = cfg // {
      settings = cfg.settings // {
        diablo2Directory = null;
      };
    };
  };
  updaterEnabled = import ../modules/runtime.nix {
    inherit (pkgs) lib;
    inherit pkgs;
    cfg = cfg // {
      settings = cfg.settings // {
        autoUpdateEnabled = true;
      };
    };
  };
  telemetryOnly =
    value:
    import ../modules/runtime.nix {
      inherit (pkgs) lib;
      inherit pkgs;
      cfg = cfg // {
        settings = {
          diablo2Directory = null;
          autoUpdateEnabled = null;
          telemetryOptOut = value;
        };
      };
    };
in
assert unmanaged.package == fake;
pkgs.runCommand "pd2-trader-runtime-contract" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  export HOME="$TMPDIR/home"
  export XDG_CONFIG_HOME="$HOME/custom config"
  mkdir -p "$XDG_CONFIG_HOME/com.pd2-trader.app"
  # Default module launches preserve absent, disabled, and enabled GUI preferences.
  for preference in absent false true; do
    python -c 'import json,os,pathlib,sys; s={"unrelated":{"keep":True}}; v=sys.argv[1]; s.update({"autoUpdateEnabled":v == "true"} if v != "absent" else {}); (pathlib.Path(os.environ["XDG_CONFIG_HOME"])/"com.pd2-trader.app/settings.json").write_text(json.dumps(s))' "$preference"
    ${defaults.package}/bin/pd2-trader
    python -c 'import json,os,pathlib,sys; p=pathlib.Path(os.environ["HOME"]); s=json.loads((p/"observed.json").read_text()); v=sys.argv[1]; assert ("autoUpdateEnabled" not in s) if v == "absent" else s["autoUpdateEnabled"] is (v == "true"); assert s["unrelated"] == {"keep":True}; assert s["diablo2Directory"] == str(p/"Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II")' "$preference"
  done
  printf '%s\n' '{"pd2Token":"fixture-token","unrelated":{"keep":true}}' > "$XDG_CONFIG_HOME/com.pd2-trader.app/settings.json"
  ${runtime.package}/bin/pd2-trader 'argument with spaces' --example
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); s=json.loads((p/"observed.json").read_text()); assert s == {"pd2Token":"fixture-token","unrelated":{"keep":True},"diablo2Directory":"/home/test/Games/Program Files (x86)/Diablo II","autoUpdateEnabled":False}; assert (p/"arguments").read_text() == "argument with spaces\n--example\n"'
  test -x ${pkgs.kdePackages.qttools}/bin/qdbus
  ${homeRelative.package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); s=json.loads((p/"observed.json").read_text()); assert s["diablo2Directory"] == str(p/"Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II"); assert s["pd2Token"] == "fixture-token"'
  ${updaterEnabled.package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); assert json.loads((p/"observed.json").read_text())["autoUpdateEnabled"] is True'
  ${updaterOnly.package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); s=json.loads((p/"observed.json").read_text()); assert s["autoUpdateEnabled"] is False; assert s["diablo2Directory"] == "/home/test/Games/Program Files (x86)/Diablo II"'
  ${(telemetryOnly true).package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); s=json.loads((p/"observed.json").read_text()); assert s["telemetryOptOut"] is True; assert s["autoUpdateEnabled"] is False; assert s["pd2Token"] == "fixture-token"'
  ${runtime.package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); assert json.loads((p/"observed.json").read_text())["telemetryOptOut"] is True'
  ${(telemetryOnly false).package}/bin/pd2-trader
  python -c 'import json,os,pathlib; p=pathlib.Path(os.environ["HOME"]); assert json.loads((p/"observed.json").read_text())["telemetryOptOut"] is False'
  echo 'PASS: configured launcher merges managed settings including telemetry before exec, respects XDG_CONFIG_HOME, preserves arguments and unrelated settings'
  touch "$out"
''
