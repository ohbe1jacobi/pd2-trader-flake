{ pkgs, bundle }:
let
  probe = pkgs.callPackage ../flatpak/runtime-repo-probe.nix { };
  runtimeRepo = "https://dl.flathub.org/repo/flathub.flatpakrepo";
  appId = "io.github.ohbe1jacobi.RuntimeRepoTest";
in
assert bundle.doInstallCheck;
assert pkgs.lib.hasInfix "flatpak build-bundle --runtime-repo=${runtimeRepo}" bundle.installPhase;
pkgs.runCommand "flatpak-runtime-repo-contract"
  {
    nativeBuildInputs = [
      pkgs.flatpak
      pkgs.ostree
      pkgs.gnugrep
    ];
  }
  ''
    export HOME="$TMPDIR/home"
    export XDG_CACHE_HOME="$TMPDIR/cache"
    mkdir -p "$HOME" "$XDG_CACHE_HOME" app/files/bin
    cat > app/metadata <<'METADATA'
    [Application]
    name=${appId}
    runtime=org.gnome.Platform/x86_64/51
    command=test
    METADATA
    printf '#!/bin/sh\nexit 0\n' > app/files/bin/test
    chmod +x app/files/bin/test
    flatpak build-finish app
    ostree --repo=repo init --mode=bare-user-only
    flatpak build-export --disable-sandbox --disable-fsync repo app stable
    flatpak build-bundle --runtime-repo=${runtimeRepo} repo good.flatpak ${appId} stable
    ${probe}/bin/probe-runtime-repo good.flatpak ${runtimeRepo}

    flatpak build-bundle repo missing.flatpak ${appId} stable
    if ${probe}/bin/probe-runtime-repo missing.flatpak ${runtimeRepo} > missing.log 2>&1; then
      echo "Probe accepted missing runtime discovery" >&2
      exit 1
    fi
    grep -F 'Runtime repository mismatch:' missing.log
    grep -F '(missing)' missing.log

    flatpak build-bundle --runtime-repo=https://example.invalid/runtime.flatpakrepo \
      repo wrong.flatpak ${appId} stable
    if ${probe}/bin/probe-runtime-repo wrong.flatpak ${runtimeRepo} > wrong.log 2>&1; then
      echo "Probe accepted an unexpected runtime repository" >&2
      exit 1
    fi
    grep -F 'Runtime repository mismatch:' wrong.log
    grep -F 'found https://example.invalid/runtime.flatpakrepo' wrong.log

    printf 'not a flatpak bundle\n' > corrupt.flatpak
    if ${probe}/bin/probe-runtime-repo corrupt.flatpak ${runtimeRepo} > corrupt.log 2>&1; then
      echo "Probe accepted a malformed bundle" >&2
      exit 1
    fi
    grep -F 'Cannot read Flatpak bundle:' corrupt.log
    touch "$out"
  ''
