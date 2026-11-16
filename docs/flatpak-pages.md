# Install from the Flatpak repository

[README](../README.md) · [Flatpak user guide](flatpak.md)

Install PD2 Trader from the signed GitHub Pages repository for application
updates through Flatpak. Alternatively, use the
[downloadable bundle instructions](flatpak.md#obtain-and-install-a-bundle).

## Install

Run as your normal desktop user, not with `sudo`:

```bash
flatpak install --user \
  https://ohbe1jacobi.github.io/pd2-trader-flake/io.github.ohbe1jacobi.PD2Trader.flatpakref
```

The descriptor supplies the repository's public signing key and the Flathub
runtime source, and suggests `pd2-trader` as the remote name. Review Flatpak's
repository and runtime confirmation prompts. Verify the signing fingerprint
against the project's independently published fingerprint before accepting it;
do not use `--no-gpg-verify`.

You need a Linux **x86_64** desktop with Flatpak. Trader uses **X11/XWayland**;
installing it through Flatpak does not add native-Wayland game detection.
See the [requirements and limits](flatpak.md#requirements-and-limits), then
[set the game directory](flatpak.md#set-the-game-directory-once).

Use Flatpak, not Trader's in-app updater, to update this installation. Users
still running 0.10.16 should also follow the [legacy updater warning](flatpak.md#legacy-01016-updater-warning).

## Update

Quit Trader completely, including its tray instance, then run:

```bash
flatpak update --user io.github.ohbe1jacobi.PD2Trader
```

## Switch from a downloaded bundle

A standalone-bundle installation may use a different origin. After adding and
verifying the repository above, inspect the current origin:

```bash
flatpak info --user --show-origin io.github.ohbe1jacobi.PD2Trader
```

If necessary, deliberately reinstall from the repository:

```bash
flatpak install --user --reinstall pd2-trader io.github.ohbe1jacobi.PD2Trader//stable
```

Adding a remote alone does not change an existing installation's origin. Verify
the origin afterward. Do not delete application data to change origins; keep
your game-directory override and narrow filesystem permissions.

## Roll back to a retained version

The repository retains at most two versions. Read `channel.json` from the
verified repository site and select the retained version's `ostreeCommit`,
**not** its Git packaging commit. Quit Trader, then run:

```bash
flatpak update --user --commit=RETAINED_OSTREE_COMMIT io.github.ohbe1jacobi.PD2Trader
flatpak info --user --show-commit io.github.ohbe1jacobi.PD2Trader
```

Check that the installed commit matches the requested one. A normal update
returns to the current stable version; rollback does not permanently pin it.
Settings-schema backward compatibility between application releases is not
guaranteed. Keep any private profile backups local and secure.
