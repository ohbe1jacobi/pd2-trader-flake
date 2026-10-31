# Maintainer guide

[README](../README.md) · [Contributing](../CONTRIBUTING.md) · [Installation](installation.md)

## Contents

- [Update the pinned release](#update-the-pinned-release)
- [Workflows and review gates](#workflows-and-review-gates)
- [Repository setup and trust boundary](#repository-setup-and-trust-boundary)
- [Cachix CI setup and isolation](#cachix-ci-setup-and-isolation)
- [Nix dependency graph](#nix-dependency-graph)
- [Retry and recovery](#retry-and-recovery)
- [Local checks and rollout status](#local-checks-and-rollout-status)

## Update the pinned release

Routine upstream updates follow **upstream release → tracking issue → frozen `release/<version>` PR into `main` → manual merge → successful merged-main CI → annotated tag/GitHub Release**. `main` remains the default and stable branch. `develop` is for packaging/features, not an intermediate step for upstream version bumps. Automation never merges PRs or enables auto-merge. Synchronize released changes into `develop` deliberately before a feature release; no per-version backmerge PR is generated.

### Workflows and review gates

- **Discovery — `.github/workflows/upstream-release.yml`:** **Check upstream release** checks upstream's latest stable release daily at **06:23 UTC**, or by manual dispatch. A newer `app-vX.Y.Z` opens an issue titled `Update PD2 Trader to X.Y.Z`. All pages of open and closed issues are checked: an open issue remains eligible for preparation/retry on later daily runs; a closed issue dismisses that version. Keep the title unchanged. Drafts, prereleases, unrelated tags, and equal/older versions are ignored. API errors fail the run rather than meaning “no update.”
- **Preparation — `.github/workflows/prepare-update.yml`:** discovery explicitly dispatches validated `version` and `issue` inputs. Preparation creates `release/<version>` from a recorded exact `main` baseline, updates source/npm/Cargo hashes with the pinned `nix-update` 1.16.0 in `automation-tools.nix`, verifies realized fixed-output contents and repeat-run idempotence, and updates the README packaged-version reference. Generated changes may touch only those literal values in `native-package.nix` and the README reference. **Both `flake.nix` and `flake.lock` stay unchanged; no `nix flake update` runs.** Preparation opens/reuses one PR into `main` and dispatches CI with `expected_sha`; a moved/mismatched head fails before building. A separate trusted-main job waits for successful exact-head CI, rereads its run/attempt, and explicitly dispatches the isolated cache publisher on `main`. It runs outside the short publication lock and never downloads artifacts or executes candidate code. Preparation remains in progress while this job waits; that alone is not a hung build.
- **Manual release gate:** review upstream changes, the generated diff, and **`Nix build and tests (x86_64-linux)`** before merging into `main`. Ordinary feature PRs use PR-triggered CI. Same-repository bot-generated update PR events mirror the exact-head dispatched result rather than compiling a second time; failures/timeouts fail the mirror, never skipped-green. Human update events run the normal checks. For best cache reuse, also wait for **Cache validated generated update** to finish before merging. Cache publication is not a required PR deployment: do not require the `cachix-publish` environment as a pre-merge deployment, since the isolated publisher runs on `main`, not the PR head.
- **Publication gate:** require successful CI on the **actual resulting merged `main` SHA**, not merely the pre-merge head. The `workflow_run` controller checks trusted repository/workflow/event/run attempt/job, eligible merged PR, exact version/issue, recorded baseline, full Git trees/modes, and the narrow generated payload. Preserve `<!-- pd2-update:VERSION:ISSUE -->` and `<!-- pd2-main-base:SHA -->` in release PR bodies. Legacy develop-based provenance fails closed; ordinary feature PRs and arbitrary main changes cannot publish upstream releases.
- **Publication:** create/reuse the annotated tag through `gh api`, verify the exact tested target and annotation, then use `gh release create --verify-tag --latest=true`. Conventions remain `v<version>`, annotation/title `PD2 Trader <version>`, and notes beginning `Nix packaging for upstream PD2 Trader <version>.` No release binary assets are required; installable binaries are served by Cachix. Only the eligible stable version still packaged on current `main` can publish or recover Latest. Every page of published stable version tags is checked, as is the repository's existing Latest designation; a newer version supersedes an older rerun without writes. Drafts, prereleases and unrelated releases are never promoted. An unrelated/invalid existing Latest fails closed for manual investigation. Readback verifies both the exact release-tag endpoint and `/releases/latest`, including identity and release metadata, with bounded retries. Correct existing tags/releases are reused; conflicting ones are never overwritten. A validated existing release missing Latest is repaired with only `make_latest: "true"`; an already-correct retry makes no release write. This repository's Latest selection is separate from upstream release discovery. Shared workflow concurrency serializes automated publishers, but GitHub provides no compare-and-swap Latest update; avoid concurrent manual release changes during publication.
- **Development and cleanup:** packaging/features branch from `develop` and return by reviewed PR. Before a feature release, synchronize released changes and resolve any conflicts deliberately. Use merge commits between long-lived branches to preserve ancestry; identical files do not imply identical commit history. Branch deletion remains a maintainer action after publication; never delete unfinished work just to clear ahead/behind counters.

CI still builds the source package with frontend Vitest and native Cargo tests enabled, runs the flake/module/helper contracts and development-shell checks, and exercises isolated graphical startup. The lifecycle gates do not substitute a lightweight metadata test for the existing x86_64-linux build/test job.

### Repository setup and trust boundary

1. Review these changes through `develop`, then land the reviewed automation on **`main`**. Keep `main` as the default branch: scheduled and privileged completion workflows need their definitions there. Local/feature-branch edits alone do not install the new lifecycle. Finish any in-flight legacy release before switching protocols; do not replace legacy PR provenance to make it appear newly generated.
2. Enable repository Issues and Actions. In **Settings → Actions → General**, allow GitHub Actions to create pull requests, subject to organization policy. Configure branch protection/rulesets for `develop` and `main` to require human review and **`Nix build and tests (x86_64-linux)`**; do not grant automation a review/check bypass. Verify the displayed check name against an actual CI run when configuring the rule.
3. Use the built-in `GITHUB_TOKEN`; `GH_TOKEN` is the environment variable passed to `gh`, not a separately provisioned personal token. Scope permissions per job: discovery needs `contents: read`, `issues: write`, and `actions: write`; the preparation writer needs `contents: write`, `pull-requests: write`, issue access, and `actions: write`; the separate cache handoff needs only `contents: read` and `actions: write`; the publication controller needs `actions: read`, `contents: write`, `pull-requests: read`, and `issues: read`. Failure diagnostics separately need `issues: write`. Ordinary CI needs only `contents: read` and `actions: read`; Cachix uploads use the separate cache token only on isolated upload steps. Repository/organization policy can still deny an operation; YAML permissions cannot override policy.
4. Explicit preparation/CI dispatches remain authoritative for generated updates; do not depend on bot branch/tag pushes starting another workflow. Approval-required bot PR runs may still need a maintainer to approve execution; their mirror reports the exact dispatched build's result. Human merges start merged-commit push CI. Recovery can rerun that exact run or dispatch CI on current `main` with `expected_sha` equal to its actual merged SHA. A release-head dispatch or old PR check cannot authorize publication. Verify required-check association, mirror failure behavior, and repository policy during remote rehearsal; do not bypass protection to hide a pending/failed run.
5. Treat `workflow_run` as privileged. The orchestrator checks out and executes the trusted scripts from **`main`**, not code from a PR or the completed run's branch. It obtains identifiers/statuses through GitHub's API and validates them. It does **not** download and execute CI artifacts, source an artifact as shell code, or run an untrusted PR script with write credentials. Ordinary build CI has no release-write permission.
6. Require up-to-date branches, disallow force pushes/deletions of `main` and `develop`, and require maintainer review for workflow/controller changes (for example with CODEOWNERS/rulesets). Cache uploads trust reviewed pushes on **both** long-lived branches, so both must be protected. The manual merge gate depends on repository rules, not PR prose. Tracking issues close through `Closes #N` when the release PR merges into default-branch `main`.

GitHub references: [workflow triggers, schedules, and `workflow_run` security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [triggering workflows and token recursion rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [job-scoped token permissions and `GH_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [annotated tag objects and references](https://docs.github.com/en/rest/git/tags), and [`gh release create --verify-tag`](https://cli.github.com/manual/gh_release_create). Scheduled execution can be delayed; GitHub can disable public-repository schedules after 60 days without activity.

### Cachix CI setup and isolation

The public cache `pd2-trader-flake` uses the public key in the [installation guide](installation.md#public-binary-cache). **Before enabling uploads**, create the GitHub environment **`cachix-publish`** under Settings → Environments. Select **Selected branches and tags** and add only two **Branch** rules: exact `main` and exact `develop`. Do not allow tags, wildcard branches, release branches, or `refs/pull/*/merge`. Store a cache-specific write token as the environment secret **`CACHIX_AUTH_TOKEN`**. Both publishing jobs reference this environment. Required reviewers are optional; adding them makes each upload wait for approval.

Remove any repository-level copy of `CACHIX_AUTH_TOKEN` and ensure no organization-level copy is accessible to this repository. A workflow `if` condition is not a secret-access boundary: a same-repository PR can edit that condition or reference a repository secret directly. If migrating the earlier repository-secret setup, create a replacement cache-specific token in Cachix, add it only to the restricted environment, revoke the old token, and delete the old repository secret. Never paste tokens into chat/logs, commit them, or pass them to build derivations. Verify the environment branch policies and secret scope in GitHub, then confirm PR refs are denied access during rollout; offline tests cannot establish remote settings. No paid upgrade is assumed or authorized. Check actual cache usage after rehearsal; eviction can turn a later hit into a build.

Build jobs have no cache-write token. Successful protected `main`/`develop` push builds export the application/native/frontend closure as data, and a separate fresh runner imports it and uploads using trusted Cachix tooling. Ordinary PRs only read the public cache. For generated release candidates, **Cache validated generated update** independently validates the successful exact dispatch/attempt, current main parent, complete source tree/modes, and immutable artifact identity; it reconstructs the literal update from trusted main and evaluates expected store roots without executing candidate scripts. Only then does it import the NAR data and give the trusted client the write token. Merely matching an input-addressed store path is not sufficient to trust arbitrary PR outputs.

Generated-cache publication is explicitly dispatched by trusted preparation after CI succeeds; it does not rely on a `workflow_run` following bot-dispatched CI. The completion trigger remains a fallback, with both paths serialized by exact source run/attempt. Repeated valid publications may upload the same verified closure again, never rebuild it or widen its authority. Manual dispatch accepts only `run_id`, `run_attempt`, and `head_sha` lookup hints on `main`; the same independent checks apply to both entry paths. The artifact download uses the verifier's run and artifact IDs, not unchecked dispatch inputs. No PAT, build-job write permission, or release-branch access to the protected environment is needed.

Candidate application startup executes inside the Nix sandbox before artifact export. The privileged publication controller remains separate and never executes build artifacts. Protect both long-lived branches and review all workflow/controller changes; this cache architecture is not permission to run `pull_request_target` builds with secrets.

Wait for the generated candidate's cache workflow to complete **before merging** if you want the merged-main run to reuse it. If main moves or the candidate merges before source authentication, cache publication fails closed; the subsequent protected main build can populate the cache instead. A cache upload failure is not evidence that the application failed its tests; investigate the relevant job and rerun after correcting permissions/service errors. Artifact retention is one day, so an old retry may require rerunning tokenless CI to recreate the transfer. No remote upload or client substitution is established by offline fixtures.

Official references: [Cachix public cache configuration](https://docs.cachix.org/getting-started), [Nix substituters and trust](https://nix.dev/manual/nix/stable/command-ref/conf-file.html), [GitHub environment secret and branch restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), and [GitHub artifact download](https://github.com/actions/download-artifact).

### Nix dependency graph

`.github/workflows/dependency-graph.yml` reuses [sbomnix](https://github.com/tiiuae/sbomnix)
from the committed nixpkgs input and the [SPDX Dependency Submission Action](https://github.com/advanced-security/spdx-dependency-submission-action),
which is listed in [GitHub's dependency submission documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/use-dependency-submission-api).
The submission action is pinned by full commit and uses Node.js 24. No extra
flake input, npm dependencies, PAT, or new service is required.

Two inventories are generated on PRs, pushes to `main`, and manual dispatches:

- **`flake.lock`:** exact locked GitHub revisions, including transitive inputs
  and resolved `follows` edges. A small SPDX adapter handles this lockfile-only
  layer; unsupported source types or malformed pins fail rather than silently
  producing an incomplete inventory. It does not update the lockfile.
- **`native-package.nix`:** sbomnix's complete build-time derivation dependency
  graph for `packages.x86_64-linux.default`, including Nix libraries, compilers,
  build tools, bootstrap components, and the packaging targets. This is **not**
  a measured runtime-only closure or an inventory of every dev-shell tool.
  Evaluation does not compile the application. Source fetching derivations and
  unversioned artifacts without package URLs are excluded from submission;
  dependency paths through them are retained. A small adapter gives sbomnix's
  root the identifier expected by the submission action so direct dependencies
  are recognized, and handles a percent-encoded `+` compatibility issue in the
  pinned submission toolkit. Inventory root packages may also appear in the graph.

**Upstream application lockfile scanning is deliberately excluded.** No npm or
Cargo lockfiles are parsed or copied into this repository. Nix derivations for
frontend/vendor builds can appear, but their individual npm/crate dependencies
are not enumerated. GitHub Actions references remain GitHub's native inventory.
Nix package URLs provide visibility, not a promise of Dependabot vulnerability
coverage or automatic Nix updates.

Generation has only `contents: read`; PRs and feature-branch dispatches only
upload downloadable `nix-dependency-sboms-<attempt>` artifacts (seven-day retention).
A separate fresh runner with `contents: write` submits only this run's immutable
artifact ID on this repository's `main` push/manual dispatch. It rejects stale
main SHAs and never checks out/evaluates candidate code or runs application
artifacts. It uses the built-in `GITHUB_TOKEN`, with separate stable correlators
for the two manifests. No `pull_request_target` or privileged `workflow_run`
handoff is involved. Keep workflow changes under human review and protect main.

**One-time setup:** a repository administrator must enable **Dependency graph**
under **Settings → Advanced Security** (the section can be named **Code security**).
Public repositories normally have it enabled. Organization policy must permit
the pinned actions and the job's `contents: write` permission. Do not broaden
the ordinary build job's token permissions or create a PAT for this workflow.
After landing on `main`, check **Actions → Nix dependency graph**, then
**Insights → Dependency graph → Dependencies** for both submitted manifests.
Dependency graph ingestion may lag the API acceptance. A successful local SBOM
generation does not prove the remote graph is enabled or populated.

Local inspection (writes only beneath a disposable directory):

```bash
node --test tests/dependency-graph.mjs
report_dir=$(mktemp -d)
sbomnix=$(nix build .#sbomnix --no-link --no-update-lock-file --print-out-paths)
drv=$(nix eval --no-update-lock-file --raw .#packages.x86_64-linux.default.drvPath)
"$sbomnix/bin/sbomnix" "$drv" --buildtime --exclude-meta --exclude-cpe-matching \
  --cdx '' --csv '' --spdx "$report_dir/raw.json"
node .github/scripts/prepare-nix-sbom.mjs "$report_dir/raw.json" "$report_dir/package.spdx.json"
node .github/scripts/flake-lock-sbom.mjs flake.lock "$report_dir/inputs.spdx.json"
```

No submission runs locally. For a failed main submission, fix repository policy
or service errors and rerun the failed job while its generation artifact is
retained. An expired artifact needs a full rerun; an old main SHA is deliberately
rejected, so dispatch the workflow on current `main` instead. This reporting
workflow is separate from the release-authorizing **Build and test** workflow
and does not change its required-check or publication gates.

### Retry and recovery

- **Open issue, missing/failed preparation:** fix the reported cause, then rerun preparation or the upstream checker; an open issue remains retryable on daily checks. Closing the issue deliberately dismisses the version. A failed build leaves its update PR open for a reviewed fix and another CI run. Do not close an issue merely to hide an automation error.
- **Interrupted preparation:** reuse an existing release branch only after independently checking its single-parent main ancestry, literal payload, complete Git trees and modes. Never overwrite it or reopen a deliberately closed PR. A failure after branch creation is retryable without regenerating hashes. If already merged, rerun the exact merged-main CI/controller instead of generating another PR.
- **Missing/failed generated-cache handoff:** after the explicit-dispatch workflow is installed on `main`, rerun preparation's failed cache job to repeat only the wait/dispatch, not hash generation or application compilation. It selects the latest exact-head dispatched CI; a newer failed run cannot be hidden by an older success. For an already successful CI run, manually dispatch `cache-generated.yml` on `main` with its exact `run_id`, `run_attempt`, and full `head_sha`. Confirm that run's branch, conclusion, attempt, and unexpired artifact before dispatching. Lookup/dispatch API errors fail the job; a successful dispatch only requests publication, so inspect the separate publisher's result. A changed attempt, expired artifact, moved main, or already-merged candidate fails closed; use the protected-main push uploader after merge rather than weakening source validation.
- **Concurrent or stale runs:** generation is serialized per version; short writers share `pd2-release-state`. GitHub's supported concurrency can replace an older pending run during bursts; rerun that preparation with the same inputs. SHA-scoped CI groups separate different heads. Stale generation or moved branches fail closed; no controller silently advances a frozen candidate.
- **PR mirror timeout:** mirrors poll for up to 270 minutes (190-minute authoritative build plus a bounded queue allowance); PR jobs allow 300 minutes for setup and API overhead. Longer queues/service delays still fail closed. Rerun the mirror after recovering/completing the exact-head dispatch; do not treat its timeout as a successful build.
- **Frozen release branch:** the candidate is one generated update commit atop its recorded main baseline. Manual extra commits, rebases, or conflict fixes may invalidate this strict provenance even if CI passes. If main moves incompatibly, stop for reviewed recovery rather than force-updating the branch or editing its marker. Close/dismiss obsolete candidates deliberately; a newer version can be prepared from current main. The resulting eligible main merge still requires its own successful CI.
- **Tag created, release failed:** rerun the failed lifecycle job after correcting permissions or service errors. Reuse an existing annotated tag only after verifying its target matches the expected tested SHA. A conflicting tag is a hard stop for investigation, not permission to move/delete a published tag. Never remove `--verify-tag` to get around a failure. Recovery also repairs a missing Latest designation for the validated current stable release and verifies `/releases/latest`; an older rerun is reported as superseded rather than displacing a newer release. Notes are preserved: a different original CI run/attempt must independently pass the exact merged-main CI and build-job checks, and the rest of the expected provenance notes must match. Missing, edited or unavailable evidence fails closed for manual investigation. API failures remain failures, not evidence of absence. Existing remote releases are not repaired by local tests; any immediate repair needs separate maintainer authorization.
- **Development synchronization:** no automatic per-release backmerge is opened. Periodically merge released main changes into develop through a reviewed PR, and always account for them before promoting features. Publication does not imply develop has been synchronized.
- **No lifecycle advancement:** inspect the CI run's event, branch, exact SHA, named job conclusion, merged PR state, and metadata before rerunning. Do not weaken the gates to compensate for a missing push run. Check Actions permissions, PR-creation policy, branch rules, dispatch inputs, and whether the workflows are on default-branch `main`.

### Local checks and rollout status

The scripts use Node.js 24 and the checker has no npm dependencies. Run the offline lifecycle tests from this checkout:

```bash
node --test tests/upstream-release.mjs tests/prepare-update.mjs tests/update-integration.mjs tests/release-lifecycle.mjs tests/release-scenarios.mjs tests/cache-ci.mjs
GITHUB_REPOSITORY=ohbe1jacobi/pd2-trader-flake node .github/scripts/check-upstream.mjs --dry-run
```

`check-upstream --dry-run` uses `gh` to read releases and existing issues but does not create an issue or dispatch preparation. Authenticate `gh` for read-only local use; in Actions the job supplies `GH_TOKEN`. For manual packaging, change the literal version in `native-package.nix`, refresh and verify all affected fixed-output hashes using the pinned updater, update the README version, and follow the same PR/build/release gates; do not bypass them with an ad hoc tag.

The original develop-based lifecycle was exercised for 0.10.10, including release publication and manual backmerge. **The revised direct-main lifecycle, Cachix publication/substitution, and CI mirror behavior require a new authorized remote rehearsal.** Offline fixtures are not real GitHub execution. Do not infer cache availability or ruleset compatibility from local tests alone.
