# Configuration

[README](../README.md) · [Installation](installation.md) · [Troubleshooting](troubleshooting.md)

## Contents

- [Shared module behavior](#shared-behavior-of-both-modules)
- [Options](#options)
- [Package selection](#package-selection)
- [Game-directory handling](#game-directory-handling)
- [Automatic updates](#automatic-updates)
- [KDE rules and cleanup](#kde-rules-and-cleanup)

## Shared behavior of both modules

Both the NixOS and Home Manager adapters use **systemd user services**, not root application services. Startup is attached to `graphical-session.target`; services stop with the graphical session. Trader restarts on failure, not after a normal quit. NixOS units apply to every user and inherit the graphical session's desktop-helper PATH.

**Choose one adapter**; do not enable both on the same machine. Both own the same service names, and a user's Home Manager units shadow the system-wide ones. The NixOS module has no Home Manager dependency; the flake's Home Manager input is used for module evaluation tests.

## Options

Under `programs.pd2-trader` in both modules:

| Option | Default | Purpose |
| --- | --- | --- |
| `enable` | `false` | Install the configured package and manage session integration. |
| `autostart` | `true` | Start Trader at graphical login. Disable for manual launch only. |
| `autoUpdateEnabled` | `false` | Merge the automatic-update preference before each launch. `null` leaves the saved GUI preference unmanaged; notifications and manual updates remain available. |
| `d2dir` / `diablo2Directory` | `~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II` | Installation directory, as a quoted string; `d2dir` is an alias. Set `null` to leave the saved GUI setting unmanaged. |
| `package` | This flake's locked package for exported modules; consumer-built package for direct module-file imports | Override the Trader package. |
| `kde.PD2StartWindowed` | `false` | Start the matched game without fullscreen or either maximization axis, using **Apply Initially**. Later manual fullscreen toggles remain possible. |
| `kde.traderoverlay` | `false` | Force the matched Trader window to **Layer = On-screen display**, skipping the taskbar and window switcher. Does not change the window type. |
| `kde.gameWindowTitle` | `Diablo II` | Exact game title to match. |
| `kde.gameWindowClass` | `steam_app_default` | Exact Wine/X11 game class; override for a different Wine runner. |
| `kde.traderWindowTitle` | `PD2Trader` | Exact Trader window title to match. |

Example inside `programs.pd2-trader` in either module:

```nix
{
  autostart = false;
  d2dir = "~/Games/another-prefix/drive_c/Program Files (x86)/Diablo II";

  # KDE Plasma workarounds are opt-in; no desktop autodetection is performed.
  kde.PD2StartWindowed = true;
  kde.traderoverlay = true;
  kde.gameWindowClass = "custom-wine-class";
}
```

Explicit KDE flags work consistently with standalone Home Manager, NixOS, and multiple desktop sessions: merely having Plasma installed does not establish which session a user runs, and build-time environment variables do not identify the target user's desktop. The rules target the Plasma 6.6+ format used by the pinned Nixpkgs. Exact-match strings must be non-empty; the game rule always matches both title and class rather than every Wine window.

### Package selection

The flake's `nixosModules` and `homeManagerModules` exports select its locked package by default, independently of the consuming configuration's `pkgs`. Keep the Trader input's own nixpkgs lock for matching CI/cache builds. Using `follows` to replace that input can change the package and require compilation.

An ordinary `programs.pd2-trader.package` assignment overrides this default without `lib.mkForce`. For example, to opt into parallel compilation:

```nix
programs.pd2-trader.package =
  inputs.pd2-trader.packages.x86_64-linux.default.override {
    enableParallelBuilding = true;
  };
```

See [build resource limits](troubleshooting.md#build-parallelism-and-resource-limits) before enabling parallelism. For a consumer-built package, use `overlays.default` and explicitly select the resulting `pkgs.pd2-trader`, or supply another package. Importing `modules/nixos.nix` or `modules/home-manager.nix` directly retains the consumer-`pkgs` fallback. Neither installation route configures cache trust automatically.

### Game-directory handling

The directory must be the **actual Diablo II installation**, the parent of `ProjectD2`, not the Wine prefix. Use a quoted Nix string, never a game-directory path literal or interpolation that copies game files into the Nix store.

A leading `~/` is expanded at launch against the current user's home. Absolute strings are also supported. Other relative paths, `~otheruser`, and shell-variable/command expansion are not supported. The default therefore works for different usernames and home locations without evaluating another user's home during a build.

The module-installed launcher merges the managed `diablo2Directory` and `autoUpdateEnabled` values into `com.pd2-trader.app/settings.json` before executing Trader. Home Manager uses its `xdg.configHome`; NixOS resolves `$XDG_CONFIG_HOME` or `$HOME/.config` at runtime. Tokens, hotkeys, and unrelated settings remain mutable and are preserved. New/replaced JSON is written atomically with private permissions. Malformed, non-object, or symlinked settings files are refused instead of overwritten. No mutable settings or tokens enter the Nix store.

A GUI directory change is overridden at the next configured launch. Setting `d2dir = null` stops managing the value without clearing the last saved path. Settings are not rewritten during system/Home Manager activation.

### Automatic updates

Both modules default to `autoUpdateEnabled = false`, using upstream's existing preference rather than patching application source. It is reapplied at each configured launch, including when `d2dir = null`. Set `autoUpdateEnabled = null` to leave the GUI preference unmanaged without clearing it, or `true` to opt into upstream's automatic updates. A GUI change persists only until the next configured launch while the option is managed.

This disables automatic downloading/installing/restarting, not update checks, notifications, or manual update actions. Continue updating through Nix. Plain `nix run` and profile installations do not merge settings; disable automatic updates in Trader's GUI yourself or use a module. Changing this option requires no frontend or Rust recompilation.

### KDE rules and cleanup

The helper uses KDE's `kreadconfig6`/`kwriteconfig6` tools to merge stable, module-owned groups into `kwinrulesrc`. It preserves unrelated rules and their order, and applies the rules before Trader starts. When available, it requests a KWin reconfigure on the session bus. It refuses to edit a symlinked configuration already owned by another declarative system, such as plasma-manager; integrate the equivalent rules with that owner instead.

No Wine, Lutris, D2GL, resolution, or cursor settings are modified. Window rules address startup desktop state and stacking, not every cursor-capture, click-through, Gamescope, or overlay-input issue. The game is not autostarted. Disable old manually created duplicate rules yourself; the module never deletes them. Close the Window Rules editor while applying changes so it does not overwrite the new state with an old snapshot.

- **Home Manager:** turn a flag off and switch to retire that owned rule. To remove all integration, set `enable = false` and switch once while the module remains imported; then remove the import.
- **NixOS:** KDE changes apply at the next graphical login, or when the user restarts the rules service. Before disabling or removing the module, set both `kde` flags to `false` and rebuild while keeping `enable = true`. Then let the helper run once for each affected user (log in again or restart the rules service). Disabling the module removes the helper, so it can no longer clean up. Root activation deliberately does not modify home directories.

For immediate service startup and log commands after switching your configuration, see [Session services and logs](troubleshooting.md#session-services-and-logs).
