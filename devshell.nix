# Maintainer environment; independent of any optional upstream source checkout.
{
  pkgs,
  package,
  preCommitCheck,
}:
pkgs.mkShell {
  name = "pd2-trader-development";
  inputsFrom = [ package.native ];
  packages =
    preCommitCheck.enabledPackages
    ++ (with pkgs; [
      # First-party Nix/Python/shell/JavaScript development.
      nix
      nixfmt
      nixd
      statix
      deadnix
      python3
      ruff
      nodejs
      bashInteractive
      shellcheck
      shfmt
      git
      gitflow
      gh
      commitizen
      jq
      pre-commit

      # Cargo/rustc and native library headers come from inputsFrom above.
      rustfmt
      clippy
      rust-analyzer
      pkg-config

      # KDE integration tests and isolated graphical/media smoke tests.
      kdePackages.kconfig
      kdePackages.qttools
      gst_all_1.gstreamer
      xwininfo
      xorg-server
      dbus
      binutils
      patchelf
      desktop-file-utils
    ]);

  # The generated configuration installs pre-commit and commit-msg
  # hooks on entry. CI/read-only tooling can opt out without weakening checks.
  shellHook = ''
    if [ "''${PD2_TRADER_NO_HOOKS:-0}" != 1 ]; then
      ${preCommitCheck.shellHook}
    fi
  '';

  # Support local native builds without leaking library overrides to browsers.
  GDK_BACKEND = "x11";
  # dbus-run-session otherwise looks for host /etc configuration on CI.
  PD2_TRADER_DBUS_SESSION_CONFIG = "${pkgs.dbus}/share/dbus-1/session.conf";
  GIO_EXTRA_MODULES = "${pkgs.glib-networking}/lib/gio/modules";
  GST_PLUGIN_SYSTEM_PATH_1_0 = package.mediaPluginPath;
  RUSTFLAGS = "-C link-arg=-Wl,-rpath,${pkgs.lib.makeLibraryPath [ pkgs.libayatana-appindicator ]}";
}
