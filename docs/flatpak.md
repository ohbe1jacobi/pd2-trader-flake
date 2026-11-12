# Flatpak: user guide

[README](../README.md) · [Repository installation](flatpak-pages.md) · [Flatpak packaging](flatpak-packaging.md)

This is independent packaging of PD2 Trader, not an official upstream or
Flathub release. You do not need Nix to install it. Automated packaging and
release-asset uploads began with **0.11.0**.

Use the [signed repository installation guide](flatpak-pages.md) for installation
and updates through `flatpak update`. Downloadable release bundles are also
available below. Use Flatpak, not the in-app updater, to update this installation.
Never grant writes to `/app` or host-spawning permission to make the updater work.

## Contents

- [Requirements and limits](#requirements-and-limits)
- [Obtain and install a bundle](#obtain-and-install-a-bundle)
- [Set the game directory once](#set-the-game-directory-once)
- [Saved settings and changing installations](#saved-settings-and-changing-installations)
- [Install subsequent bundles](#install-subsequent-bundles)
- [Legacy 0.10.16 updater warning](#legacy-01016-updater-warning)
- [Sandbox and troubleshooting boundaries](#sandbox-and-troubleshooting-boundaries)

## Requirements and limits

- A Linux **x86_64** desktop with Flatpak installed. You do not need Nix or Python
  on the host to run the bundle.
- Trader uses **X11/XWayland** for game-window discovery, global hotkeys and
  synthetic input. Native-Wayland game detection is not supported; Flatpak does
  not remove that upstream limitation. Do not assume every desktop integration
  works merely because the window opens.
- Install Diablo II, Project Diablo 2 and Wine/Proton separately. This bundle
  does not install or configure the game.
- Flatpak obtains the required **GNOME 51 runtime** during installation, even on
  KDE or another non-GNOME desktop. This does not change your desktop environment.

## Obtain and install a bundle

Open the [0.11.0 release](https://github.com/ohbe1jacobi/pd2-trader-flake/releases/tag/v0.11.0)
and download all three assets into one directory:

| Filename | Purpose |
| --- | --- |
| `pd2-trader-0.11.0-x86_64.flatpak` | Linux x86_64 application bundle |
| `SHA256SUMS` | SHA-256 checksums |
| `build-info.json` | Build information |

Download by filename rather than display label. GitHub's automatic source-code
ZIP and tarball are not installable Flatpak bundles.

Verify the downloads from that directory before installing:

```bash
sha256sum --check SHA256SUMS
```

Both checksum entries must report `OK`. The checksum file covers the bundle and
`build-info.json`; checksums detect corruption but do not independently
authenticate the publisher. Build information records the application version,
packaging commit and CI run. Use the signed repository for signature-verified
application updates.

Install the downloaded bundle as your normal desktop user, not with `sudo`:

```bash
flatpak install --user ./pd2-trader-0.11.0-x86_64.flatpak
```

Review and accept Flatpak's runtime download and repository-addition prompts as
needed. No separate GNOME runtime installation command is required. Internet
access is needed unless the required runtime is already installed.

The application ID is `io.github.ohbe1jacobi.PD2Trader`; the Flatpak branch is
`stable`. Downloadable bundles are unsigned; the signed repository is a separate
distribution path. Flathub supplies the runtime, not the Trader application.

## Set the game directory once

**Quit Trader completely before changing configuration**, including any copy
running in the tray or installed through Nix. Set the actual Diablo II game root:
the directory containing `Diablo II.exe` and the `ProjectD2` directory, **not**
the Wine-prefix root, `ProjectD2` itself, or `pd2logs`. Autodetection can select
the wrong Wine-prefix directory.

Replace the example with your absolute installation path. Keep the quoting for
spaces in paths:

```bash
D2DIR="/absolute/path/to/Diablo II"

flatpak override --user \
  --env="PD2_TRADER_D2_DIR=$D2DIR" \
  --filesystem="$D2DIR/ProjectD2/pd2logs:create" \
  io.github.ohbe1jacobi.PD2Trader
```

Both overrides persist across launches, reboots and normal bundle replacements.
Launch from the desktop menu or run:

```bash
flatpak run --user io.github.ohbe1jacobi.PD2Trader
```

No desktop-file edit or repeated setup command is needed. Use Flatpak for updates.

The environment variable selects the game root; **it does not grant filesystem
access**. Likewise, entering a path in Trader's text field grants no access.
The separate, narrow `ProjectD2/pd2logs:create` permission provides read/write
access and allows creation of that log directory. The upstream watcher creates
missing `pd2_chat.log` and `pd2_game.log` files. Do not grant the whole home
directory, Wine prefix or game installation just to read chat logs.

### Saved settings and changing installations

On each launch, a nonempty `PD2_TRADER_D2_DIR` atomically merges only
`diablo2Directory` into the Flatpak-private settings at:

```text
~/.var/app/io.github.ohbe1jacobi.PD2Trader/config/com.pd2-trader.app/settings.json
```

Login data, hotkeys, update preferences and other settings are preserved; an
already matching directory is not rewritten. An active override takes
precedence over GUI changes on the next launch. Absolute paths are recommended;
a literal leading `~/` is supported by the merger, but other relative paths are
rejected. Invalid JSON, symlinked settings or merger failures stop startup
rather than silently replacing the existing profile.

Flatpak has its own application data; existing Nix/Home Manager settings and
chat history are not automatically imported. Do not share settings files or
logs containing login tokens. The watcher starts at the end of the live log;
missing older whispers alone does not show a permission problem.

To move the game, quit Trader, revoke just the old log-directory permission,
then repeat the setup command with the new game root:

```bash
flatpak override --user \
  --nofilesystem="/old/path/to/Diablo II/ProjectD2/pd2logs" \
  io.github.ohbe1jacobi.PD2Trader
```

To stop managing the saved path, quit Trader and remove only the variable:

```bash
flatpak override --user --unset-env=PD2_TRADER_D2_DIR io.github.ohbe1jacobi.PD2Trader
```

Unset or empty values leave the saved directory unmanaged. Removing the variable
does not erase the last saved directory or revoke its filesystem grant. Avoid
resetting unrelated overrides when changing this setup.

## Install subsequent bundles

For updates through `flatpak update`, [switch to the signed repository](flatpak-pages.md#switch-from-a-downloaded-bundle).
To continue installing downloaded bundles instead, obtain the new release's
`pd2-trader-<version>-x86_64.flatpak`, matching `SHA256SUMS` and `build-info.json`,
then verify as above. Quit Trader completely and install the new local file
using the same application ID:

```bash
flatpak install --user --or-update /path/to/new/pd2-trader-VERSION-x86_64.flatpak
```

Review Flatpak's result and confirm the installed version with
`flatpak info --user io.github.ohbe1jacobi.PD2Trader`. Per-user overrides and
app-private settings persist across updates. The repository guide also covers
[rollback to a retained version](flatpak-pages.md#roll-back-to-a-retained-version).

### Legacy 0.10.16 updater warning

For installations still running 0.10.16, disable automatic updates in Trader's
settings and avoid every in-app install/update action, including manual checks,
update toasts and the About page. Disabling automatic updates alone does not
disable those other install paths. The launcher preserves update preferences;
it does not disable the updater and may run before that setting can be changed
on first launch. Upgrade through Flatpak, not the upstream self-installer.

## Sandbox and troubleshooting boundaries

The sandbox permits network, X11, IPC, audio and GPU rendering. It does not
grant blanket home/host access, input devices, host process visibility or full
session/system buses. X11 still permits cross-window inspection, clipboard
access and synthetic input; this is not strong isolation from other X clients.
PulseAudio permission also permits recording, even though Trader uses audio
for notification playback.

If incoming whispers are missing, first check that the configured game root is
the parent of `ProjectD2` and that the narrow log grant matches that exact
installation. Quit before changing it. Do not broaden permissions to compensate
for incorrect autodetection. Browser sign-in, tray visibility, MP3 playback,
hotkeys and game-window integration still require testing on the target desktop;
see the [maintainer acceptance checklist](flatpak-packaging.md#runtime-acceptance).
