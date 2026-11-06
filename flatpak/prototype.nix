{
  callPackage,
  symlinkJoin,
  makeDesktopItem,
  runCommand,
  flatpak,
  ostree,
  mkFlatpak,
  package,
}:
let
  # Packaging-repository namespace, not an assertion of upstream ownership.
  appId = "io.github.ohbe1jacobi.PD2Trader";
  launcher = callPackage ./launcher.nix {
    nativeLauncher = "${package.native}/bin/pd2-trader";
  };
  desktop = makeDesktopItem {
    name = appId;
    desktopName = "PD2 Trader (Flatpak prototype)";
    exec = "pd2-trader";
    icon = appId;
    categories = [ "Game" ];
    terminal = false;
  };
  adaptedPackage = symlinkJoin {
    name = "pd2-trader-flatpak-input-${package.version}";
    inherit (package) version;
    paths = [
      # Flatpak supplies GStreamer discovery through its runtime. The outer Nix
      # wrapper hard-codes plugin paths which conversion can discard.
      package.native
      desktop
    ];
    # The converter canonicalizes bin symlinks after rewriting them to /app,
    # where their targets cannot resolve on the builder. Materialize the Flatpak
    # launcher and native ELF so its generated relative links remain inside /app.
    postBuild = ''
      cp -L --remove-destination ${launcher} "$out/bin/pd2-trader"
      cp -L --remove-destination ${package.native}/bin/.pd2-trader-wrapped \
        "$out/bin/.pd2-trader-wrapped"
    '';
    # Do not copy the Nix package's passthru frontend/native build interface.
    inherit (package) meta;
  };
  bundle = mkFlatpak {
    inherit appId;
    package = adaptedPackage;
    appName = "PD2 Trader";
    command = "pd2-trader";
    runtime = "org.gnome.Platform/51";
    # The converter probes PNG dimensions without following symlinks. Use the
    # verified regular source file rather than the runtime wrapper's symlink.
    icon = "${package.upstreamSource}/src-tauri/icons/favicon-32x32.png";
    # ABI incompatibility must stop the prototype, not become a runtime surprise.
    skipAbiChecks = false;
    extraEnv.GDK_BACKEND = "x11";
    permissions = {
      share = [
        "network"
        "ipc"
      ];
      # Trader uses X11 window discovery/input, including under XWayland.
      sockets = [
        "x11"
        "pulseaudio"
      ];
      devices = [ "dri" ];
      # No blanket home/host access. Grant only the configured game's pd2logs
      # directory at test launch; the watcher creates missing log files.
      filesystems = [ ];
      # Notifications are in-app toasts; only the tray needs a watcher service.
      talk-names = [ "org.kde.StatusNotifierWatcher" ];
      # The locked single-instance plugin transforms the Tauri identifier,
      # producing a name outside the Flatpak application's default namespace.
      own-names = [ "org.com_pd2_trader_app.SingleInstance" ];
    };
  };
  # Upstream mkFlatpak discards its temporary bare-user-only repository. Export
  # the retained build directory into an HTTP-servable archive-z2 repository.
  repository =
    runCommand "pd2-trader-flatpak-repo-prototype-${package.version}"
      {
        nativeBuildInputs = [
          flatpak
          ostree
        ];
        passthru = { inherit appId bundle; };
      }
      ''
        export HOME="$TMPDIR/home"
        export XDG_CACHE_HOME="$TMPDIR/cache"
        mkdir -p "$HOME" "$XDG_CACHE_HOME"
        ostree --repo="$out" init --mode=archive-z2
        flatpak build-export --disable-sandbox --disable-fsync --update-appstream \
          "$out" ${bundle}/flatpak-dir stable
        # Assert that this is a usable remote, not merely a directory of bundles.
        ostree --repo="$out" show app/${appId}/x86_64/stable
        test -s "$out/summary"
      '';
in
{
  inherit appId bundle repository;
}
