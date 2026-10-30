# Cache publishers must never sign outputs from a runner on which candidate
# application code executed outside the Nix sandbox (it could tamper with NARs).
# Keep the existing real X11/tray smoke test, but execute it as a derivation.
{ pkgs, package }:
pkgs.runCommand "pd2-trader-cache-sandbox-smoke"
  {
    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.xorg-server
      pkgs.xwininfo
      pkgs.dbus
    ];
    PD2_TRADER_DBUS_SESSION_CONFIG = "${pkgs.dbus}/share/dbus-1/session.conf";
    GDK_BACKEND = "x11";
  }
  ''
    node ${./headless-smoke.mjs} ${package}
    touch "$out"
  ''
