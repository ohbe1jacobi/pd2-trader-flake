# Contributing

[README](README.md) · [Maintainer guide](docs/maintaining.md)

This repository packages PD2 Trader; application development happens [upstream](https://github.com/errolgr/pd2-trade). Branch packaging, module, and documentation changes from `develop` and open reviewed PRs back into `develop`. Routine upstream version updates follow the separate [maintainer workflow](docs/maintaining.md#update-the-pinned-release).

See [AGENTS.md](AGENTS.md) for repository conventions, nixpkgs packaging guidelines, and the full verification command list.

## Build or run from a checkout

```bash
nix build
nix run
```

A local upstream checkout is **not** required. Source, frontend dependencies, Cargo dependencies, and Nixpkgs are pinned. The Nixpkgs input targets the stable `nixos-26.05` branch; `flake.lock` pins its resolved revision. To refresh within that release, run `nix flake update nixpkgs`. Moving to another stable release is an explicit input-URL change; Home Manager's test input should stay on the matching release.

## Development shell

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

## Git hooks and commits

The shell integrates `cachix/git-hooks.nix`, pinned in `flake.lock` and using this repository's stable Nixpkgs input. Entering `nix develop` in the checkout installs **pre-commit**, **commit-msg**, and **pre-push** hooks and generates the ignored `.pre-commit-config.yaml` symlink. This manages the checkout's local Git hook configuration; use it in this repository, not an unrelated checkout. An existing non-generated pre-commit config is not overwritten. For tooling that must leave Git configuration alone, use `PD2_TRADER_NO_HOOKS=1 nix develop`.

| Stage | Checks |
| --- | --- |
| Pre-commit | Built-in Nix formatting and existing package lint; Python syntax/error-level Ruff; ShellCheck and shfmt; actionlint; JSON/TOML/YAML syntax; merge markers and whitespace/EOF hygiene |
| Commit-msg | Commitizen validation of Conventional Commit messages |
| Manual only | `nix flake check`: the existing application build/Vitest/Cargo tests, packaging/module/helper contracts, and development-shell contract (including JavaScript syntax) |

The expensive build and integration checks are manual-only locally, not an automatic pre-push requirement. Formatter/hygiene hooks may update affected files, which must then be reviewed and staged again. These hooks target this packaging repository, not the ignored optional upstream application checkout; Rust compilation/tests and the upstream TypeScript build/Vitest suite run through the existing Nix package build. The isolated graphical startup test remains a separate CI/manual command rather than a Git hook.

From the dev shell:

```bash
pre-commit run --all-files
pre-commit run flake-check --hook-stage manual --all-files
cz commit
```

Commits use **Conventional Commits**: `type(scope): description` (scope optional), for example `feat(ci): add build checks`, `fix(runtime): preserve media discovery`, or `docs: explain installation`. Standard types include `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Use `!` for a breaking change. `cz commit` provides an interactive prompt; ordinary `git commit` works with a compliant message too. This does not authorize an agent to commit or push on your behalf.

This uses the project's native flake integration: `git-hooks.lib.x86_64-linux.run` defines `checks.x86_64-linux.pre-commit`, and its `shellHook`/`enabledPackages` integrate with the dev shell. CI runs the same sandboxed pre-commit check. Project-specific hooks run the existing offline release/cache contracts with Node.js and expose `nix flake check` as a manual hook. Commit-msg validation is local; CI does not currently validate historical commit messages.

## Package structure

- `native-package.nix` compiles the frontend and Rust application and embeds the frontend via `tauri/custom-protocol`.
- `package.nix` adds runtime GStreamer core/Base/Good plugin discovery without recompiling Rust for runtime-only corrections.
- GTK3, WebKitGTK 4.1, OpenSSL, GIO networking, and X11 dependencies come from Nixpkgs.
- The dynamically loaded Ayatana tray library is retained in the executable RPATH. Browser children do not inherit AppImage library-path/preload overrides.
- `GDK_BACKEND=x11` is retained for the upstream overlay implementation. Nixpkgs `xdg-open` is provided as a fallback behind desktop helpers.
- The flake also exports `overlays.default` and `packages.x86_64-linux.frontend`.

## Use a separate upstream source checkout

Override the package's existing `source` argument rather than depending on an untracked directory inside this repository. For example, in your module configuration:

```nix
package = inputs.pd2-trader.packages.x86_64-linux.default.override {
  source = /path/to/your/pd2-trade-source;
};
```

This path intentionally imports **application source**, not game data. Both frontend and Rust builds use it. For dependency-lock changes, refresh the relevant npm/Cargo hashes.

For version updates, release/cache automation, permissions, and recovery, see the [maintainer guide](docs/maintaining.md).

## Checks

GitHub Actions runs `.github/workflows/ci.yml` for pushes to `main`/`develop`, PRs, and manual dispatches; feature pushes and tag pushes do not independently compile. Generated bot PR events mirror authoritative exact-head dispatches. Ubuntu x86_64 CI uses the committed lock, shared pre-commit checks, frontend Vitest/native Cargo builds, all flake contracts, and the development-shell test. Graphical startup runs inside a Nix sandbox through `checks.x86_64-linux.cache-smoke`. Builds are serial; no desktop activation or profile installation occurs. Nix may substitute previously checked outputs; that is not a fresh unit-test run. Locally, full checks are manual-only, never a pre-push compilation requirement.

Regular `nix build` builds the frontend with checks enabled: upstream's `npm run test` runs Vitest once, with one worker to limit memory. A failing frontend test fails the build locally and in CI; the native Cargo tests remain enabled as well. To build and test only the frontend, run `nix build .#frontend`. Nix may reuse an already-built checked output rather than rerunning tests on every invocation.

The graphical test checks startup and tray-library loading, not full game, OAuth, or real-desktop integration.

After updating this checkout, re-enter `nix develop` to refresh its generated Git-hook configuration. Full checks remain available with `pre-commit run flake-check --hook-stage manual --all-files`; normal pushes no longer invoke that compilation hook. This does not cancel a build that was already started under the old configuration.

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

`.gitignore` excludes local notes (Markdown except the explicitly allowed public root documents and `docs/` guides), optional upstream checkouts, historical packaging/diagnostics, build outputs, logs, mutable application state, and common secret/editor files. Those local directories are not required by any exported package, module, or check. Keep `AGENTS.md`, `flake.lock`, all root/module Nix files, Python helpers, and test sources tracked. Review the staged file list before committing or pushing; ignore rules are not a substitute for reviewing files already tracked or force-added.
