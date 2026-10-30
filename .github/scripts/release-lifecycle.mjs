import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequest, readPinnedVersion } from './check-upstream.mjs';
import { validateGeneratedUpdate } from './prepare-update.mjs';

export function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value ?? '')) throw new Error('Invalid version');
  return value;
}
export function sha(value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('Invalid SHA');
  return value;
}
export function marker(v, issue) {
  version(v);
  if (!Number.isSafeInteger(Number(issue)) || Number(issue) < 1) throw new Error('Invalid issue');
  return `<!-- pd2-update:${v}:${Number(issue)} -->`;
}
export function validateRun(eventRun, run, workflowId, repository) {
  if (run.id !== eventRun.id || run.run_attempt !== eventRun.run_attempt ||
      run.head_sha !== eventRun.head_sha || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml' ||
      run.head_repository?.full_name !== repository ||
      !['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main') {
    throw new Error('Not a current successful trusted CI run');
  }
  return sha(run.head_sha);
}
export function eligiblePR(pr, base, commit, repository) {
  const matches = [...(pr.body ?? '').matchAll(/<!-- pd2-update:((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)):([1-9]\d*) -->/g)];
  if (matches.length !== 1 || !pr.merged || pr.merge_commit_sha !== commit ||
      pr.base?.ref !== base || pr.base.repo.full_name !== repository || pr.head?.repo?.full_name !== repository) return null;
  const [, v, issue] = matches[0];
  if (base !== 'main' || pr.head.ref !== `release/${v}` || !Number.isSafeInteger(Number(issue))) return null;
  return { version: v, issue: Number(issue) };
}
export async function pages(request, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const items = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('Expected paginated array');
    all.push(...items);
    if (items.length < 100) return all;
  }
}
export async function getRef(request, repository, kind, name) {
  const refs = await request(`/repos/${repository}/git/matching-refs/${kind}/${name}`);
  if (!Array.isArray(refs)) throw new Error('Expected refs');
  return refs.find(ref => ref.ref === `refs/${kind}/${name}`);
}
export async function ensureBranch(request, repository, branch, commit) {
  sha(commit);
  const existing = await getRef(request, repository, 'heads', branch);
  if (existing && existing.object.sha !== commit) throw new Error(`Frozen branch conflict: ${branch}`);
  if (!existing) await request(`/repos/${repository}/git/refs`, {
    method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit },
  });
  const verified = await getRef(request, repository, 'heads', branch);
  if (verified?.object.sha !== commit) throw new Error('Branch readback mismatch');
  return verified;
}
export async function ensurePR(request, repository, { head, base, title, body }) {
  const prs = await pages(request, `/repos/${repository}/pulls?state=all&head=${repository.split('/')[0]}:${head}&base=${base}`);
  const matching = prs.filter(pr => pr.head?.ref === head && pr.base?.ref === base && pr.head?.repo?.full_name === repository);
  if (matching.length > 1) throw new Error('Ambiguous existing PRs');
  let pr = matching[0];
  if (pr && pr.state !== 'open') throw new Error('Existing PR closed/merged; manual recovery required');
  if (pr && pr.body !== body) {
    const markers = text => [...(text ?? '').matchAll(/<!-- pd2-(?:update|main-base):[^>]+ -->/g)].map(match => match[0]).sort();
    const expected = markers(body), actual = markers(pr.body);
    if (!expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Existing PR metadata differs; manual recovery required');
    // Keep manual notes and the original successful CI evidence on retries.
    body = pr.body;
  }
  if (!pr) pr = await request(`/repos/${repository}/pulls`, { method: 'POST', body: { head, base, title, body, draft: false, maintainer_can_modify: true } });
  const verified = await request(`/repos/${repository}/pulls/${pr.number}`);
  if (verified.state !== 'open' || verified.head.ref !== head || verified.base.ref !== base || verified.body !== body) throw new Error('PR readback mismatch');
  return verified;
}
export async function dispatchCI(request, repository, branch, commit) {
  const ref = await getRef(request, repository, 'heads', branch);
  if (ref?.object.sha !== commit) throw new Error('Stale branch before CI dispatch');
  // Dispatch at the commit itself: a branch moving between lookup and dispatch
  // must never cause a green run for a different commit to satisfy release checks.
  await request(`/repos/${repository}/actions/workflows/ci.yml/dispatches`, {
    method: 'POST', body: { ref: branch, inputs: { expected_sha: commit } },
  });
}
export async function pinnedAt(request, repository, commit) {
  const content = await request(`/repos/${repository}/contents/native-package.nix?ref=${sha(commit)}`);
  if (content.encoding !== 'base64') throw new Error('Unexpected source encoding');
  return readPinnedVersion(Buffer.from(content.content, 'base64').toString('utf8'));
}
export async function validateIssue(request, repository, v, number, allowClosed = false) {
  marker(v, number);
  const issue = await request(`/repos/${repository}/issues/${Number(number)}`);
  if (issue.pull_request || issue.title !== `Update PD2 Trader to ${v}` ||
      (issue.state !== 'open' && !(allowClosed && issue.state === 'closed' && issue.state_reason === 'completed'))) throw new Error('Dismissed or mismatched tracking issue');
  return issue;
}

export async function publish({ request, repository, version: v, commit, notes, runCommand,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  version(v); sha(commit);
  const tag = `v${v}`;
  const title = `PD2 Trader ${v}`;
  let ref = await getRef(request, repository, 'tags', tag);
  if (!ref) {
    const object = await request(`/repos/${repository}/git/tags`, {
      method: 'POST', body: { tag, message: title, object: commit, type: 'commit' },
    });
    await request(`/repos/${repository}/git/refs`, {
      method: 'POST', body: { ref: `refs/tags/${tag}`, sha: sha(object.sha) },
    });
  }
  ref = await getRef(request, repository, 'tags', tag);
  if (ref?.object.type !== 'tag') throw new Error('Tag conflict: expected annotated tag');
  const object = await request(`/repos/${repository}/git/tags/${sha(ref.object.sha)}`);
  if (object.object?.type !== 'commit' || object.object.sha !== commit || object.tag !== tag || object.message.trim() !== title) throw new Error('Tag conflict: target/annotation mismatch');
  const findRelease = async () => {
    try { return await request(`/repos/${repository}/releases/tags/${tag}`); }
    catch (error) { if (error.status === 404) return null; throw error; }
  };
  let release = await findRelease();
  if (!release) {
    const result = runCommand('gh', ['release', 'create', tag, '--repo', repository,
      '--verify-tag', '--title', title, '--notes', notes, '--latest=false'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Release publication failed: ${result.error?.message ?? result.stderr}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await delay(1000 * 2 ** (attempt - 1));
      try { release = await findRelease(); }
      catch (error) {
        if (![429, 500, 502, 503, 504].includes(error.status) || attempt === 2) throw error;
      }
      if (release) break;
    }
  }
  if (!release) throw new Error(`Release readback absent after bounded retries: ${tag}`);
  const mismatches = [];
  if (release.tag_name !== tag) mismatches.push('tag_name');
  if (release.name !== title) mismatches.push('name');
  if (release.draft !== false) mismatches.push('draft');
  if (release.prerelease !== false) mismatches.push('prerelease');
  if (!release.body?.startsWith(`Nix packaging for upstream PD2 Trader ${v}.`) || !release.body.includes(commit)) mismatches.push('body');
  if (mismatches.length) throw new Error(`Release readback mismatch (${tag}): ${mismatches.join(', ')}`);
  const publishedRef = await getRef(request, repository, 'tags', tag);
  if (publishedRef?.object.type !== 'tag' || publishedRef.object.sha !== ref.object.sha) throw new Error('Published tag target changed');
  return release;
}

async function successfulJobs(request, repository, run) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const batch = await request(`/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...batch.jobs);
    if (jobs.length >= batch.total_count) break;
    if (!batch.jobs.length) throw new Error('Incomplete CI jobs');
  }
  const builds = jobs.filter(job => job.name === 'Nix build and tests (x86_64-linux)');
  // CI also contains an isolated cache uploader. Its presence must neither
  // invalidate a real build nor substitute for a missing/failed build job.
  if (builds.length !== 1 || builds[0].conclusion !== 'success') throw new Error('Missing/mismatched successful CI job');
}

export async function sourceAt(request, repository, path, commit) {
  const file = await request(`/repos/${repository}/contents/${path}?ref=${sha(commit)}`);
  if (file.encoding !== 'base64' || file.type !== 'file') throw new Error('Invalid source file');
  return Buffer.from(file.content, 'base64').toString('utf8');
}

// A frozen update is exactly one commit on a trusted main baseline, with only
// literal application values and the README version changed. Revalidate on
// retries and after merge; a branch name or marker alone is not provenance.
export async function validateUpdateCommit({ request, repository, base, commit, version: v }) {
  sha(base); sha(commit); version(v);
  const object = await request(`/repos/${repository}/git/commits/${commit}`);
  if (object.parents?.length !== 1 || object.parents[0].sha !== base) throw new Error('Frozen branch conflict: update parent differs from main baseline');
  const parent = await request(`/repos/${repository}/git/commits/${base}`);
  const trees = await Promise.all([parent, object].map(item => request(`/repos/${repository}/git/trees/${sha(item.tree?.sha)}`)));
  const normalize = tree => {
    if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Incomplete update tree');
    return tree.tree.map(({ path, mode, type, sha: id }) => {
      sha(id);
      if (['native-package.nix', 'README.md'].includes(path)) {
        if (mode !== '100644' || type !== 'blob') throw new Error('Forbidden update file mode/type');
        id = '<allowed-content>';
      }
      return [path, mode, type, id];
    }).sort((a, b) => a[0].localeCompare(b[0]));
  };
  // Root tree equality also proves every unrelated subtree and flake.lock
  // stayed byte-for-byte identical, including modes, additions and deletions.
  if (JSON.stringify(normalize(trees[0])) !== JSON.stringify(normalize(trees[1]))) throw new Error('Forbidden update tree changes');
  const diff = await request(`/repos/${repository}/compare/${base}...${commit}`);
  if (diff.merge_base_commit?.sha !== base || !Array.isArray(diff.files) || diff.files.length !== 2 ||
      new Set(diff.files.map(file => file.filename)).size !== 2 ||
      diff.files.some(file => !['native-package.nix', 'README.md'].includes(file.filename) || file.status !== 'modified')) throw new Error('Forbidden update diff or stale main baseline');
  const [beforeNative, afterNative, beforeReadme, afterReadme] = await Promise.all([
    sourceAt(request, repository, 'native-package.nix', base), sourceAt(request, repository, 'native-package.nix', commit),
    sourceAt(request, repository, 'README.md', base), sourceAt(request, repository, 'README.md', commit),
  ]);
  validateGeneratedUpdate({ beforeNative, afterNative, beforeReadme, afterReadme, version: v });
}

export async function validateReleaseEvidence({ request, repository, pr, version: v, issue }) {
  const evidence = [...(pr.body ?? '').matchAll(/<!-- pd2-main-base:([a-f0-9]{40}) -->/g)];
  // Legacy tested-develop releases deliberately require manual recovery after
  // rollout; never infer direct-main provenance from old metadata.
  if (evidence.length !== 1 || (pr.body ?? '').includes('pd2-tested-develop:')) throw new Error('Missing/ambiguous main baseline evidence');
  const base = evidence[0][1];
  const ancestry = await request(`/repos/${repository}/compare/${base}...${sha(pr.base.sha)}`);
  if (!['ahead', 'identical'].includes(ancestry.status)) throw new Error('Update baseline was not on main');
  await validateUpdateCommit({ request, repository, base, commit: sha(pr.head.sha), version: v });
  if (!(pr.body ?? '').includes(`Closes #${issue}`)) throw new Error('Missing default-branch issue closing reference');
  return base;
}

export async function completeCI({ eventRun, repository, request, runCommand }) {
  if (!Number.isSafeInteger(eventRun?.id)) throw new Error('Missing CI run');
  const workflow = await request(`/repos/${repository}/actions/workflows/ci.yml`);
  const run = await request(`/repos/${repository}/actions/runs/${eventRun.id}`);
  // Never use PR artifacts, branch scripts, caches or "latest green branch".
  const commit = validateRun(eventRun, run, workflow.id, repository);
  await successfulJobs(request, repository, run);
  const related = await pages(request, `/repos/${repository}/commits/${commit}/pulls`);
  const candidates = [];
  for (const item of related) {
    const pr = await request(`/repos/${repository}/pulls/${item.number}`);
    const metadata = eligiblePR(pr, run.head_branch, commit, repository);
    if (metadata) candidates.push({ pr, ...metadata });
  }
  if (candidates.length === 0) return { status: 'ineligible' };
  if (candidates.length !== 1) throw new Error('Ambiguous eligible release provenance');
  const { pr, version: v, issue } = candidates[0];
  if (await pinnedAt(request, repository, commit) !== v) throw new Error('Merged version mismatch');
  await validateIssue(request, repository, v, issue, run.head_branch === 'main');
  const upstream = await request(`/repos/errolgr/pd2-trade/releases/tags/app-v${v}`);
  if (upstream.tag_name !== `app-v${v}` || upstream.draft || upstream.prerelease) throw new Error('Invalid upstream release');
  const ciURL = `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`;
  // main may have advanced since CI started. Prove ancestry, but tag the
  // tested merge commit, never whichever commit main happens to point to now.
  await validateReleaseEvidence({ request, repository, pr, version: v, issue });
  const comparison = await request(`/repos/${repository}/compare/${commit}...main`);
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Tested commit is not on main');
  const notes = `Nix packaging for upstream PD2 Trader ${v}.\n\nTracking issue: https://github.com/${repository}/issues/${issue}\nRelease PR: https://github.com/${repository}/pull/${pr.number}\nCI: ${ciURL}\n\nExisting build-and-test CI succeeded on merged main commit ${commit}, including its Nix application build, integration contracts, development shell and isolated startup steps. Cached Nix outputs may be reused; this is not a reproducibility or complete game/OAuth/audio integration claim.`;
  const release = await publish({ request, repository, version: v, commit, notes, runCommand });
  return { status: 'published', commit, release: release.html_url };
}

export async function diagnoseCI({ eventRun, repository, request }) {
  if (!Number.isSafeInteger(eventRun?.id)) throw new Error('Missing CI run');
  const workflow = await request(`/repos/${repository}/actions/workflows/ci.yml`);
  const run = await request(`/repos/${repository}/actions/runs/${eventRun.id}`);
  if (run.id !== eventRun.id || run.run_attempt !== eventRun.run_attempt || run.head_sha !== eventRun.head_sha ||
      run.status !== 'completed' || run.conclusion === 'success' || run.workflow_id !== workflow.id ||
      run.path !== '.github/workflows/ci.yml' || run.head_repository?.full_name !== repository ||
      !['workflow_dispatch', 'push', 'pull_request'].includes(run.event)) throw new Error('Untrusted/stale failure run');
  const commit = sha(run.head_sha);
  const related = await pages(request, `/repos/${repository}/commits/${commit}/pulls`);
  for (const item of related) {
    const pr = await request(`/repos/${repository}/pulls/${item.number}`);
    // Never attach a stale failure to a subsequently fixed PR.
    if (pr.state !== 'open' || pr.head?.sha !== commit || pr.head?.repo?.full_name !== repository ||
        !/^(feature\/update-pd2-trader-|release\/)/.test(pr.head.ref)) continue;
    const id = `<!-- pd2-ci:${run.id}:${run.run_attempt} -->`;
    const comments = await pages(request, `/repos/${repository}/issues/${item.number}/comments`);
    if (comments.some(comment => comment.body?.includes(id))) continue;
    const body = `${id}\n\nCI ${run.conclusion}: https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}\n\nPR remains open for diagnosis. Fix the failure and rerun full CI before manually merging; no automatic merge or closure.`;
    const created = await request(`/repos/${repository}/issues/${item.number}/comments`, { method: 'POST', body: { body } });
    const verified = await request(`/repos/${repository}/issues/comments/${created.id}`);
    if (verified.body !== body) throw new Error('Diagnostic readback mismatch');
  }
  return { status: 'diagnosed' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const repository = process.env.GITHUB_REPOSITORY;
    if (repository !== 'ohbe1jacobi/pd2-trader-flake') throw new Error('Unexpected repository');
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_run' || process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GH_TOKEN) throw new Error('Run trusted controller on main with its workflow token');
    const action = process.argv.includes('--diagnose') ? diagnoseCI : completeCI;
    console.log(JSON.stringify(await action({ eventRun: event.workflow_run, repository, request: createRequest(), runCommand: spawnSync }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
