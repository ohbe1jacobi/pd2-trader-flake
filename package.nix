{
  lib,
  callPackage,
  symlinkJoin,
  makeWrapper,
  gst_all_1,
  source ? null,
  enableParallelBuilding ? false,
}:
let
  # Keep source compilation separate so runtime-only fixes reuse the native build.
  native = callPackage ./native-package.nix { inherit source enableParallelBuilding; };
  mediaPluginPath = lib.makeSearchPath "lib/gstreamer-1.0" [
    (lib.getLib gst_all_1.gstreamer)
    gst_all_1.gst-plugins-base
    gst_all_1.gst-plugins-good
    # WebKit probes fakevideosink and webvttenc for video/subtitle handling.
    gst_all_1.gst-plugins-bad
  ];
in
symlinkJoin {
  inherit (native) pname version;
  name = "${native.pname}-${native.version}";
  paths = [ native ];
  nativeBuildInputs = [ makeWrapper ];
  postBuild = ''
    rm "$out/bin/pd2-trader"
    makeWrapper ${native}/bin/pd2-trader "$out/bin/pd2-trader" \
      --set GDK_BACKEND x11 \
      --prefix GST_PLUGIN_SYSTEM_PATH_1_0 : ${mediaPluginPath}
  '';
  passthru = {
    inherit native mediaPluginPath;
    inherit (native) frontend upstreamSource preBuild;
  };
  inherit (native) meta;
}
