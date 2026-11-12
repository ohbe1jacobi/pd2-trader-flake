# Maintainer runbook: signed Flatpak publication

[README](../README.md) · [Maintainer guide](maintaining.md) · [Flatpak packaging](flatpak-packaging.md)

**Audience: repository maintainers.** User installation and update instructions
belong in the [repository user guide](flatpak-pages.md), not this runbook.
These procedures configure the publisher; installing Trader requires none of
these GitHub settings or private keys.

The signed repository is hosted on GitHub Pages. Publication is controlled by
repository settings and protected environments, with deployment readback checks.
This pipeline does not change the Nix package or app sandbox.

## Trust and publication model

`.github/workflows/flatpak-pages.yml` follows the completed release controller
or accepts a manual dispatch **on main**. It shares `pd2-release-state`
concurrency with release publication. It does not depend on token-created
`release: published` events triggering another workflow.

The trusted main controller validates published release provenance: annotated
tag, packaging commit, exact successful main CI run and attempt, eligible merged
release PR, tracking issue, and all asset identities/digests/checksums. All three
release files must match the independently downloaded immutable CI artifact by
name, size and SHA-256. Mutable release checksums and a successful CI link alone
are not proof of tested bytes. Downloaded application code is never executed.

An isolated publication runner imports a dedicated key and signs imported bundle
commits plus the repository summary. Nix evaluation and application compilation
never run with that key. Descriptors embed only the exported public key and
provide Flathub runtime discovery.

A deployment reconstructs at most the two newest eligible versions from verified
release assets. The current ref is
`app/io.github.ohbe1jacobi.PD2Trader/x86_64/stable`; archive refs retain commits for
explicit rollback. Complete site bytes must not exceed **900,000,000**. Failure
does not silently discard the predecessor or upload a partial repository.
`channel.json` records retained commits, provenance and size. Pages receives one
complete artifact; post-deployment readback checks channel, summary and signature
digests against that artifact.

### Artifact-retention limitation

Every retained automated version needs its original CI artifact to remain
available and unexpired when reconstructing a deployment. Missing proof blocks
publication, even if the newest version is valid. Configure adequate Actions
artifact retention before releasing; changing retention cannot restore expired
artifacts. Do not fall back to release checksums or relabel a replacement build
as the original. Durable build attestations or another independently
authenticated long-term digest record are not implemented here.

Do not delete or replace retained release assets. Key rotation and channel URL
changes require an explicit trust migration rather than a routine variable edit.

## One-time GitHub setup

Perform this in an authenticated maintainer session. Private keys must never
enter the checkout, Nix expressions/store, artifacts, logs, or chat.

1. In **Settings → Pages**, select **GitHub Actions** as the deployment source.
   The workflow reads existing configuration; it does not enable Pages. Keep the
   site dedicated to the Flatpak remote: another Pages deployment replaces it.
2. Create the **`flatpak-publish`** environment. Restrict deployment branches to
   exact **`main`**, and configure required reviewers. Store a **dedicated,
   unencrypted automation signing key** as environment secret
   **`FLATPAK_GPG_PRIVATE_KEY`**, using its ASCII-armored secret-key export. Do
   not reuse a personal signing key or put a copy in repository-wide secrets.
   Interactive/passphrase-protected keys are not supported by this workflow.
   Protect the offline backup and environment access.
3. Set environment variable **`FLATPAK_GPG_KEY_ID`** to the key's full fingerprint.
   Independently inspect the public key and publish its fingerprint for users.
   Only public material enters the site; private material is removed before
   artifact upload, including on failure.
4. Protect **`github-pages`** for main-branch deployment too. Treat publication
   workflow/controller changes on main as signing-sensitive code requiring review.
5. Set repository variable **`FLATPAK_PAGES_ENABLED=true`** only after setup is
   ready. For the existing local bundle, separately review the bootstrap opt-in
   below. Dispatch **Publish signed Flatpak repository** on **`main`**.
6. Verify the run, live descriptors, `channel.json`, summary and signature readback,
   then exercise a clean client before advertising repository installation.

For an existing dedicated automation key, export directly to GitHub from a
trusted terminal without printing the key. Substitute its actual full fingerprint:

```bash
FINGERPRINT='YOUR_DEDICATED_AUTOMATION_KEY_FULL_FINGERPRINT'
gpg --armor --export-secret-keys "$FINGERPRINT" |
  gh secret set FLATPAK_GPG_PRIVATE_KEY --env flatpak-publish --repo ohbe1jacobi/pd2-trader-flake
```

The ordinary GitHub token requires no additional private-key repository secret.
The signing job has read-only API access; only the separate deployment job gets
`pages: write` and `id-token: write`. The private key is provided only to its
import/signing step. PR and feature-branch builds never receive it or publish.

## Explicit local 0.10.16 bootstrap

The local 0.10.16 bundle is excluded by default. With no eligible automated
bundles, publication fails closed. To deliberately seed the remote,
set repository variable **`FLATPAK_PAGES_ALLOW_MANUAL_BOOTSTRAP=true`**.

This exception accepts only the exact release and asset identities/digests pinned
in `flatpak-pages-source.mjs`; replaced assets are rejected even under the same
filenames. The pinned bundle is 44,018,792 bytes with SHA-256:

```text
a43364909232601bf457a6e832f5c6415fb08ea8755c3110d9f474b8d83b9c83
```

The public provenance label is **`reviewed-local-bootstrap`**, not CI-produced.
Its commit identifies a dirty local build's base checkout, not exact release-tag
source. Original build information remains the source of its limitations.
Signing authenticates those bytes; it does not establish reproducibility,
disable the application's updater, or validate desktop/game integration.
Remove the opt-in once this version is no longer needed for retention. Never
generalize this exception to arbitrary local bundles.

## Failure and recovery

- Do not disable signatures, broaden artifact acceptance, or discard the retained
  predecessor to bypass a validation failure. Failed assembly leaves the previous
  deployment untouched.
- A post-deployment readback failure does **not** prove the prior site was restored:
  deployment may already have changed it. Inspect the actual served bytes and
  Pages deployment before deciding on recovery.
- Keep the signing identity stable. Losing/replacing it requires a documented
  client trust migration, not a silent environment-variable update.
- Disabling `FLATPAK_PAGES_ENABLED` stops new automatic publications; it does not
  remove the deployed site or revoke its key.
- Preserve the 0.10.16 in-app updater warning in the user guide. Flatpak updates
  and the application's self-updater are separate mechanisms.

Synthetic signed install/update/rollback tests validate distribution mechanics,
not Trader GUI/OAuth/audio/game acceptance or a public deployment. The local
0.10.16 download-to-signed-repository probe used only a disposable test key.
