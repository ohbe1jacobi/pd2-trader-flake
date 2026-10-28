# Shared per-user options for the Home Manager and NixOS adapters.
{
  lib,
  pkgs,
  defaultPackage ? pkgs.callPackage ../package.nix { },
}:
{
  enable = lib.mkEnableOption "PD2 Trader";
  package = lib.mkOption {
    type = lib.types.package;
    default = defaultPackage;
    defaultText = lib.literalExpression "pkgs.callPackage ../package.nix { }";
    description = "PD2 Trader package to install and launch.";
  };
  autostart = lib.mkOption {
    type = lib.types.bool;
    default = true;
    description = "Start PD2 Trader with the graphical session using a systemd user service.";
  };
  diablo2Directory = lib.mkOption {
    type = lib.types.nullOr (
      lib.types.addCheck lib.types.str (value: lib.hasPrefix "/" value || lib.hasPrefix "~/" value)
    );
    default = "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
    example = "~/Games/custom-prefix/drive_c/Program Files (x86)/Diablo II";
    description = ''
      Runtime path to the actual Diablo II installation directory (the parent
      of ProjectD2), not the Wine prefix. Accepts an absolute path or a leading
      ~/ expanded against the launching user's home. Use a quoted string,
      never a Nix path literal: the game must not be copied into the Nix store.
      When set, the installed launcher merges only diablo2Directory into the
      mutable Trader settings before each launch. Null leaves the GUI setting
      unmanaged and does not erase its last value. Exit Trader before relaunching
      with a changed value. No game files are modified or imported.
    '';
  };
  kde.PD2StartWindowed = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      Start the exact Diablo II / steam_app_default window without fullscreen
      or either maximization axis. Uses Apply Initially, so manual fullscreen
      changes remain possible. Does not edit D2GL or Lutris settings.
      Opt-in for KDE Plasma; no desktop autodetection is performed.
    '';
  };
  kde.traderoverlay = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      Force the PD2Trader window to KWin's on-screen-display layer and skip
      the taskbar and window switcher. Does not change input/cursor settings.
      Opt-in for KDE Plasma; no desktop autodetection is performed.
    '';
  };
  kde.gameWindowTitle = lib.mkOption {
    type = lib.types.addCheck lib.types.str (value: value != "");
    default = "Diablo II";
    description = "Exact game window title to match for the windowed-start rule.";
  };
  kde.gameWindowClass = lib.mkOption {
    type = lib.types.addCheck lib.types.str (value: value != "");
    default = "steam_app_default";
    description = "Exact Wine/X11 window class to match alongside the game title; override for another Wine runner.";
  };
  kde.traderWindowTitle = lib.mkOption {
    type = lib.types.addCheck lib.types.str (value: value != "");
    default = "PD2Trader";
    description = "Exact Trader overlay window title to match for the stacking rule.";
  };
}
