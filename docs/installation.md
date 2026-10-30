# Installation

[README](../README.md) · [Configuration](configuration.md) · [Troubleshooting](troubleshooting.md)

## Contents

- [Before you start](#before-you-start)
- [Public binary cache](#public-binary-cache)
- [NixOS](#install-on-nixos)
- [Home Manager](#home-manager)
- [Other Linux distributions](#install-with-nix-on-another-linux-distribution)

## Before you start

These apply to every installation method below. For a shorter module setup, see the [README](../README.md#quick-start).

- **Platform:** **x86_64-linux** only; not macOS or ARM. Trader uses X11/XWayland for game detection and overlay/input handling.
- **Game:** install Diablo II/Project Diablo 2 and Wine/Lutris separately. This package does not include, install, or configure the game.
- **Flakes:** the modern `nix-command` and `flakes` features must be enabled (shown per method below).
- **Build cost:** matching CI-built outputs can be downloaded from the opt-in [public binary cache](#public-binary-cache). Cache misses/custom inputs still build from source and can take substantial time, disk space, and memory. Rust compilation is serial by default; see [build resource limits](troubleshooting.md#build-parallelism-and-resource-limits) before increasing concurrency.
- **One instance:** close any running Trader before launching another or relaunching with changed settings. Every method uses the upstream application ID and its existing settings/login storage.
- **Updates** follow this packaging repository's pinned upstream version and dependencies (the `main` branch when installed from GitHub), not arbitrary upstream application releases. Both modules disable automatic in-app updates by default through the saved setting; notifications and manual update actions remain available. Plain package/profile installs do not manage this preference. Use Nix to update, not the in-app updater.
- **Uninstalling** never deletes saved settings/login data or the game.

## Public binary cache

The public cache is `https://pd2-trader-flake.cachix.org`. Downloads need no Cachix account or token. Trusting its signing key authorizes this project's builders to supply binaries; opt in deliberately. This does not replace or disable `cache.nixos.org`.

On **NixOS**, merge these settings into your existing system configuration:

```nix
nix.settings.extra-substituters = [ "https://pd2-trader-flake.cachix.org" ];
nix.settings.extra-trusted-public-keys = [
  "pd2-trader-flake.cachix.org-1:rg+7WukdJd8/1+Ky8c7kUHivrvfcmOPVlGUxz4CqLM4="
];
```

Activate those Nix settings through your normal rebuild workflow **before** expecting an unprivileged command to use the new cache. Adding the settings in the same configuration that first installs Trader does not configure the currently running daemon retroactively.

On **other Linux distributions**, an administrator can add these lines to the daemon's `/etc/nix/nix.conf`, preserving existing settings, then restart the Nix daemon using that installation's service manager:

```ini
extra-substituters = https://pd2-trader-flake.cachix.org
extra-trusted-public-keys = pd2-trader-flake.cachix.org-1:rg+7WukdJd8/1+Ky8c7kUHivrvfcmOPVlGUxz4CqLM4=
```

Direct flake commands also advertise these settings through `nixConfig`; inspect Nix's trust prompt before accepting. `--accept-flake-config` does not let an untrusted client grant its daemon a new substituter/key. A flake used merely as another flake's input does not configure the consuming daemon. Home Manager users should have the daemon administrator enable the cache; do not add all users to `trusted-users` to work around that boundary.

Both **flake-exported modules** default to this flake's locked package; no explicit `programs.pd2-trader.package` assignment is needed. Keep this input's own nixpkgs lock: do not add `pd2-trader.inputs.nixpkgs.follows = "nixpkgs"` if you want matching CI builds. This leaves the rest of your system on its existing nixpkgs. Explicit package overrides remain supported. The overlay and direct module-file imports still build with the consumer's `pkgs` and may miss this cache. Local helper wrappers may differ even when the expensive native application is cached.

Cache entries must match exact build inputs, not just the upstream version. Missing/evicted outputs, custom source/package overrides, and different nixpkgs can still compile. CI uploads only after successful checks; a newly pushed revision may not yet be cached. Cache substitution reuses previously checked outputs; it does not rerun their unit tests or establish reproducibility. No cache write credential belongs in user configuration or the Nix store.

## Install on NixOS

Use the NixOS module for a declarative installation; **Home Manager is not required**. Keep your current desktop, graphics drivers, user accounts, hardware configuration, and `system.stateVersion`.

### 1. Enable Nix commands and flakes

Add this inside your existing NixOS configuration module, usually `/etc/nixos/configuration.nix` (merge it with existing `nix.settings` rather than duplicating an attribute):

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

Apply it **before** adding the Trader flake. If your system still uses channels and has no system flake, use:

```bash
sudo nixos-rebuild switch
```

If your system already uses a flake but flakes are not yet enabled, bootstrap that rebuild with a one-command setting:

```bash
sudo env NIX_CONFIG='extra-experimental-features = nix-command flakes' \
  nixos-rebuild switch --flake /etc/nixos#YOUR_HOST
```

Replace `/etc/nixos` and `YOUR_HOST` with your configuration directory and existing `nixosConfigurations` name. Keep the declarative setting above for future commands; do not edit NixOS-generated `/etc/nix/nix.conf` directly. See the [official flakes guide](https://wiki.nixos.org/wiki/Flakes).

### 2. Add Trader to your system flake

If you already have a `flake.nix`, **merge** the Trader input and module below into it; do not replace your existing inputs, host definitions, or modules. Keep your current Nixpkgs branch and lockfile. The `nixos-26.05` input is an example matching this package's tested release, not an instruction to upgrade or downgrade your system.

If you do not have a system flake yet, create `/etc/nixos/flake.nix` using this structure. It imports your existing `configuration.nix`, which should continue to import your hardware configuration and preserve your other settings:

```nix
{
  description = "NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    pd2-trader.url = "github:ohbe1jacobi/pd2-trader-flake/main";
  };

  outputs = { nixpkgs, pd2-trader, ... }: {
    nixosConfigurations.YOUR_HOST = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        pd2-trader.nixosModules.default
        {
          programs.pd2-trader = {
            enable = true;
            # Actual Diablo II directory: the parent of ProjectD2.
            d2dir = "~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II";
            autostart = true;
          };
        }
      ];
    };
  };
}
```

Replace `YOUR_HOST` with your host's configuration name. Adjust `d2dir` to your actual installation, or set it to `null` to leave the GUI setting unmanaged. See [Options](configuration.md#options) for autostart and the optional KDE rules.

The NixOS module installs Trader **system-wide**: every user gets the package and the same settings, and with `autostart` it starts at every graphical login. For a single user, or different settings per user, use the [Home Manager module](#home-manager) instead. `nixosModules.pd2-trader` is an alias for `nixosModules.default`.

> **Tip:** the example imports the module directly from the `outputs` argument, so it needs no `specialArgs`. To use `inputs.pd2-trader` inside a separate `configuration.nix` instead, bind `outputs = inputs@{ nixpkgs, ... }: ...`, pass `specialArgs = { inherit inputs; };` to `nixosSystem`, and accept `inputs` in that module's arguments.

### 3. Lock, build, and activate

Run these from your **system configuration directory**, not this packaging repository:

```bash
cd /etc/nixos

# Resolve the new input while preserving existing locked inputs.
nix flake lock

# Build first without activating changes.
nixos-rebuild build --flake .#YOUR_HOST --max-jobs 1 --cores 1

# Once the build succeeds, activate the configuration.
sudo nixos-rebuild switch --flake .#YOUR_HOST --max-jobs 1 --cores 1
```

These examples assume your configuration checkout is writable by your user. If `/etc/nixos` is root-owned, use your normal privileged workflow (for example, `sudo nix flake lock`) rather than changing its ownership or permissions. Keep `flake.lock` under version control when using Git.

After activation, launch `pd2-trader` as the configured desktop user, or log out and back in to exercise graphical-login startup. For immediate service startup and diagnostics, see [Session services and logs](troubleshooting.md#session-services-and-logs).

### Update or remove

In your system configuration directory, update only the package input, then rebuild:

```bash
nix flake update pd2-trader
nixos-rebuild build --flake .#YOUR_HOST --max-jobs 1 --cores 1
sudo nixos-rebuild switch --flake .#YOUR_HOST --max-jobs 1 --cores 1
```

To remove the installation, first retire any KDE rules as described in [KDE rules and cleanup](configuration.md#kde-rules-and-cleanup). Then remove the module/input and rebuild.

## Home Manager

Add the flake as an input (or, for a local copy next to your configuration's `flake.nix`, use `inputs.pd2-trader.url = "path:./pd2-trader";`):

```nix
inputs.pd2-trader.url = "github:ohbe1jacobi/pd2-trader-flake/main";
```

Then, with `inputs` in scope:

```nix
{
  imports = [ inputs.pd2-trader.homeManagerModules.default ];
  programs.pd2-trader.enable = true;
}
```

This enables login startup and the default home-relative game path, and disables automatic in-app updates. `homeManagerModules.pd2-trader` is an alias for the same module. It works with standalone Home Manager (including on other distributions, with a working systemd graphical user session) and inside a Home Manager configuration managed by NixOS.

Set `programs.pd2-trader.d2dir` to your actual Diablo II directory as a quoted string, or `null` to manage it in the GUI. See [Game-directory handling](configuration.md#game-directory-handling).

If the import lives in a separate Home Manager module, pass `extraSpecialArgs = { inherit inputs; };` to your existing `home-manager.lib.homeManagerConfiguration`, or set `home-manager.extraSpecialArgs = { inherit inputs; };` when using Home Manager's NixOS integration. Accept `inputs` in that module's arguments. NixOS `specialArgs` alone does not pass arguments into Home Manager modules.

For standalone Home Manager, run these from your existing configuration checkout, replacing `YOUR_USER` with its `homeConfigurations` name:

```bash
# Resolve the new input without updating unrelated locked inputs.
nix flake lock
home-manager build --flake .#YOUR_USER --max-jobs 1 --cores 1
home-manager switch --flake .#YOUR_USER --max-jobs 1 --cores 1
```

When Home Manager is integrated into NixOS, use your normal system rebuild instead. Launch `pd2-trader` or log in again after activation. Do not also enable the standalone NixOS Trader module.

To update, run `nix flake update pd2-trader` in the same configuration checkout, then repeat the build/switch workflow. Before removing the import/input, [retire KDE rules and disable the module](configuration.md#kde-rules-and-cleanup), then switch once while it remains imported. Removing the package does not delete saved settings/login data or the game.

## Install with Nix on another Linux distribution

NixOS is **not required**: you can use the Nix package manager on another Linux distribution without adopting NixOS or Home Manager.

### Prerequisites

1. Install Nix using the [official Linux installation instructions](https://nixos.org/download/), unless your distribution already provides a working installation. Initialize your shell as the installer instructs, then check `nix --version`.
2. Enable the modern Nix commands and flakes. Add this line to `~/.config/nix/nix.conf` (create the file if needed; preserve existing settings):

   ```ini
   extra-experimental-features = nix-command flakes
   ```

   Alternatively, prefix individual commands with `nix --extra-experimental-features 'nix-command flakes'`.
3. Use your normal desktop login, with the host's graphics driver and X11/XWayland available.

Run package commands as your desktop user, **not with `sudo`**. Nix supplies all packaged dependencies; you do not need Rust, Node.js, or GTK development headers from your distribution.

### Run or install

```bash
# Try the stable branch without installing it.
nix run github:ohbe1jacobi/pd2-trader-flake/main#pd2-trader

# Install it into your user profile, then launch it from any directory.
nix profile install github:ohbe1jacobi/pd2-trader-flake/main#pd2-trader
pd2-trader
```

The explicit `main` reference selects the stable branch rather than `develop`. A published tag or commit can be used instead for a fixed version that will not advance through profile upgrades. From a local checkout of **this packaging repository** (not the upstream application source), use `.#pd2-trader` in place of the GitHub reference. Newer Nix versions also call `nix profile install` `nix profile add`.

### Update or remove

```bash
# Find the exact installed profile entry name.
nix profile list

# Refresh this package from its original flake reference.
nix profile upgrade pd2-trader

# Remove the package from your user profile.
nix profile remove pd2-trader
```

Use the name reported by `nix profile list` if it differs. For a local-checkout installation, pull the desired repository changes before upgrading. Removing the profile entry does not immediately garbage-collect its store paths.

For application-menu setup, graphics-driver caveats, and session diagnostics, see [Troubleshooting](troubleshooting.md).
