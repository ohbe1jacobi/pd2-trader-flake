import { openSync, closeSync } from 'node:fs';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { compareVersions, createRequest } from './check-upstream.mjs';
import { eligiblePR, getRef, pages, pinnedAt, sha, sourceAt, validateIssue, validateRun } from './release-lifecycle.mjs';
import { fileHash, validateFiles, withArtifact } from './flatpak-release.mjs';

const repository = 'ohbe1jacobi/pd2-trader-flake';
const root = `/repos/${repository}`;
const limits = { SHA256SUMS: 4096, 'build-info.json': 16 * 1024 };
const bundleLimit = 1536 * 1024 * 1024;
// Reviewed exception, not automated provenance. The commit identifies a dirty
// local checkout's BASE, not the tagged source or a GitHub Actions build.
// The default path excludes it; callers must explicitly opt in. Pin every byte
// through the three API digests, including the original, unmodified metadata.
const manualBootstrap = {
  releaseId: 434361585, version: '0.10.16', tag: 'v0.10.16',
  commit: '44bcc2d0212c1edcaf0eea3e4da7e3bfb7a4ac63',
  bundle: 'pd2-trader-0.10.16-experimental-x86_64.flatpak',
  assets: [
    { id: 717530215, name: 'build-info.json', size: 2049, digest: 'sha256:6a8e249407370376a882899e72d00cf4a6419ed9b81e567faa7aeb3dad5ce7e9' },
    { id: 717530211, name: 'pd2-trader-0.10.16-experimental-x86_64.flatpak', size: 44018792, digest: 'sha256:a43364909232601bf457a6e832f5c6415fb08ea8755c3110d9f474b8d83b9c83' },
    { id: 717530210, name: 'SHA256SUMS', size: 195, digest: 'sha256:2e2d9835008721e076d8b993025caaa3b5a7b2ed107913c0dcd22773aae69a68' },
  ],
};
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const assetIdentity = asset => ({ id: asset.id, name: asset.name, size: asset.size, state: asset.state, digest: asset.digest });
const releaseIdentity = release => Object.fromEntries(['id', 'tag_name', 'name', 'body', 'draft', 'prerelease', 'published_at', 'created_at', 'target_commitish'].map(key => [key, release?.[key]]));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validateAssets(assets, bundle) {
  const names = ['SHA256SUMS', 'build-info.json', bundle].sort();
  if (!equal(assets.map(asset => asset.name).sort(), names) || new Set(assets.map(asset => asset.id)).size !== 3) throw new Error('Unexpected release asset set');
  for (const asset of assets) {
    if (!positiveId(asset.id) || asset.state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
        !positiveId(asset.size) || asset.size > (limits[asset.name] ?? bundleLimit)) throw new Error('Invalid release asset identity/digest/size limit');
  }
}

export function reviewedManualRelease(release, assets) {
  if (release?.id !== manualBootstrap.releaseId || release.tag_name !== manualBootstrap.tag ||
      release.draft !== false || release.prerelease !== false) throw new Error('Unreviewed manual bootstrap release');
  validateAssets(assets, manualBootstrap.bundle);
  for (const pin of manualBootstrap.assets) {
    const asset = assets.find(item => item.id === pin.id);
    if (!asset || Object.entries(pin).some(([key, value]) => asset[key] !== value)) throw new Error('Manual bootstrap asset pin mismatch');
  }
  return { version: manualBootstrap.version, bundle: manualBootstrap.bundle, commit: manualBootstrap.commit };
}

export function manifestRelease(expected, sha256, manual = false) {
  return { version: expected.version, bundle: `pd2-trader-${expected.version}-x86_64.flatpak`,
    sha256, commit: expected.commit, provenance: manual ? 'reviewed-local-bootstrap' : 'github-actions' };
}

async function verifyReadback(request, release, assets, ref, tag) {
  for (const endpoint of [`${root}/releases/${release.id}`, `${root}/releases/tags/${release.tag_name}`]) {
    if (!equal(releaseIdentity(await request(endpoint)), releaseIdentity(release))) throw new Error('Release identity changed during download');
  }
  const listed = await pages(request, `${root}/releases/${release.id}/assets`);
  const identities = items => items.map(assetIdentity).sort((a, b) => a.id - b.id);
  if (!equal(identities(listed), identities(assets))) throw new Error('Release asset list changed during download');
  for (const asset of assets) {
    if (!equal(assetIdentity(await request(`${root}/releases/assets/${asset.id}`)), assetIdentity(asset))) throw new Error('Release asset identity changed during download');
  }
  const current = await getRef(request, repository, 'tags', release.tag_name);
  if (!equal(current, ref)) throw new Error('Annotated tag ref changed during download');
  if (!equal(await request(`${root}/git/tags/${sha(ref.object.sha)}`), tag)) throw new Error('Annotated tag object changed during download');
}

export function stableReleases(items) {
  const stable = items.filter(item => item?.draft === false && item.prerelease === false &&
    typeof item.published_at === 'string' && Number.isFinite(Date.parse(item.published_at)) &&
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(item.tag_name ?? ''));
  if (!stable.length) throw new Error('No published stable release');
  if (new Set(stable.map(item => item.tag_name)).size !== stable.length) throw new Error('Duplicate stable release');
  return stable.sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)));
}

async function trustedRelease(request, release) {
  const version = release.tag_name.slice(1);
  const ref = await getRef(request, repository, 'tags', release.tag_name);
  if (ref?.object?.type !== 'tag') throw new Error('Expected annotated version tag');
  const tag = await request(`${root}/git/tags/${sha(ref.object.sha)}`);
  if (tag.sha !== ref.object.sha || tag.tag !== release.tag_name || tag.message?.trim() !== `PD2 Trader ${version}` || tag.object?.type !== 'commit') throw new Error('Tag target/annotation mismatch');
  const commit = sha(tag.object.sha);
  const evidence = [...(release.body ?? '').matchAll(/^CI: https:\/\/github\.com\/ohbe1jacobi\/pd2-trader-flake\/actions\/runs\/([1-9]\d*)\/attempts\/([1-9]\d*)$/gm)];
  if (evidence.length !== 1) throw new Error('Missing/ambiguous release CI provenance');
  const id = Number(evidence[0][1]), runAttempt = Number(evidence[0][2]);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(runAttempt)) throw new Error('Invalid CI run identity');
  const workflow = await request(`${root}/actions/workflows/ci.yml`);
  if (!positiveId(workflow?.id)) throw new Error('Invalid CI workflow identity');
  const expectedRun = { id, run_attempt: runAttempt, head_sha: commit };
  validateRun(expectedRun, await request(`${root}/actions/runs/${id}/attempts/${runAttempt}`), workflow.id, repository);
  validateRun(expectedRun, await request(`${root}/actions/runs/${id}`), workflow.id, repository);
  const jobs = [];
  let totalJobs;
  for (let page = 1; ; page++) {
    const batch = await request(`${root}/actions/runs/${id}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(batch.jobs) || !Number.isSafeInteger(batch.total_count) || batch.total_count < 0 ||
        (totalJobs !== undefined && totalJobs !== batch.total_count)) throw new Error('Invalid CI jobs pagination');
    totalJobs = batch.total_count;
    jobs.push(...batch.jobs);
    if (jobs.length > totalJobs) throw new Error('Contradictory CI jobs pagination');
    if (jobs.length === totalJobs) break;
    if (!batch.jobs.length) throw new Error('Incomplete CI jobs');
  }
  const builds = jobs.filter(job => job.name === 'Nix build and tests (x86_64-linux)');
  if (builds.length !== 1 || builds[0].status !== 'completed' || builds[0].conclusion !== 'success') throw new Error('Missing successful CI build job');
  for (const name of ['Check Flatpak launcher contract', 'Build Flatpak bundle with verified runtime discovery', 'Upload Flatpak artifact']) {
    const steps = (builds[0].steps ?? []).filter(step => step.name === name);
    if (steps.length !== 1 || steps[0].conclusion !== 'success') throw new Error('Missing successful Flatpak CI step');
  }
  const candidates = [];
  for (const item of await pages(request, `${root}/commits/${commit}/pulls`)) {
    if (!positiveId(item.number)) throw new Error('Invalid release PR ID');
    const pr = await request(`${root}/pulls/${item.number}`);
    if (pr.number !== item.number) throw new Error('Release PR identity mismatch');
    const metadata = eligiblePR(pr, 'main', commit, repository);
    if (metadata) candidates.push(metadata);
  }
  if (candidates.length !== 1 || candidates[0].version !== version) throw new Error('Missing/ambiguous eligible release PR');
  const issue = await validateIssue(request, repository, version, candidates[0].issue, true);
  if (issue.number !== candidates[0].issue) throw new Error('Tracking issue identity mismatch');
  if (await pinnedAt(request, repository, commit) !== version) throw new Error('Pinned version mismatch');
  const lock = JSON.parse(await sourceAt(request, repository, 'flake.lock', commit));
  const converter = lock.nodes?.[lock.nodes?.[lock.root]?.inputs?.nix2flatpak]?.locked;
  if (converter?.type !== 'github' || converter.owner !== 'neobrain' || converter.repo !== 'nix2flatpak') throw new Error('Unexpected converter source');
  return { ref, tag, run: expectedRun, expected: { schema: 1, version, appId: 'io.github.ohbe1jacobi.PD2Trader', commit,
    converterRevision: sha(converter.rev), runtime: 'org.gnome.Platform/x86_64/51', runId: id,
    runAttempt, bundle: `pd2-trader-${version}-x86_64.flatpak` } };
}

async function downloadFile(runCommand, asset, path) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    const result = runCommand('gh', ['api', `${root}/releases/assets/${asset.id}`, '--method', 'GET',
      '-H', 'Accept: application/octet-stream', '-H', 'X-GitHub-Api-Version: 2022-11-28'],
    { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Asset download failed: ${result.error?.message ?? result.stderr}`);
  } finally { closeSync(fd); }
  if ((await lstat(path)).size !== asset.size || `sha256:${await fileHash(path)}` !== asset.digest) throw new Error('Asset size/digest mismatch');
}

async function requireAbsent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Output directory already exists');
}

// This controller reads API JSON and fixed-name bytes only. Never execute a
// downloaded artifact, candidate repository code, Flatpak, or Nix.
export async function downloadSources({ outputDirectory, request = createRequest(), runCommand = spawnSync, allowManualBootstrap = false }) {
  const output = resolve(outputDirectory);
  await requireAbsent(output);
  const scratch = await mkdtemp(join(dirname(output), '.flatpak-pages-source-'));
  try {
    const staged = join(scratch, 'output');
    await mkdir(staged);
    const releases = stableReleases(await pages(request, `${root}/releases`));
    const manifest = { schema: 1, releases: [] };
    const checks = [];
    // Only historical source-only releases and the known manual v0.10.16
    // may be skipped. A missing newest bundle or invalid bundle provenance
    // must fail closed, never silently roll the public channel backward.
    for (const [index, release] of releases.entries()) {
      const manual = release.tag_name === manualBootstrap.tag;
      if (manual && allowManualBootstrap !== true) continue;
      if (!positiveId(release.id)) throw new Error('Invalid release ID');
      const assets = await pages(request, `${root}/releases/${release.id}/assets`);
      if (assets.length === 0) {
        if (index === 0) throw new Error('Newest stable release has no bundle');
        continue;
      }
      let expected, ref, tag, run;
      if (manual) {
        expected = reviewedManualRelease(release, assets);
        // Snapshot the tag for race detection, but do not claim it targets the
        // dirty local build's base commit or provides CI provenance.
        ref = await getRef(request, repository, 'tags', release.tag_name);
        if (ref?.object?.type !== 'tag') throw new Error('Manual bootstrap expected annotated tag');
        tag = await request(`${root}/git/tags/${sha(ref.object.sha)}`);
        if (tag.sha !== ref.object.sha || tag.tag !== release.tag_name || tag.object?.type !== 'commit') throw new Error('Manual bootstrap tag mismatch');
        sha(tag.object.sha);
      } else {
        validateAssets(assets, `pd2-trader-${release.tag_name.slice(1)}-x86_64.flatpak`);
        ({ expected, ref, tag, run } = await trustedRelease(request, release));
      }
      const directory = join(scratch, release.tag_name);
      await mkdir(directory);
      for (const name of ['SHA256SUMS', 'build-info.json', expected.bundle]) {
        const asset = assets.find(item => item.name === name);
        if (!asset) throw new Error('Missing release asset');
        await downloadFile(runCommand, asset, join(directory, name));
      }
      // Manual metadata bytes have already matched the reviewed SHA-256 pin.
      // Preserve their original schema, including dirty/local-build disclosures;
      // validateFiles still verifies the exact file set and SHA256SUMS.
      const metadata = manual ? JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8')) : expected;
      if (manual && (metadata.version !== expected.version || metadata.commit !== expected.commit || metadata.bundle !== expected.bundle ||
          metadata.workingTreeDirty !== true || metadata.buildOrigin !== 'local Nix output; no GitHub Actions run' ||
          metadata.runtime !== 'org.gnome.Platform/x86_64/51')) throw new Error('Manual bootstrap metadata mismatch');
      const files = await validateFiles(directory, metadata);
      if (!manual) {
        await withArtifact({ request, repository, run, expected, runCommand }, async artifactFiles => {
          const identities = items => items.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
            .sort((a, b) => a.name.localeCompare(b.name));
          if (!equal(identities(files), identities(artifactFiles))) throw new Error('Release files/immutable CI artifact mismatch');
        });
      }
      const check = async () => {
        await verifyReadback(request, release, assets, ref, tag);
        if (!manual && !equal((await trustedRelease(request, release)).expected, expected)) throw new Error('Release provenance changed during download');
      };
      await check();
      checks.push(check);
      const bundle = files.find(file => file.name === expected.bundle);
      const manifestEntry = manifestRelease(expected, bundle.sha256, manual);
      // Canonicalize only our output filename AFTER checking the original
      // metadata and SHA256SUMS. Bundle bytes are never changed.
      await rename(bundle.path, join(staged, manifestEntry.bundle));
      manifest.releases.push(manifestEntry);
      if (manifest.releases.length === 2) break;
    }
    if (!manifest.releases.length) throw new Error('No eligible automated bundle release');
    for (const check of checks) await check();
    const newest = stableReleases(await pages(request, `${root}/releases`))[0];
    if (!equal(releaseIdentity(newest), releaseIdentity(releases[0]))) throw new Error('Newest stable release changed during download');
    manifest.releases.reverse();
    await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest) + '\n', { flag: 'wx' });
    await requireAbsent(output);
    await rename(staged, output);
    return manifest;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !process.env.GH_TOKEN) throw new Error('Usage: GH_TOKEN=… node .github/scripts/flatpak-pages-source.mjs OUTPUT_DIRECTORY');
    console.log(JSON.stringify(await downloadSources({ outputDirectory: process.argv[2],
      allowManualBootstrap: process.env.FLATPAK_PAGES_ALLOW_MANUAL_BOOTSTRAP === 'true' })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
