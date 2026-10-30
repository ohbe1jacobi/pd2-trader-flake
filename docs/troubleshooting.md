# Troubleshooting

[README](../README.md) · [Installation](installation.md) · [Configuration](configuration.md)

## Contents

- [Session services and logs](#session-services-and-logs)
- [Desktop integration and non-NixOS caveats](#desktop-integration-and-non-nixos-caveats)
- [Build parallelism and resource limits](#build-parallelism-and-resource-limits)

## Session services and logs

Close any running Trader before restarting it. These commands apply to module installations, not plain `nix run` or profile installs.

After your normal configuration switch, use these commands in the desktop user's session:

```bash
systemctl --user restart pd2-trader-kde-rules.service
systemctl --user start pd2-trader.service
systemctl --user status pd2-trader.service pd2-trader-kde-rules.service
journalctl --user -u pd2-trader.service -b
```

When `autostart = false`, launch the installed `pd2-trader` command or desktop entry instead.

## Desktop integration and non-NixOS caveats

- **Application menu:** the package includes a desktop entry. Nix's profile `bin` directory must be on `PATH`, and its `share` directory must be in the desktop session's `XDG_DATA_DIRS` for menu discovery. With the standard profile path, these are `~/.nix-profile/bin` and `~/.nix-profile/share`. Follow your Nix installation's session setup and log out/in if needed.
- **Graphics drivers:** Nix-packaged graphical applications on non-NixOS can need a host-driver bridge such as [nixGL](https://github.com/nix-community/nixGL). If you see OpenGL/EGL driver-loading errors, follow nixGL's hardware-specific instructions and use a compatible Nixpkgs version. It is not bundled or configured here; this package has not been verified across every distribution/GPU combination.
- **Wayland:** installing with Nix does not remove the host compositor's input/clipboard restrictions or guarantee compatibility with Gamescope.
- **Settings and startup:** a plain profile installation or `nix run` does **not** enable login startup, manage the Diablo II directory, or install KDE rules; configure the Diablo II directory in Trader. For declarative settings, use the [Home Manager module](installation.md#home-manager). The NixOS module is only for NixOS.

## Build parallelism and resource limits

The native Rust build defaults to `enableParallelBuilding = false` to reduce peak memory use. To opt into parallel compilation, override the **package**, then use Nix's resource settings to choose the amount of parallelism. These are build-time controls, not Trader runtime settings.

### Enable parallel compilation

In a Home Manager or NixOS configuration (with `inputs` in scope):

```nix
programs.pd2-trader.package =
  inputs.pd2-trader.packages.x86_64-linux.default.override {
    enableParallelBuilding = true;
  };
```

If you build the package with your own `pkgs`, apply the same `.override` to that package. It can be combined with the [`source` override](../CONTRIBUTING.md#use-a-separate-upstream-source-checkout).

### Limit cores per build and simultaneous builds

| Control | Meaning |
| --- | --- |
| `enableParallelBuilding` | Package-level opt-in to parallel native compilation; defaults to `false`. |
| `--cores N` | Per-build parallelism budget advertised through `NIX_BUILD_CORES`. This package's Cargo build hook uses that budget for its jobs when parallel building is enabled. |
| `--max-jobs N` / `-j N` | Maximum number of simultaneous local derivation builds, not Rust compiler jobs within a build. Dependencies can be separate derivations. |

**Passing `--cores 4` alone does not enable parallel Rust compilation in this package.** Conversely, `--max-jobs 1` does not make a parallel-enabled compilation serial: one derivation can still use several compiler jobs.

A conservative starting point for parallel compilation is **one build at a time, with two or four jobs inside it**:

```bash
# NixOS: build only; does not activate the configuration.
nixos-rebuild build --flake .#YOUR_HOST --max-jobs 1 --cores 4

# Standalone Home Manager: build only; does not activate it.
home-manager build --flake .#YOUR_USER --max-jobs 1 --cores 4
```

For a low-memory machine, keep the package's serial default and limit other concurrent builds too (`--max-jobs 1 --cores 1`).

`--cores 0` asks Nix to use the detected CPU core count; it is not a low-memory setting. These settings guide cooperative builders, **not hard CPU or RAM limits**. More simultaneous derivations and more jobs per derivation can compound memory pressure. Even a serial Rust build/link can require substantial memory; if builds are killed for running out of memory, lower concurrency first and ensure sufficient RAM/swap. Local settings do not impose equivalent limits on remote builders.

### Persistent Nix settings

On NixOS, declare the defaults in your system configuration:

```nix
nix.settings = {
  max-jobs = 1;
  cores = 4;
};
```

On other systems, the equivalent `nix.conf` settings are:

```ini
max-jobs = 1
cores = 4
```

For a single-user installation, these can go in `~/.config/nix/nix.conf`; multi-user installations also have daemon settings in `/etc/nix/nix.conf`, and daemon policy can restrict client overrides. Command-line flags can override permitted defaults for an individual invocation. These settings affect other Nix builds too, and do not replace this package's explicit parallel-building opt-in.

References: [Nix `cores` setting](https://nix.dev/manual/nix/2.34/command-ref/conf-file.html#conf-cores), [Nix `max-jobs` setting](https://nix.dev/manual/nix/2.34/command-ref/conf-file.html#conf-max-jobs).
