import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const upstream = 'errolgr/pd2-trade';

export function validateVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value ?? '')) throw new Error('Invalid stable version');
  return value;
}
export function compareVersions(left, right) {
  const a = validateVersion(left).split('.').map(BigInt), b = validateVersion(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function readPinnedVersion(source) {
  const matches = [...source.matchAll(/^\s*version = "(\d+\.\d+\.\d+)";\s*$/gm)];
  if (matches.length !== 1) throw new Error('Expected one literal version in native-package.nix');
  return validateVersion(matches[0][1]);
}

export async function checkUpstream({ version, repository, request, dryRun = false }) {
  validateVersion(version);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid repository');
  let release;
  for (let page = 1; ; page++) {
    const batch = await request(`/repos/${upstream}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Expected release array');
    for (const candidate of batch) {
      if (candidate.draft || candidate.prerelease || !/^app-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate.tag_name ?? '')) continue;
      if (!release || compareVersions(candidate.tag_name.slice(5), release.tag_name.slice(5)) > 0) release = candidate;
    }
    if (batch.length < 100) break;
  }
  if (!release || compareVersions(release.tag_name.slice(5), version) <= 0) return { status: 'skipped', reason: 'No newer stable application release' };
  const nextVersion = release.tag_name.slice(5);
  const verifiedRelease = await request(`/repos/${upstream}/releases/tags/app-v${nextVersion}`);
  if (verifiedRelease.tag_name !== release.tag_name || verifiedRelease.draft || verifiedRelease.prerelease) throw new Error('Upstream release validation failed');
  const title = `Update PD2 Trader to ${nextVersion}`;
  // List issues directly rather than using GitHub's eventually indexed search.
  // Include closed issues so a dismissed update is not repeatedly reopened.
  const matches = [];
  for (let page = 1; ; page++) {
    const issues = await request(`/repos/${repository}/issues?state=all&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new Error('Expected issue array');
    matches.push(...issues.filter(issue => !issue.pull_request && issue.title === title));
    if (issues.length < 100) break;
  }
  if (matches.some(issue => issue.state === 'closed')) return { status: 'dismissed', version: nextVersion, issue: matches.find(issue => issue.state === 'closed').number };
  if (matches.length > 1) throw new Error('Ambiguous duplicate tracking issues');
  const body = `A new stable upstream release is available.

- Packaged version: ${version}
- Upstream version: ${nextVersion}
- Release: https://github.com/${upstream}/releases/tag/${release.tag_name}

## Packaging checklist

- [ ] Review the upstream release and changes.
- [ ] Update version in native-package.nix.
- [ ] Refresh source hash, npmDepsHash, and cargoHash as needed.
- [ ] Update the documented packaged version.
- [ ] Run formatting, build/tests, flake contracts, and graphical startup checks.

Preparation is explicitly dispatched for this open issue. Closing the issue dismisses this version; reopen it deliberately to retry. A frozen release/<version> branch starts from main; its single PR into main closes this issue after manual approval. Publication waits for successful CI on the exact merged main commit.
`;
  if (dryRun) return { status: matches.length ? 'would-dispatch' : 'would-create', version: nextVersion, issue: matches[0]?.number, title, body };
  const issue = matches[0] ?? await request(`/repos/${repository}/issues`, { method: 'POST', body: { title, body } });
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Invalid tracking issue number');
  const verified = await request(`/repos/${repository}/issues/${issue.number}`);
  if (verified.pull_request || verified.number !== issue.number || verified.title !== title || verified.state !== 'open') {
    throw new Error('Created issue could not be verified');
  }
  await request(`/repos/${repository}/actions/workflows/prepare-update.yml/dispatches`, {
    method: 'POST', body: { ref: 'main', inputs: { version: nextVersion, issue: String(issue.number) } },
  });
  return { status: matches.length ? 'reused' : 'created', version: nextVersion, issue: verified.number, dispatched: true };
}

export function createRequest(run = spawnSync) {
  return async (path, { method = 'GET', body } = {}) => {
    if (!path.startsWith('/repos/') || /[\r\n]/.test(path)) throw new Error('Invalid GitHub API endpoint');
    const args = ['api', path, '--method', method, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (body !== undefined) args.push('--input', '-');
    const result = run('gh', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      const error = new Error(`GitHub API ${method} ${path}: ${result.error?.message ?? result.stderr}`);
      // gh's HTTP suffix is transport evidence; never infer absence from a
      // generic message, JSON body, spawn error, or arbitrary occurrence of 404.
      const status = !result.error && /(?:^HTTP |\(HTTP )(\d{3})\)?\s*$/.exec(result.stderr ?? '');
      if (status) error.status = Number(status[1]);
      throw error;
    }
    // gh owns authentication, HTTP errors and API version handling. Dispatch
    // succeeds with 204 and no JSON; it must not turn into a false failure.
    return result.stdout?.trim() ? JSON.parse(result.stdout) : null;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
      throw new Error('Set GITHUB_REPOSITORY to owner/repository');
    }
    if (!dryRun && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Run detector on trusted main only');
    if (!dryRun && !process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
    const version = readPinnedVersion(await readFile('native-package.nix', 'utf8'));
    console.log(JSON.stringify(await checkUpstream({
      version, repository, dryRun, request: createRequest(),
    }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
