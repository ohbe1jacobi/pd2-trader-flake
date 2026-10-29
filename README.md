# PD2 Trader for Nix

Unofficial Nix packaging for [PD2 Trader](https://github.com/errolgr/pd2-trade), the trading companion for Project Diablo 2. Builds the pinned upstream **0.10.10** release from TypeScript/React and Rust source, rather than wrapping an AppImage.

Includes Home Manager and standalone NixOS modules for graphical-login startup, a configurable Diablo II directory, and KDE window-rule workarounds.

## Before you start

These apply to every installation method below:

- **Platform:** **x86_64-linux** only; not macOS or ARM. Trader uses X11/XWayland for game detection and overlay/input handling.
- **Game:** install Diablo II/Project Diablo 2 and Wine/Lutris separately. This package does not include, install, or configure the game.
- **Flakes:** the modern `nix-command` and `flakes` features must be enabled (shown per method below).
- **Build cost:** packages are built from source, and the first build can take substantial time, disk space, and memory. Rust compilation is serial by default; see [build resource limits](#build-parallelism-and-resource-limits) before increasing concurrency.
- **One instance:** close any running Trader before launching another or relaunching with changed settings. Every method uses the upstream application ID and its existing settings/login storage.
- **Updates** follow this packaging repository's pinned upstream version and dependencies (the `main` branch when installed from GitHub), not arbitrary upstream application releases. Both modules disable automatic in-app updates by default through the saved setting; notifications and manual update actions remain available. Plain package/profile installs do not manage this preference. Use Nix to update, not the in-app updater.
- **Uninstalling** never deletes saved settings/login data or the game.

## TL;DR install

Add the input to your flake (with flakes already enabled):

```nix
inputs.pd2-trader.url = "github:ohbe1jacobi/pd2-trader-flake/main";
inputs.pd2-trader.inputs.nixpkgs.follows = "nixpkgs";
```

Then, with `inputs` in scope, add this to **either** your NixOS or your Home Manager configuration:

```nix
{
  # NixOS: installs for every user on the machine.
  imports = [ inputs.pd2-trader.nixosModules.default ];
  # Home Manager: installs for one user.
  # imports = [ inputs.pd2-trader.homeManagerModules.default ];

  programs.pd2-trader.enable = true;
  programs.pd2-trader.d2dir = "/path/to/prefix/drive_c/Program Files (x86)/Diablo II";
}
```

`d2dir` is the parent of the `ProjectD2` folder; it contains `Diablo II.exe`.

Rebuild, then launch `pd2-trader` or log in again; Trader starts with your graphical session. Use only one of the two modules. See [Options](#options) for autostart, updates, and KDE rules.

Detailed, step-by-step instructions for [NixOS](#install-on-nixos), [Home Manager](#home-manager), and [other Linux distributions](#install-with-nix-on-another-linux-distribution) follow below.

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
    pd2-trader.inputs.nixpkgs.follows = "nixpkgs";
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

Replace `YOUR_HOST` with your host's configuration name. Adjust `d2dir` to your actual installation, or set it to `null` to leave the GUI setting unmanaged. See [Options](#options) for autostart and the optional KDE rules.

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

After activation, launch `pd2-trader` as the configured desktop user, or log out and back in to exercise graphical-login startup. For immediate service startup and diagnostics, see [KDE rules and cleanup](#kde-rules-and-cleanup).

### Update or remove

In your system configuration directory, update only the package input, then rebuild:

```bash
nix flake update pd2-trader
nixos-rebuild build --flake .#YOUR_HOST --max-jobs 1 --cores 1
sudo nixos-rebuild switch --flake .#YOUR_HOST --max-jobs 1 --cores 1
```

To remove the installation, first retire any KDE rules as described in [KDE rules and cleanup](#kde-rules-and-cleanup). Then remove the module/input and rebuild.

## Home Manager

Add the flake as an input (or, for a local copy next to your configuration's `flake.nix`, use `inputs.pd2-trader.url = "path:./pd2-trader";`):

```nix
inputs.pd2-trader.url = "github:ohbe1jacobi/pd2-trader-flake/main";
inputs.pd2-trader.inputs.nixpkgs.follows = "nixpkgs";
```

Then, with `inputs` in scope:

```nix
{
  imports = [ inputs.pd2-trader.homeManagerModules.default ];
  programs.pd2-trader.enable = true;
}
```

This enables login startup and the default home-relative game path, and disables automatic in-app updates. `homeManagerModules.pd2-trader` is an alias for the same module. It works with standalone Home Manager (including on other distributions, with a working systemd graphical user session) and inside a Home Manager configuration managed by NixOS.

### Shared behavior of both modules

Both the NixOS and Home Manager adapters use **systemd user services**, not root application services. Startup is attached to `graphical-session.target`; services stop with the graphical session. Trader restarts on failure, not after a normal quit. NixOS units apply to every user and inherit the graphical session's desktop-helper PATH.

**Choose one adapter**; do not enable both on the same machine. Both own the same service names, and a user's Home Manager units shadow the system-wide ones. The NixOS module has no Home Manager dependency; the flake's Home Manager input is used for module evaluation tests.

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

### Desktop integration and non-NixOS caveats

- **Application menu:** the package includes a desktop entry. Nix's profile `bin` directory must be on `PATH`, and its `share` directory must be in the desktop session's `XDG_DATA_DIRS` for menu discovery. With the standard profile path, these are `~/.nix-profile/bin` and `~/.nix-profile/share`. Follow your Nix installation's session setup and log out/in if needed.
- **Graphics drivers:** Nix-packaged graphical applications on non-NixOS can need a host-driver bridge such as [nixGL](https://github.com/nix-community/nixGL). If you see OpenGL/EGL driver-loading errors, follow nixGL's hardware-specific instructions and use a compatible Nixpkgs version. It is not bundled or configured here; this package has not been verified across every distribution/GPU combination.
- **Wayland:** installing with Nix does not remove the host compositor's input/clipboard restrictions or guarantee compatibility with Gamescope.
- **Settings and startup:** a plain profile installation or `nix run` does **not** enable login startup, manage the Diablo II directory, or install KDE rules; configure the Diablo II directory in Trader. For declarative settings, use the [Home Manager module](#home-manager). The NixOS module is only for NixOS.

## Options

Under `programs.pd2-trader` in both modules:

| Option | Default | Purpose |
| --- | --- | --- |
| `enable` | `false` | Install the configured package and manage session integration. |
| `autostart` | `true` | Start Trader at graphical login. Disable for manual launch only. |
| `autoUpdateEnabled` | `false` | Merge the automatic-update preference before each launch. `null` leaves the saved GUI preference unmanaged; notifications and manual updates remain available. |
| `d2dir` / `diablo2Directory` | `~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II` | Installation directory, as a quoted string; `d2dir` is an alias. Set `null` to leave the saved GUI setting unmanaged. |
| `package` | Source package built with the consuming configuration's `pkgs` | Override the Trader package. |
| `kde.PD2StartWindowed` | `false` | Start the matched game without fullscreen or either maximization axis, using **Apply Initially**. Later manual fullscreen toggles remain possible. |
| `kde.traderoverlay` | `false` | Force the matched Trader window to **Layer = On-screen display**, skipping the taskbar and window switcher. Does not change the window type. |
| `kde.gameWindowTitle` | `Diablo II` | Exact game title to match. |
| `kde.gameWindowClass` | `steam_app_default` | Exact Wine/X11 game class; override for a different Wine runner. |
| `kde.traderWindowTitle` | `PD2Trader` | Exact Trader window title to match. |

Example in either module:

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

After your normal configuration switch, use these commands in the desktop user's session:

```bash
systemctl --user restart pd2-trader-kde-rules.service
systemctl --user start pd2-trader.service
systemctl --user status pd2-trader.service pd2-trader-kde-rules.service
journalctl --user -u pd2-trader.service -b
```

When `autostart = false`, launch the installed `pd2-trader` command or desktop entry instead.

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

If you build the package with your own `pkgs`, apply the same `.override` to that package. It can be combined with the [`source` override](#use-a-separate-upstream-source-checkout).

For a one-off parallel build from this repository, without editing the flake:

```bash
nix build --impure --expr '
  let flake = builtins.getFlake ("path:" + toString ./.);
  in flake.packages.x86_64-linux.default.override {
    enableParallelBuilding = true;
  }
' --max-jobs 1 --cores 4
```

Here `--impure` permits resolving the current working directory in the expression; it does not change the pinned package sources. The result is available through `./result` as usual. The override changes the native derivation and may require a fresh compilation.

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

## Packaging and development

See [AGENTS.md](AGENTS.md) for repository conventions, nixpkgs packaging guidelines, and the full verification command list.

### Build or run from a checkout

```bash
nix build
nix run
```

A local upstream checkout is **not** required. Source, frontend dependencies, Cargo dependencies, and Nixpkgs are pinned. The Nixpkgs input targets the stable `nixos-26.05` branch; `flake.lock` pins its resolved revision. To refresh within that release, run `nix flake update nixpkgs`. Moving to another stable release is an explicit input-URL change; Home Manager's test input should stay on the matching release.

### Development shell

```bash
nix develop
```

The default `devShells.x86_64-linux.default` provides:

- Python 3 and Ruff for the helpers/tests. Python code currently uses only the standard library; no pip installation or virtual environment is required.
- Nix, nixfmt, nixd, Statix, and deadnix for package/module work.
- Bash, ShellCheck, shfmt, Git, jq, Node.js, and npm.
- Commitizen (`cz`) and Git Flow (`git flow`), explicitly included as shell tools. Entering the shell does not initialize Git Flow or change branches.
- The C compiler and the package's native headers/libraries, including GTK3, WebKitGTK 4.1, OpenSSL, X11, and Ayatana.
- Cargo/rustc inherited from the native build, plus rustfmt, Clippy, and rust-analyzer for an optional upstream source checkout.
- KDE configuration tools, GStreamer tools/plugins, Xvfb, xwininfo, D-Bus, and executable/desktop inspection tools used by the tests.

It does not depend on an `upstream/` directory or install JavaScript dependencies into your checkout. It sets the X11 backend, GIO module discovery, GStreamer plugin discovery, and an Ayatana linker RPATH for local Rust builds, without setting global `LD_LIBRARY_PATH` or `LD_PRELOAD`. It does not install services, change desktop settings, or initialize Git.

### Git hooks and commits

The shell integrates `cachix/git-hooks.nix`, pinned in `flake.lock` and using this repository's stable Nixpkgs input. Entering `nix develop` in the checkout installs **pre-commit**, **commit-msg**, and **pre-push** hooks and generates the ignored `.pre-commit-config.yaml` symlink. This manages the checkout's local Git hook configuration; use it in this repository, not an unrelated checkout. An existing non-generated pre-commit config is not overwritten. For tooling that must leave Git configuration alone, use `PD2_TRADER_NO_HOOKS=1 nix develop`.

| Stage | Checks |
| --- | --- |
| Pre-commit | Built-in Nix formatting and existing package lint; Python syntax/error-level Ruff; ShellCheck and shfmt; actionlint; JSON/TOML/YAML syntax; merge markers and whitespace/EOF hygiene |
| Commit-msg | Commitizen validation of Conventional Commit messages |
| Pre-push / manual | `nix flake check`: the existing application build/Vitest/Cargo tests, packaging/module/helper contracts, and development-shell contract (including JavaScript syntax) |

The expensive build and integration checks are kept out of ordinary commits. Formatter/hygiene hooks may update affected files, which must then be reviewed and staged again. These hooks target this packaging repository, not the ignored optional upstream application checkout; Rust compilation/tests and the upstream TypeScript build/Vitest suite run through the existing Nix package build. The isolated graphical startup test remains a separate CI/manual command rather than a Git hook.

From the dev shell:

```bash
pre-commit run --all-files
pre-commit run flake-check --hook-stage manual --all-files
cz commit
```

Commits use **Conventional Commits**: `type(scope): description` (scope optional), for example `feat(ci): add build checks`, `fix(runtime): preserve media discovery`, or `docs: explain installation`. Standard types include `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Use `!` for a breaking change. `cz commit` provides an interactive prompt; ordinary `git commit` works with a compliant message too. This does not authorize an agent to commit or push on your behalf.

This uses the project's native flake integration: `git-hooks.lib.x86_64-linux.run` defines `checks.x86_64-linux.pre-commit`, and its `shellHook`/`enabledPackages` integrate with the dev shell. CI runs the same sandboxed pre-commit check. The only project-specific hook calls the existing `nix flake check` command; there is no separate test runner. Commit-msg validation is local; CI does not currently validate historical commit messages.

### Package structure

- `native-package.nix` compiles the frontend and Rust application and embeds the frontend via `tauri/custom-protocol`.
- `package.nix` adds runtime GStreamer core/Base/Good plugin discovery without recompiling Rust for runtime-only corrections.
- GTK3, WebKitGTK 4.1, OpenSSL, GIO networking, and X11 dependencies come from Nixpkgs.
- The dynamically loaded Ayatana tray library is retained in the executable RPATH. Browser children do not inherit AppImage library-path/preload overrides.
- `GDK_BACKEND=x11` is retained for the upstream overlay implementation. Nixpkgs `xdg-open` is provided as a fallback behind desktop helpers.
- The flake also exports `overlays.default` and `packages.x86_64-linux.frontend`.

### Use a separate upstream source checkout

Override the package's existing `source` argument rather than depending on an untracked directory inside this repository. For example, in your module configuration:

```nix
package = inputs.pd2-trader.packages.x86_64-linux.default.override {
  source = /path/to/your/pd2-trade-source;
};
```

This path intentionally imports **application source**, not game data. Both frontend and Rust builds use it. For dependency-lock changes, refresh the relevant npm/Cargo hashes.

### Update the pinned release

Application updates follow a reviewed lifecycle: **upstream release → tracking issue → application-update PR into `develop` → tested release snapshot → release PR into `main` → tested annotated tag/GitHub Release → backmerge PR into `develop`**. `main` remains the default and stable branch. Automation prepares changes and publishes after the checks below; it does **not** merge PRs or enable auto-merge. Maintainers explicitly review and merge the update, release, and backmerge PRs.

#### Workflows and review gates

- **Discovery — `.github/workflows/upstream-release.yml`:** **Check upstream release** checks upstream's latest stable release daily at **06:23 UTC**, or by manual dispatch. A newer `app-vX.Y.Z` opens an issue titled `Update PD2 Trader to X.Y.Z`. All pages of open and closed issues are checked: an open issue remains eligible for preparation/retry on later daily runs; a closed issue dismisses that version. Keep the title unchanged. Drafts, prereleases, unrelated tags, and equal/older versions are ignored. API errors fail the run rather than meaning “no update.”
- **Preparation — `.github/workflows/prepare-update.yml`:** the checker explicitly dispatches preparation with the validated version and issue number. Preparation creates `feature/update-pd2-trader-<version>` from `develop`, updates the literal `version` and source `hash`, `npmDepsHash`, and `cargoHash` in `native-package.nix` using `nix-update` 1.16.0 pinned by revision and source hash in `automation-tools.nix`, and updates the documented package version. Fixed-output hashes must match the fetched source and dependency contents; placeholders or guessed hashes are not an acceptable update. This is an **application** update, not a `nix flake update`: generated changes may touch only `native-package.nix` and the README packaged-version reference, keeping **both `flake.nix` and `flake.lock` unchanged**. Preparation opens/reuses the update PR into `develop` and explicitly dispatches existing CI with an `expected_sha` input; CI rejects a moved/mismatched head before building. Failures leave the issue and any existing PR open for diagnosis, not a false completion or automatic merge.
- **Gate 1 — update into `develop`:** review the upstream changes, generated diff, and successful **Build and test** workflow, including the named job **`Nix build and tests (x86_64-linux)`**, before manually merging the application-update PR. Afterward the lifecycle waits for successful **push CI on the actual merged `develop` commit**, not merely the earlier PR head or synthetic PR merge check. That exact tested SHA becomes the frozen release-branch snapshot and the source of a release PR into `main`.
- **Gate 2 — release into `main`:** inspect the frozen release PR and require **`Nix build and tests (x86_64-linux)`** before manually merging it. Publishing waits again for successful **push CI on the actual merged `main` commit**. The tag must point to that exact tested merged SHA, never whatever `main` happens to point to later. A green check for another SHA, an unrelated workflow/job, a failed/skipped/cancelled run, or a pre-merge PR check is not publication authorization.
- **Orchestration — `.github/workflows/release-lifecycle.yml`:** completion of **Build and test** wakes the `workflow_run` orchestrator. It validates the originating repository, event, branch, named successful CI job, exact commit, merged PR, and lifecycle metadata before advancing. Update/release PR bodies carry `<!-- pd2-update:VERSION:ISSUE -->`; release PRs also record `<!-- pd2-tested-develop:SHA:RUN:ATTEMPT -->`. Preserve these markers when editing descriptions. Before publication the controller independently reads that exact successful develop CI attempt, checks its integration PR/version/issue, and proves the release head descends from the tested source. A title, a branch named `release/*`, or a successful main run alone is not sufficient identity.
- **Publication and synchronization:** create an annotated tag object and its `refs/tags/...` reference using `gh api`, the equivalent of `git tag -a` followed by pushing that tag. The conventions are tag `v<version>`, annotation/title `PD2 Trader <version>`, and notes beginning `Nix packaging for upstream PD2 Trader <version>.` Read back the annotation/target, then use `gh release create --verify-tag`; no binary assets are uploaded. Releases use `--latest=false` so a delayed older run cannot steal GitHub's latest-release designation; selecting a latest release remains a maintainer decision. Finally, when the released state is ahead of `develop`, open `feature/backmerge-pd2-trader-<version>` from that exact tested `main` SHA, open a PR into `develop`, and dispatch CI. This also preserves Git Flow ancestry when there were no release-only file fixes. A maintainer reviews and merges it manually. No branches are automatically deleted; remove completed feature/release/backmerge branches only after publication and synchronization, without deleting active work or bypassing protection.

CI still builds the source package with frontend Vitest and native Cargo tests enabled, runs the flake/module/helper contracts and development-shell checks, and exercises isolated graphical startup. The lifecycle gates do not substitute a lightweight metadata test for the existing x86_64-linux build/test job.

#### Repository setup and trust boundary

1. Land the automation, scripts, tests, and CI changes on an **authorized `main`** first. Keep `main` as GitHub's default branch: scheduled workflows and the `workflow_run`/manual-dispatch entry points need their definitions there. Only then bootstrap `develop` from that authorized `main` commit and push it through your normal authorized maintainer workflow. Do not bootstrap from an older remote `main` that lacks the automation, or from an arbitrary unreviewed local checkout.
2. Enable repository Issues and Actions. In **Settings → Actions → General**, allow GitHub Actions to create pull requests, subject to organization policy. Configure branch protection/rulesets for `develop` and `main` to require human review and **`Nix build and tests (x86_64-linux)`**; do not grant automation a review/check bypass. Verify the displayed check name against an actual CI run when configuring the rule.
3. Use the built-in `GITHUB_TOKEN`; `GH_TOKEN` is the environment variable passed to `gh`, not a separately provisioned personal token. Scope permissions per job: discovery needs `contents: read`, `issues: write`, and `actions: write` for preparation dispatch; preparation needs `contents: write`, `pull-requests: write`, issue access, and `actions: write` for CI dispatch; lifecycle orchestration needs `actions: read` to inspect runs/jobs, `contents: write` for release refs/tags/releases, `pull-requests: write` for lifecycle PRs, and issue access for tracking. Any job that dispatches another workflow needs `actions: write`. Read-only CI keeps `contents: read`. Repository/organization policy and rulesets must permit these operations; a YAML permission declaration cannot override a policy denial.
4. Explicit preparation/CI dispatches are part of the protocol. GitHub currently creates **approval-required** runs for `pull_request` events of type `opened`, `synchronize`, or `reopened` caused by `GITHUB_TOKEN`; a user with write access can approve them. Explicit `workflow_dispatch` avoids depending on that approval step. Other token-generated events, including branch/tag pushes, remain suppressed rather than recursively starting ordinary push/tag workflows. Human merges normally start actual merged-commit **push** CI for the two gates. Recovery can rerun that exact run, or dispatch CI on the current `develop`/`main` head with `expected_sha` equal to its actual merged SHA. A dispatch on a feature/release head or an old PR check cannot authorize promotion/publication. During the authorized rehearsal, verify the explicitly dispatched CI check is attached to the intended PR-head SHA and satisfies the configured required check; local mocks cannot prove GitHub's ruleset behavior. Do not bypass protection if another approval-required PR run is pending.
5. Treat `workflow_run` as privileged. The orchestrator checks out and executes the trusted scripts from **`main`**, not code from a PR or the completed run's branch. It obtains identifiers/statuses through GitHub's API and validates them. It does **not** download and execute CI artifacts, source an artifact as shell code, or run an untrusted PR script with write credentials. Ordinary build CI has no release-write permission.
6. Require branches to be up to date before merging, disallow force pushes/deletions of `main` and `develop`, and require maintainer review for workflow/controller changes (for example with CODEOWNERS/rulesets). Preserve normal `feature/*` and `hotfix/*` PR development. The two manual gates depend on configured repository protections, not merely text in a PR description. Tracking issues close through the release PR's `Closes #N` **only when merged into default-branch `main`**; integration descriptions deliberately do not use a closing keyword.

GitHub references: [workflow triggers, schedules, and `workflow_run` security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [triggering workflows and token recursion rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [job-scoped token permissions and `GH_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [annotated tag objects and references](https://docs.github.com/en/rest/git/tags), and [`gh release create --verify-tag`](https://cli.github.com/manual/gh_release_create). Scheduled execution can be delayed; GitHub can disable public-repository schedules after 60 days without activity.

#### Retry and recovery

- **Open issue, missing/failed preparation:** fix the reported cause, then rerun preparation or the upstream checker; an open issue remains retryable on daily checks. Closing the issue deliberately dismisses the version. A failed build leaves its update PR open for a reviewed fix and another CI run. Do not close an issue merely to hide an automation error.
- **Interrupted preparation:** an existing feature branch is reused, never overwritten. Its version, base, and allowed-file diff are checked before PR reuse; existing closed PRs stop for manual investigation rather than being silently reopened. A PR/dispatch failure after branch creation can be retried without regenerating hashes. After the version is already integrated into `develop`, rerun its exact merged CI/controller instead of regenerating the update.
- **Concurrent or stale runs:** generation is serialized per version; short repository-write stages share `pd2-release-state`. Established GitHub concurrency keeps one pending run and can replace an older pending run during a burst (active runs are not canceled). Rerun a canceled pending preparation with the same inputs, or rerun the original exact-SHA CI to regenerate its completion event. A successful but superseded `develop` run is rejected rather than promoting newer untested code; test the current resulting integration commit and inspect its release eligibility. Existing release branches are never silently advanced. The current locked actionlint does not support the newer `queue: max` syntax, so these workflows deliberately retain the supported concurrency syntax rather than disabling lint.
- **Frozen release branch:** preserve the tested snapshot; do not reset it to the latest `develop` or force-push it on a retry. If `main` advances and the release PR conflicts, resolve the conflict deliberately in the release branch, review the changed diff, and run CI again before merging. The resulting merged `main` SHA must pass its own push CI before publication.
- **Tag created, release failed:** rerun the failed lifecycle job after correcting permissions or service errors. Reuse an existing annotated tag only after verifying its target matches the expected tested SHA. A conflicting tag is a hard stop for investigation, not permission to move/delete a published tag. Never remove `--verify-tag` to get around a failure. Verify the release readback before declaring success.
- **Backmerge conflict or failed CI:** leave the backmerge PR open, resolve/review it, rerun CI, and merge manually. A successful release does not mean `develop` is synchronized.
- **No lifecycle advancement:** inspect the CI run's event, branch, exact SHA, named job conclusion, merged PR state, and metadata before rerunning. Do not weaken the gates to compensate for a missing push run. Check Actions permissions, PR-creation policy, branch rules, dispatch inputs, and whether the workflows are on default-branch `main`.

#### Local checks and rollout status

The scripts use Node.js 24 and the checker has no npm dependencies. Run the offline lifecycle tests from this checkout:

```bash
node --test tests/upstream-release.mjs tests/prepare-update.mjs tests/update-integration.mjs tests/release-lifecycle.mjs tests/release-scenarios.mjs
GITHUB_REPOSITORY=ohbe1jacobi/pd2-trader-flake node .github/scripts/check-upstream.mjs --dry-run
```

`check-upstream --dry-run` uses `gh` to read releases and existing issues but does not create an issue or dispatch preparation. Authenticate `gh` for read-only local use; in Actions the job supplies `GH_TOKEN`. For manual packaging, change the literal version in `native-package.nix`, refresh and verify all affected fixed-output hashes using the pinned updater, update the README version, and follow the same PR/build/release gates; do not bypass them with an ad hoc tag.

**Remote rehearsal is pending.** At the implementation checkpoint, only remote `main` was verified over HTTPS; SSH authentication was unavailable. This is not a claim that remote `develop`, branch protection, workflow dispatch, bot PR creation, either merged-commit gate, tag/release publication, or backmerge has been exercised successfully. Complete an authorized end-to-end remote rehearsal before relying on unattended operation; local tests alone cannot establish GitHub policy or token behavior.

### Checks

GitHub Actions runs `.github/workflows/ci.yml` on pushes, pull requests, and manual dispatches. On an Ubuntu x86_64 runner it installs Nix, uses the committed lockfile without updating it, checks Nix formatting/package lint, builds the frontend and native application (including the native Cargo tests), runs all flake contracts and the development-shell test, and launches the isolated graphical startup test. Builds are sandboxed and serial to limit resource use. No deployment, profile installation, or desktop activation is performed.

Regular `nix build` builds the frontend with checks enabled: upstream's `npm run test` runs Vitest once, with one worker to limit memory. A failing frontend test fails the build locally and in CI; the native Cargo tests remain enabled as well. To build and test only the frontend, run `nix build .#frontend`. Nix may reuse an already-built checked output rather than rerunning tests on every invocation.

The graphical test checks startup and tray-library loading, not full game, OAuth, or real-desktop integration.

```bash
nix flake check
nix fmt
```

Checks cover native executable/desktop/icon packaging, GTK/WebKit resolution, tray-library loading, frontend replacement, media decoding to a silent sink, real Home Manager/NixOS module evaluation and rendered units, KDE rule merging, path defaults/aliases/expansion, and preservation of mutable settings. Fixtures use synthetic users and temporary config files; checks do not activate modules or modify a desktop user's settings.

The development shell's tooling contract is also included in `nix flake check`, and can be run alone:

```bash
nix develop --command bash tests/devshell.sh
```

It runs the Python/KDE fixture tests, validates JavaScript syntax and Python error-level lint, checks native pkg-config dependencies, compiles/runs temporary C and Rust probes, and verifies GStreamer element discovery.

Optional isolated graphical startup test, after `nix build`:

```bash
nix develop --command node tests/headless-smoke.mjs ./result
```

This uses a separate Xvfb display, private D-Bus, and temporary HOME/config/cache. It is not a full KDE login, rendered-UI, OAuth, audio-device, or game-integration test; those still need real-desktop verification.

## Repository hygiene

`.gitignore` excludes local notes (Markdown except the root README/license/changelog/AGENTS), optional upstream checkouts, historical packaging/diagnostics, build outputs, logs, mutable application state, and common secret/editor files. Those local directories are not required by any exported package, module, or check. Keep `AGENTS.md`, `flake.lock`, all root/module Nix files, Python helpers, and test sources tracked. Review the staged file list before committing or pushing; ignore rules are not a substitute for reviewing files already tracked or force-added.

## License

The Nix packaging, modules, and helpers are MIT licensed; see [LICENSE](LICENSE). Upstream copyright attribution is retained in the license.

Upstream project: [errolgr/pd2-trade](https://github.com/errolgr/pd2-trade), also MIT licensed. This repository is independent packaging, not an official Project Diablo 2 release.
