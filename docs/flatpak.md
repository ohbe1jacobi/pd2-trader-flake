# Flatpak prototype: user guide

This is experimental, independent packaging of PD2 Trader **0.10.16**, not an
official upstream or Flathub release. There is no hosted Flatpak update channel
or published download offered here yet. The commands below assume you have
obtained a local prototype bundle from a trusted builder; see the
[maintainer guide](../flatpak/README.md) for building and validation.

> **Updater warning for 0.10.16:** Disable automatic updates in Trader's settings
> on first launch. **Do not use any in-app install/update action**, including
> manual checks that offer installation, update toasts, or the About page.
> Disabling automatic updates alone does not disable those other install paths.
> Update this installation only with a replacement Flatpak bundle as described
> below. The launcher preserves update preferences; it does not disable the
> updater for you, and it may run before you can change that setting on first
> launch. This is an unresolved limitation, not an enforced protection. Never
> grant writes to `/app` or host-spawning permission to make the updater work.

## Requirements and limits

- A Linux **x86_64** desktop with Flatpak installed. You do not need Nix or Python
  on the host to run the bundle.
- Trader uses **X11/XWayland** for game-window discovery, global hotkeys and
  synthetic input. Native-Wayland game detection is not supported; Flatpak does
  not remove that upstream limitation. Do not assume every desktop integration
  works merely because the window opens.
- Install Diablo II, Project Diablo 2 and Wine/Proton separately. This bundle
  does not install or configure the game.
- Install the **GNOME 51 runtime**, even on KDE or another non-GNOME desktop. It
  is a separate download, not a requirement to switch desktop environments.

## Obtain and install a bundle

Once published, look for `pd2-trader-<version>-x86_64.flatpak` and
`SHA256SUMS` on this repository's [GitHub Releases](https://github.com/ohbe1jacobi/pd2-trader-flake/releases).
Release bundles are not available yet; older releases are not being backfilled.
Download both files into one directory and verify before installing:

```bash
sha256sum --check SHA256SUMS
```

The checksum file also covers `build-info.json`; download that release asset too.
Checksums detect corruption but do not independently authenticate the publisher.

Run as your normal desktop user, not with `sudo`. These commands change your
per-user Flatpak installation. If you do not already have the Flathub remote:

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

Install the runtime and then your trusted local bundle (replace the bundle path):

```bash
flatpak install --user flathub org.gnome.Platform/x86_64/51
flatpak install --user /path/to/pd2-trader-0.10.16-x86_64.flatpak
```

The application ID is `io.github.ohbe1jacobi.PD2Trader`; the prototype branch is
`stable`. The bundle is currently unsigned and is not a production distribution.
Adding Flathub supplies the runtime, not a hosted PD2 Trader update channel.

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

No desktop-file edit or repeated setup command is needed. Remember to disable
automatic updates on first launch and avoid all manual in-app installation.

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

There is **no hosted application update channel** in this prototype. `flatpak
update` can update installed runtimes but does not fetch a new Trader bundle
from this project. Once available, obtain and verify the newer release bundle
as above. Quit
Trader completely and install that local file using the same application ID:

```bash
flatpak install --user --or-update /path/to/new/pd2-trader-VERSION-x86_64.flatpak
```

Review Flatpak's result and confirmation. Replacing one bundle with another and
rollback have not yet been validated for this prototype; do not assume the
replacement succeeded without checking. Per-user overrides and app-private
settings are intended to remain in place. Continue to disable automatic updates
and avoid manual/toast/About installation while running the 0.10.16 build.

## Sandbox and troubleshooting boundaries

The prototype permits network, X11, IPC, audio and GPU rendering. It does not
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
see the [maintainer acceptance checklist](../flatpak/README.md#runtime-acceptance).
