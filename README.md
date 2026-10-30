# PD2 Trader for Nix

Unofficial Nix packaging for [PD2 Trader](https://github.com/errolgr/pd2-trade), the trading companion for Project Diablo 2. Builds the pinned upstream **0.10.12** release from TypeScript/React and Rust source, rather than wrapping an AppImage.

Includes Home Manager and standalone NixOS modules for graphical-login startup, a configurable Diablo II directory, and KDE window-rule workarounds.

> **Using another Linux distribution?** NixOS is not required. Follow [Install with Nix on another Linux distribution](docs/installation.md#install-with-nix-on-another-linux-distribution) for setup, `nix run`, and profile installation.

## Before you start

- Supports **x86_64-linux** with X11/XWayland; not macOS, ARM, or pure Wayland game detection.
- Install Diablo II/Project Diablo 2 and Wine/Proton separately. This package does not install or configure the game.
- Enable Nix's `nix-command` and `flakes` features. The [installation guide](docs/installation.md) covers setup if needed.
- Matching builds can use the opt-in [public binary cache](#binary-cache). Cache misses can require substantial build time, disk space, and memory.

## Quick start

Add this input to your existing flake:

```nix
inputs.pd2-trader.url = "github:ohbe1jacobi/pd2-trader-flake/main";
```

Choose **one** of the following modules. Both examples assume `inputs` is in scope; see the [installation guide](docs/installation.md#install-on-nixos) for a complete system-flake example and argument wiring.

### NixOS

Install system-wide, with shared settings for every user:

```nix
{
  imports = [ inputs.pd2-trader.nixosModules.default ];

  programs.pd2-trader = {
    enable = true;
    d2dir = "/path/to/prefix/drive_c/Program Files (x86)/Diablo II";
  };
}
```

### Home Manager

Install for one user, with that user's settings:

```nix
{
  imports = [ inputs.pd2-trader.homeManagerModules.default ];

  programs.pd2-trader = {
    enable = true;
    d2dir = "/path/to/prefix/drive_c/Program Files (x86)/Diablo II";
  };
}
```

Set `d2dir` to the actual Diablo II directory: the parent of `ProjectD2`, containing `Diablo II.exe`, **not** the Wine prefix. Keep it a quoted string so game files do not enter the Nix store. A leading `~/` is supported; `null` leaves the saved GUI path unmanaged.

Apply your normal NixOS or Home Manager rebuild, then launch `pd2-trader` or log in again. Both modules enable graphical-login startup by default; set `autostart = false` for manual launch. Close any running Trader before relaunching it. KDE workarounds are opt-in; see the [configuration reference](docs/configuration.md).

### Binary cache

The optional public cache is `https://pd2-trader-flake.cachix.org`. Downloads need no account or token, but opting in trusts this project's signing key. Merge this top-level attribute into your own `flake.nix`, beside `inputs` and `outputs`:

```nix
nixConfig = {
  extra-substituters = [ "https://pd2-trader-flake.cachix.org" ];
  extra-trusted-public-keys = [
    "pd2-trader-flake.cachix.org-1:rg+7WukdJd8/1+Ky8c7kUHivrvfcmOPVlGUxz4CqLM4="
  ];
};
```

Review and accept the cache settings when Nix prompts. If Nix reports that it is ignoring the cache or signing key, see [cache setup](docs/installation.md#public-binary-cache).

Both exported modules select the flake's locked package by default; no `package` assignment is needed. Keep this input's own nixpkgs lock: do not add `pd2-trader.inputs.nixpkgs.follows = "nixpkgs"` if you want matching CI builds. This does not change the rest of your system's nixpkgs. Cache misses and custom inputs can still build from source.

## Updating and removing

Use Nix to update Trader, not the in-app updater. Both modules disable automatic in-app updates by default; notifications and manual update actions remain available. Updates follow this repository's pinned upstream release, not every upstream release as soon as it appears.

For module installations, update the input in your configuration checkout, then rebuild normally:

```bash
nix flake update pd2-trader
```

See the [installation guide](docs/installation.md) for removal and profile-install workflows. If you enabled KDE rules, [retire them before removing the module](docs/configuration.md#kde-rules-and-cleanup). Uninstalling does not delete saved settings/login data or the game.

## Documentation

- [Installation](docs/installation.md): detailed NixOS, Home Manager, and other Linux setup, binary cache, updates, and removal.
- [Configuration](docs/configuration.md): module options, game-directory handling, automatic updates, and KDE rules.
- [Troubleshooting](docs/troubleshooting.md): service logs, desktop/graphics caveats, and build resource limits.
- [Contributing](CONTRIBUTING.md): development shell, package structure, hooks, and checks.
- [Maintainer guide](docs/maintaining.md): version updates, release/cache automation, permissions, and recovery.

## License

The Nix packaging, modules, and helpers are MIT licensed; see [LICENSE](LICENSE). Upstream copyright attribution is retained in the license.

Upstream project: [errolgr/pd2-trade](https://github.com/errolgr/pd2-trade), also MIT licensed. This repository is independent packaging, not an official Project Diablo 2 release.
