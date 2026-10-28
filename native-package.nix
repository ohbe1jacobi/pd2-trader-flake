{
  lib,
  rustPlatform,
  fetchFromGitHub,
  buildNpmPackage,
  pkg-config,
  wrapGAppsHook3,
  gtk3,
  webkitgtk_4_1,
  openssl,
  glib-networking,
  libayatana-appindicator,
  libX11,
  libXtst,
  libXi,
  libXrandr,
  libXext,
  libxkbcommon,
  xdotool,
  xdg-utils,
  makeDesktopItem,
  source ? null,
  enableParallelBuilding ? false,
}:
let
  pname = "pd2-trader";
  version = "0.10.7";
  src =
    if source != null then
      lib.cleanSourceWith {
        src = source;
        filter =
          path: type:
          lib.cleanSourceFilter path type
          && !(builtins.elem (baseNameOf path) [
            "dist"
            "node_modules"
            "target"
          ]);
      }
    else
      fetchFromGitHub {
        owner = "errolgr";
        repo = "pd2-trade";
        tag = "app-v${version}";
        hash = "sha256-/lmvUuW8a4JOq0/kFU1Vh7UG0+IdCp15sLR7qCj3Lbw=";
      };
  frontend = buildNpmPackage {
    pname = "${pname}-frontend";
    inherit version src;
    npmDepsHash = "sha256-GQCHG2NndHNH+chll89gwwu+0mS4lzQMI8baFtuh6+E=";
    npmFlags = [ "--ignore-scripts" ];
    env.HUSKY = "0";
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      # Upstream's test script uses non-watch Vitest; one worker limits memory.
      npm run test -- --maxWorkers=1 --minWorkers=1
      runHook postCheck
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r dist/. "$out/"
      runHook postInstall
    '';
  };
  desktop = makeDesktopItem {
    name = pname;
    desktopName = "PD2 Trader";
    exec = pname;
    icon = "pd2-trader-installer";
    comment = "Trading companion for Project Diablo 2";
    categories = [ "Game" ];
    terminal = false;
  };
in
rustPlatform.buildRustPackage {
  inherit pname version src;
  cargoHash = "sha256-WhWi3rwoNAzZQyoGvCcNXT23mdzjax+f/AGL1wahbv8=";
  cargoRoot = "src-tauri";
  buildAndTestSubdir = "src-tauri";
  cargoBuildFlags = [
    "--features"
    "tauri/custom-protocol"
    "--bin"
    "pd2-trader"
  ];
  # Do not compile unused staticlib/cdylib outputs.
  postPatch = ''
    substituteInPlace src-tauri/Cargo.toml \
      --replace-fail 'crate-type = ["staticlib", "cdylib", "rlib"]' 'crate-type = ["rlib"]'
  '';
  preBuild = ''
    rm -rf dist
    mkdir dist
    cp -r ${frontend}/. dist/
  '';
  nativeBuildInputs = [
    pkg-config
    wrapGAppsHook3
  ];
  buildInputs = [
    gtk3
    webkitgtk_4_1
    openssl
    glib-networking
    libayatana-appindicator
    libX11
    libXtst
    libXi
    libXrandr
    libXext
    libxkbcommon
    xdotool
  ];
  inherit enableParallelBuilding;
  env.CARGO_PROFILE_RELEASE_DEBUG = "0";
  doCheck = true;
  postInstall = ''
    install -Dm644 src-tauri/icons/favicon-32x32.png \
      "$out/share/icons/hicolor/32x32/apps/pd2-trader-installer.png"
    install -Dm644 ${desktop}/share/applications/pd2-trader.desktop \
      "$out/share/applications/pd2-trader.desktop"
  '';
  preFixup = ''
    gappsWrapperArgs+=(
      --set GDK_BACKEND x11
      --suffix PATH : ${lib.makeBinPath [ xdg-utils ]}
    )
  '';
  # libappindicator-sys uses dlopen by soname, invisible to RPATH shrinking.
  # Keep this in the ELF rather than leaking LD_LIBRARY_PATH to browser children.
  postFixup = ''
    patchelf --add-rpath ${lib.makeLibraryPath [ libayatana-appindicator ]} \
      "$out/bin/.pd2-trader-wrapped"
  '';
  passthru = {
    inherit frontend;
    upstreamSource = src;
  };
  meta = {
    description = "Project Diablo 2 trading companion, compiled from source";
    homepage = "https://github.com/errolgr/pd2-trade";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "pd2-trader";
  };
}
