# nix2flatpak prototype

Experimental, opt-in conversion of the existing source-built Nix package. The
normal package, upstream tests and default build stay unchanged. CI builds a
candidate bundle; the existing release controller can attach verified assets.
This is independent packaging, not an official upstream or Flathub release.

## Build

Run from the repository root after the new public files are tracked by Git.
Git-based flakes omit untracked files: if `flatpak/prototype.nix` is still
untracked, the normal commands below cannot see it. Do not bypass this with a
raw `path:.` reference; ignored private material would enter the Nix store.

```bash
nix build .#flatpak-prototype --out-link result-flatpak --max-jobs 1 --cores 1 -L
nix build .#flatpak-repo-prototype --out-link result-flatpak-repo --max-jobs 1 --cores 1 -L
```

- App ID: `io.github.ohbe1jacobi.PD2Trader`
- Application branch/architecture: `stable` / `x86_64`
- Runtime: `org.gnome.Platform/x86_64/51` from Flathub (separate download)
- Converter: pinned to `7731e8b3fca73879f8217de5a919c0a5d17303de`
- `nix2flatpak` follows our existing stable nixpkgs; no unstable app rebuild.
- ABI checks are enabled. Do not set `skipAbiChecks` to bypass a failure.

The Flatpak input reuses `package.native` (including its GTK wrapper), not the
outer Nix-only GStreamer wrapper. The Flatpak runtime supplies plugin discovery;
the Nix wrapper's store-specific plugin directories can disappear during
conversion. X11 is selected explicitly in Flatpak metadata. The adapter also
materializes entrypoints to avoid the converter creating dangling launcher links.
Its Flatpak-only launcher reads an optional `PD2_TRADER_D2_DIR` override and uses
the existing settings merger before invoking the unchanged native GTK wrapper.
Python is bundled for that merger; users do not need Python or Nix on the host.

`result-flatpak` contains the `.flatpak` bundle, `flatpak-dir/` for inspection,
and `build-info.json`. The separate `result-flatpak-repo` is an HTTP-servable
OSTree `archive-z2` repository with a summary and application ref. This extra
export is needed because this converter revision discards its temporary repo.
Neither output is signed; the separate repository is not a hosted update channel.

## Test repository discovery without installing anything

Requires Node.js and Flatpak. If those commands are already available:

```bash
node flatpak/probe-bundle.mjs ./result-flatpak
node flatpak/probe-repository.mjs ./result-flatpak-repo
```

Otherwise obtain both tools from the committed nixpkgs input (the regular
development shell does not include Flatpak):

```bash
nix shell --inputs-from . nixpkgs#nodejs nixpkgs#flatpak \
  --command node flatpak/probe-repository.mjs ./result-flatpak-repo
```

The probe requires `TMPDIR` to point to an existing scratch directory. It starts
a loopback-only HTTP server and a temporary Flatpak user installation, adds the
unsigned remote there, lists the app and checks its runtime/architecture/branch.
It then removes the temporary client state. It does not install apps/runtimes,
modify existing remotes, or publish anything. Disabling GPG verification is
limited to this disposable local test, not a recommendation for deployment.
The separate bundle probe checks launcher resolution inside the sandbox's `/app`
namespace, rejects the Nix-only media wrapper, and checks metadata/desktop export.
It also requires the exact tray/single-instance bus policy and rejects extra
session-bus grants, including the unused desktop notification service.
Neither probe launches the application.

## Runtime acceptance

Installation, GNOME 51 runtime setup, persistent `PD2_TRADER_D2_DIR` configuration,
the exact narrow `ProjectD2/pd2logs:create` grant, replacement bundles and cleanup
are documented once in the [Flatpak user guide](../docs/flatpak.md). Follow that
guide only when explicitly ready to modify a desktop installation. There is no
published bundle download or hosted application update channel yet.

> **Pinned 0.10.16 updater warning:** Disable automatic updates and do not use
> manual, toast or About-page install/update actions. The launcher preserves
> update preferences; it does not disable the updater. Disabling automatic
> updates alone does not prevent the other install paths. Use replacement
> Flatpak bundles, never the upstream self-installer.

The sandbox permits network, X11, IPC, audio and GPU rendering. Session-bus access
is limited to talking to `org.kde.StatusNotifierWatcher` and owning the locked
single-instance plugin's `org.com_pd2_trader_app.SingleInstance` name. The latter
also shares the single-instance namespace with a native installation. Notifications
are overlay toasts, not calls to `org.freedesktop.Notifications`.

It does NOT grant blanket home/host access, input devices, host process visibility
or full session/system bus access. X11 itself permits cross-window inspection,
clipboard access and synthetic input; this is not strong isolation from other
clients on the same X server. PulseAudio access also permits recording, although
the inspected application only uses notification playback.

Runtime acceptance checklist (exercise per target desktop):

- Startup and persistent app-private configuration across restarts.
- Browser sign-in via the actual sandbox `xdg-open`/`gio` and plugin anchor route;
  OAuth uses remote polling, not a local callback listener or inbound URI scheme.
- Opening the config directory in the host file manager.
- Tray icon visibility, menu callbacks and watcher restart. The icon is a
  sandbox-local PNG which the host watcher may not be able to resolve.
- Embedded MP3 playback through WebKit/GStreamer, including runtime plugin discovery.
- Narrow log-directory visibility, first-run file creation and live chat watching.
- X11 game discovery/focus, hotkey conflicts, keyboard layouts, clipboard text/PNG
  and synthetic input into Wine/XWayland.
- Two launches and native/Flatpak coexistence for the single-instance guard.

Installing a package or seeing its window is not evidence that those integrations
work. Native-Wayland game window discovery remains an upstream limitation;
conversion cannot fix it. Keep the GNOME runtime regardless of host desktop.
Flatpak uses its own application data directories; existing Nix module settings
are not automatically imported. Do not copy tokens into builds or test fixtures.

## Application self-updates

Flatpak updates must come from replacement bundles or a future signed Flatpak
repository, not upstream AppImage replacement. This prototype has no hosted
application update channel.
The currently pinned 0.10.16 still has startup, manual/toast and About-page install
paths. Merely disabling its automatic-update setting does not disable all of them.
No application-source patch or version bump is included in this prototype.
When bumping the upstream pin, review both user-guide and README version-specific
warnings manually: the version-update automation only changes the single packaged
version reference in the root README, not the Flatpak documentation.

Upstream PR #245 introduces a `self_update_supported` command which probes whether
the update target's containing directory is writable and guards all three install
paths before downloading. Once a release includes it, this should prevent
self-installation in Flatpak's read-only application tree without a downstream
patch. Verify the command returns false inside the converted sandbox, including
the executable target after symlink resolution, and exercise every install action.
Do not assume a writable-mode-bit check alone detects a read-only mount.
The PR's frontend falls back to allowing updates if the command invocation fails,
so command registration and a successful false response are part of acceptance.

Until that release is packaged and verified, self-update handling is an open
production-readiness gate. Never grant writes to `/app` or host spawning to make
the upstream updater work. The upstream release-page toast may still need clearer
Flatpak-specific wording; preventing installation and good update guidance are
separate requirements.

## GitHub Pages is a later publication step

Do not upload this unsigned prototype to Pages. Before enabling publication:

1. Prove runtime and integration behavior with the selected runtime.
2. Create a signing/key-management plan outside Nix derivations; private keys
   must never enter the Nix store, source tree, or untrusted build runner.
3. Publish a signed repository and `.flatpakref`/`.flatpakrepo` descriptors with
   its public key and runtime-repository information.
4. Preserve repository history for updates; do not replace an existing channel
   blindly with independent fresh one-commit repositories. Test v1-to-v2 update
   and rollback behavior with an isolated client.
5. Measure repository growth against current GitHub Pages limits, and explicitly
   handle retention, update summaries, and interrupted/atomic publication.

There is no Pages deployment workflow, hosted remote, or signing key in this
prototype. A conventional source-build manifest
would still be needed if pursuing Flathub's build pipeline.

## Verdict: PARTIAL

Validated with PD2 Trader 0.10.16:

- Converted bundle and separate archive-z2 repository built under Nix sandboxing.
- Bundle structural probe passed, including a launcher regression that first
  reproduced a real dangling `/app/bin/pd2-trader` link before the adapter fix.
- A disposable Flatpak client discovered the expected app, architecture, branch
  and runtime over loopback HTTP. No apps/runtimes were installed by the probe.
- Existing lock nodes remained unchanged; 96 offline tests, flake evaluation,
  and sandboxed dependency-graph/pre-commit checks passed during development.
- The existing native/frontend outputs were reused, not rebuilt or retested.
- The Flatpak-only launcher contract exercises creation, optional overrides,
  settings preservation, idempotence, path validation, invalid/symlink safety,
  HOME fallback, argument forwarding and native exit status with synthetic data.

User-reported testing on one desktop found startup, browser sign-in, tray and game
integration working. Incoming-whisper notifications worked after correcting the
autodetected Wine-prefix path in the private settings, using the narrow log grant.
That test predates the environment-variable launcher; its converted runtime path
still needs a user test after reinstalling this bundle.

Not independently validated across desktops: graphical startup, browser/OAuth,
audio, tray and game integration. Signed distribution, update/rollback and
GitHub Pages publication remain unvalidated.
The converter still reports some references to dropped store paths and cannot
find libstdc++ for that portion of its ABI check. Leaving its checks enabled is
not equivalent to proving every library ABI or runtime integration correct.

Recommendation: manually exercise the runtime acceptance tests before adding
signing and publication. This validates conversion and HTTP repository discovery,
not production readiness.
