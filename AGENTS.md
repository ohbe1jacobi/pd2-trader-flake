# Repository guidance for coding agents

## Scope and project structure

This is an independent Nix packaging/integration repository for PD2 Trader, not the upstream application repository. Follow nixpkgs conventions for package expressions while preserving the standalone flake interface.

- `native-package.nix`: pinned upstream source, npm frontend derivation, Rust build/checks, desktop integration, GTK wrapping, and tray-library RPATH.
- `package.nix`: lightweight runtime wrapper; keep runtime-only changes here when they do not require recompiling Rust.
- `flake.nix` / `flake.lock`: exported packages, overlay, modules, development shell, formatter, and integration checks.
- `git-hooks.nix`: shared local/CI hooks and Conventional Commit validation.
- `modules/`: Home Manager/NixOS adapters and settings/KDE helpers.
- `tests/`: package, runtime, module-evaluation, and helper contracts; isolated graphical startup test.
- `upstream/`, `private/`, historical packaging, and diagnostics are ignored local material. Exported packages/checks must not depend on their presence.

Read the relevant files and call sites before editing. Keep changes focused; do not reformat upstream application sources or unrelated helpers as part of a packaging change. Do not change user settings, activate modules, install profiles, commit, or push unless explicitly asked.

## Authoritative references

Use the current official nixpkgs documentation, not unwritten reviewer preferences:

- [General contribution, formatting, and syntax conventions](https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md#code-conventions)
- [Package naming, metadata, sources, patches, and review checklist](https://github.com/NixOS/nixpkgs/blob/master/pkgs/README.md#conventions)
- [Name-based package layout](https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/README.md)
- [Metadata reference](https://github.com/NixOS/nixpkgs/blob/master/doc/stdenv/meta.chapter.md)
- [Standard build environment](https://github.com/NixOS/nixpkgs/blob/master/doc/stdenv/stdenv.chapter.md)
- [Rust packaging](https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/rust.section.md)
- [Node.js packaging](https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/javascript.section.md)
- [Tauri hook](https://github.com/NixOS/nixpkgs/blob/master/doc/hooks/tauri.section.md)

This guidance was checked against nixpkgs revision `6b8fc0c3aa1ace4900fc66d35f59126c715ac4e8`. Recheck live policy before an upstream submission. Do not confuse current contribution policy with the stable nixpkgs revision locked for this repository's builds. Distinguish mandatory requirements, written preferences, and repository-specific decisions when reporting compliance.

## Formatting and Nix style

- Use the official `nixfmt` from the locked development shell, not nixfmt-classic, alejandra, or hand-aligned formatting. Run `nix fmt`; use `nixfmt --check` for read-only verification.
- Use lowercase, kebab-case file/directory/package names; use lowerCamelCase for ordinary variables. Preserve standard case-sensitive filenames such as `AGENTS.md`, `README.md`, and `LICENSE`.
- List function dependencies explicitly in attribute-set arguments. Avoid catch-all arguments, importing an entire `pkgs` set into package expressions, and broad `with` scopes that hide dependencies.
- Avoid redundant string interpolation; use `lib.optional` / `lib.optionals` for conditional dependency lists.
- Prefer existing nixpkgs builders and hooks over hand-written replacements. Do not introduce dependency `overrideAttrs` workarounds where an explicit supported parameter or a proper dependency fix can express the requirement.
- Put `passthru` before metadata and place `meta` last, including inherited metadata. Formatters do not enforce attribute ordering or all written style guidelines.
- Explain non-default flags, source substitutions, patches, platform restrictions, and disabled checks. Prefer `substituteInPlace --replace-fail` so upstream changes cannot silently invalidate a substitution.

## Derivations, dependencies, and metadata

- Keep `pname` lowercase and version separate. Use a literal `meta.mainProgram = "pd2-trader"`, not `pname`, so executable identity is independent of package naming.
- Keep descriptions factual, concise, capitalized, without a leading article/package name or trailing punctuation. Set the correct homepage, license, and supported platforms.
- This repository intentionally defers `meta.maintainers` until an eventual nixpkgs PR. Do not invent a maintainer or add an empty placeholder list. Before submission, add an actual consenting nixpkgs maintainer and their maintainer-list entry if needed.
- For an upstream nixpkgs submission, use `pkgs/by-name/pd/pd2-trader/package.nix` and keep helper files inside that directory. Do not restructure this standalone repository solely to imitate the nixpkgs monorepo.
- Declare build-machine tools/hooks in `nativeBuildInputs` and linked/runtime libraries in `buildInputs`; distinguish build/host platforms when adding cross-compilation support.
- Do not replace the full `phases` list. When overriding a phase, preserve its corresponding pre/post hooks; prefer targeted hooks when sufficient.
- Preserve the separate npm frontend build and Rust frontend staging. The Rust preBuild hook runs from the source root; `cargoRoot` and `buildAndTestSubdir` identify the Cargo subdirectory and are complementary.
- Preserve GTK/GIO wrapping, the fallback desktop-helper PATH, GStreamer discovery, and the executable RPATH for the dynamically loaded Ayatana tray library. Do not restore AppImage runtimes, host `/usr/lib` dependencies, or global `LD_LIBRARY_PATH` / `LD_PRELOAD` workarounds.
- Keep support claims limited to tested platforms. The current exported package targets `x86_64-linux` and uses X11/XWayland; do not claim macOS, ARM, pure Wayland, or cross-compilation support without evidence.

## Sources, purity, and reproducibility

- Fetch from the official upstream with appropriate nixpkgs fetchers. Keep SHA-256 source, npm dependency, and Cargo dependency hashes explicit and valid; never leave fake hashes or bypass hash verification.
- Versioned tags with fixed content hashes are acceptable; changed tag contents must fail verification. If using a commit revision, use the full commit hash, not an abbreviated revision.
- Preserve the named stable nixpkgs input and committed lockfile. Change the release branch deliberately; do not silently switch to unstable, update unrelated inputs, or remove the lockfile.
- Keep default builds independent of working-directory state, ignored checkouts, network access during ordinary build phases, timestamps, and host environment variables. Do not introduce import-from-derivation, impure source discovery, or secrets into the Nix store.
- Preserve the explicit `source` override for optional application-source development and its clean-source filtering. Never import Diablo II/game data into a derivation.
- Test under sandboxing. Fixed inputs and identical store paths alone do not establish byte-for-byte reproducibility.
- `nix build --rebuild` compares the requested derivation, not all its dependencies. Rebuilding the runtime wrapper does not prove frontend/native compilation reproducible; explicitly rebuild those derivations when assessing that claim.
- Check RAM, swap, and free disk before expensive builds. Keep serial native compilation as the default; enable parallel building only through the supported override. `--cores` and `--max-jobs` are cooperative build budgets, not hard memory limits.

## Tests and verification

Keep both frontend and native Rust `doCheck = true`. The frontend check phase runs upstream's non-watch Vitest suite with one worker; Rust uses the standard Cargo check hook. Do not disable tests to make a build green. If a test genuinely requires unavailable hardware, credentials, or a live desktop, reproduce the issue and document the narrowest justified exclusion. Packaging contracts and startup smoke tests do not replace upstream unit tests. Do not report tests as passing unless actually executed; cached outputs are not fresh test runs.

### Git hooks and commit messages

Use the locked `cachix/git-hooks.nix` integration in `git-hooks.nix`. Entering `nix develop` installs the local `pre-commit`, `commit-msg`, and `pre-push` hooks and generates the ignored `.pre-commit-config.yaml` symlink. This intentionally manages the repository's local hook configuration; do not run shell entry in another repository. Set `PD2_TRADER_NO_HOOKS=1` for read-only/CI tooling that must not install hooks. Never stage, commit, or push just to exercise hooks; use synthetic repositories for tests.

- Prefer the built-in hooks and native flake integration (`run`, `shellHook`, and `enabledPackages`), not wrapper programs or a second test runner. Pre-commit covers official nixfmt, the existing package Statix/deadnix policy, Python syntax/error-level Ruff, ShellCheck/shfmt, actionlint, JSON/TOML/YAML syntax, merge markers, and whitespace/EOF hygiene. Fix reported issues; do not bypass hooks to hide failures. Formatter/hygiene hooks may update files; review and restage their changes.
- The pre-push/manual hook calls `nix flake check` directly. The existing check graph covers the application build (including Vitest and Cargo tests), packaging/module/helper contracts, and the development-shell contract (including JavaScript syntax). These expensive checks are deliberately not run on every commit. Run them manually with `pre-commit run flake-check --hook-stage manual --all-files` from the dev shell.
- `checks.x86_64-linux.pre-commit` runs the same pre-commit checks in the Nix sandbox; it does not recursively run the pre-push hook. The isolated graphical startup test remains a separate CI/manual command, not a Git hook.
- Commits in this standalone repository follow **Commitizen / Conventional Commits**: `type(scope): description`, with optional scope and `!` for breaking changes. Examples: `feat(ci): add build checks`, `fix(runtime): preserve media discovery`, and `docs: explain installation`. Use the standard types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Commitizen defaults to `cz_conventional_commits`, so no project configuration file is needed; use `cz commit` for the interactive prompt or write a compliant message directly. `commit-msg` validates the message.
- The eventual nixpkgs monorepo PR uses nixpkgs' own `pd2-trader: ...` convention instead; do not confuse that separate upstream convention with this repository's Conventional Commit policy.

Use the locked tooling and run the checks relevant to the change. From the repository root:

```bash
# Read-only formatting and static lint for the package expressions.
nix develop --command nixfmt --check package.nix native-package.nix tests/build-options.nix
nix develop --command statix check package.nix
nix develop --command statix check native-package.nix
nix develop --command deadnix --fail package.nix native-package.nix

# Evaluate exports, compile/test the package, and run integration contracts.
nix flake check --no-build
nix build --max-jobs 1 --cores 1
nix flake check --max-jobs 1 --cores 1

# Development environment contract; isolated GUI smoke test after building.
nix develop --command bash tests/devshell.sh
nix develop --command node tests/headless-smoke.mjs ./result
```

Use `nix fmt` to apply the repository's formatting. Check formatting on every Nix file changed, not only the example package files above. For focused builds, the flake exposes `checks.x86_64-linux.build-options`, `package-contract`, `frontend-copy`, and `media`, alongside the module/helper checks.

Git-based flakes omit untracked files. A raw `path:.` reference bypasses Git filtering: `.gitignore` does not prevent ignored private files from entering that flake's Nix-store source. If a fresh/uncommitted checkout prevents normal evaluation, first make a separate, sanitized snapshot using an explicit allowlist of the public root files and required module/test sources; exclude private notes, credentials, ignored checkouts, generated files, and symlinks to material outside that allowlist. Evaluate `path:/absolute/path/to/that-snapshot` and disclose the fallback. Do not use a raw path reference to a working tree containing private material, stage files without permission, or add global Git ownership exceptions merely to make testing convenient.

When relevant to a future nixpkgs integration, connect package contracts through `passthru.tests` so nixpkgs review/update CI can discover them; do not claim that flake checks already provide that interface.

Before reporting completion, state which checks actually ran, whether a native source rebuild occurred, and any failures/resource limits. Do not claim unit tests, complete game/OAuth/audio integration, all-platform support, or reproducibility based solely on evaluation, cached outputs, or GUI startup. Update tests for changed behavior and keep public usage guidance accurate.

## Repository hygiene and eventual upstream contributions

Keep `AGENTS.md` public via its explicit `.gitignore` exception. Other ignored Markdown notes, optional upstream source, logs, build outputs, settings/tokens, and private files remain private; never force-add them. Do not read secret environment files or include credentials in logs or store paths.

For an eventual nixpkgs PR, recheck the current contribution policy, add maintainer metadata, use the expected package directory and atomic `pd2-trader: ...` commit messages, and follow applicable human-review/automation-disclosure requirements. Do not create commits, publish a PR, or post automated review output without the user's authorization.
