import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequest, readPinnedVersion } from './check-upstream.mjs';

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
      !['push', 'workflow_dispatch'].includes(run.event) || !['main', 'develop'].includes(run.head_branch)) {
    throw new Error('Not a current successful trusted CI run');
  }
  return sha(run.head_sha);
}
export function eligiblePR(pr, base, commit, repository) {
  const matches = [...(pr.body ?? '').matchAll(/<!-- pd2-update:((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)):([1-9]\d*) -->/g)];
  if (matches.length !== 1 || !pr.merged || pr.merge_commit_sha !== commit ||
      pr.base?.ref !== base || pr.base.repo.full_name !== repository || pr.head?.repo?.full_name !== repository) return null;
  const [, v, issue] = matches[0];
  const prefix = base === 'main' ? 'release/' : 'feature/update-pd2-trader-';
  if (pr.head.ref !== `${prefix}${v}` || !Number.isSafeInteger(Number(issue))) return null;
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
    const markers = text => [...(text ?? '').matchAll(/<!-- pd2-update:[^>]+ -->/g)].map(match => match[0]);
    const expected = markers(body), actual = markers(pr.body);
    if (expected.length !== 1 || actual.length !== 1 || expected[0] !== actual[0]) throw new Error('Existing PR metadata differs; manual recovery required');
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
  // must never cause a green run for a different commit to satisfy promotion.
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

export async function publish({ request, repository, version: v, commit, notes, runCommand }) {
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
  const findRelease = async () => (await pages(request, `/repos/${repository}/releases`)).find(release => release.tag_name === tag);
  let release = await findRelease();
  if (!release) {
    const result = runCommand('gh', ['release', 'create', tag, '--repo', repository,
      '--verify-tag', '--title', title, '--notes', notes, '--latest=false'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Release publication failed: ${result.error?.message ?? result.stderr}`);
    release = await findRelease();
  }
  if (!release || release.name !== title || release.draft || release.prerelease ||
      !release.body?.startsWith(`Nix packaging for upstream PD2 Trader ${v}.`) || !release.body.includes(commit)) throw new Error('Release readback mismatch');
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
  if (jobs.length !== 1 || jobs[0].name !== 'Nix build and tests (x86_64-linux)' || jobs[0].conclusion !== 'success') throw new Error('Missing/mismatched successful CI job');
}

export async function validateReleaseEvidence({ request, repository, pr, version: v, issue, workflowId }) {
  const evidence = [...(pr.body ?? '').matchAll(/<!-- pd2-tested-develop:([a-f0-9]{40}):([1-9]\d*):([1-9]\d*) -->/g)];
  if (evidence.length !== 1) throw new Error('Missing/ambiguous tested develop evidence');
  const [, commit, id, attempt] = evidence[0];
  if (!Number.isSafeInteger(Number(id)) || !Number.isSafeInteger(Number(attempt))) throw new Error('Invalid CI evidence identifier');
  const run = await request(`/repos/${repository}/actions/runs/${id}/attempts/${attempt}`);
  validateRun({ id: Number(id), run_attempt: Number(attempt), head_sha: commit }, run, workflowId, repository);
  if (run.head_branch !== 'develop') throw new Error('Release source CI was not on develop');
  await successfulJobs(request, repository, run);
  if (await pinnedAt(request, repository, commit) !== v) throw new Error('Release source version mismatch');
  const related = await pages(request, `/repos/${repository}/commits/${commit}/pulls`);
  let eligible = 0;
  for (const item of related) {
    const sourcePR = await request(`/repos/${repository}/pulls/${item.number}`);
    const metadata = eligiblePR(sourcePR, 'develop', commit, repository);
    if (metadata?.version === v && metadata.issue === issue) eligible++;
  }
  if (eligible !== 1) throw new Error('Missing/ambiguous integration PR evidence');
  const ancestry = await request(`/repos/${repository}/compare/${commit}...${sha(pr.head.sha)}`);
  if (!['ahead', 'identical'].includes(ancestry.status)) throw new Error('Release head does not descend from tested develop');
  if (!(pr.body ?? '').includes(`Closes #${issue}`)) throw new Error('Missing default-branch issue closing reference');
  return commit;
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
  if (run.head_branch === 'develop') {
    const develop = await getRef(request, repository, 'heads', 'develop');
    if (develop?.object.sha !== commit) throw new Error('Stale develop run; never promote newer untested commits');
    const head = `release/${v}`;
    await ensureBranch(request, repository, head, commit);
    const body = `${marker(v, issue)}\n<!-- pd2-tested-develop:${commit}:${run.id}:${run.run_attempt} -->\n\nFrozen release candidate from tested develop commit ${commit}.\n\nIntegration PR: #${pr.number}\nCI: ${ciURL}\n\nCloses #${issue}\n\nManual release approval/merge required. Release-only fixes require a back-merge PR.`;
    const releasePR = await ensurePR(request, repository, { head, base: 'main', title: `release: PD2 Trader ${v}`, body });
    await dispatchCI(request, repository, head, commit);
    return { status: 'release-prepared', commit, pr: releasePR.number };
  }
  // main may have advanced since CI started. Prove ancestry, but tag the
  // tested merge commit, never whichever commit main happens to point to now.
  await validateReleaseEvidence({ request, repository, pr, version: v, issue, workflowId: workflow.id });
  const comparison = await request(`/repos/${repository}/compare/${commit}...main`);
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Tested commit is not on main');
  const notes = `Nix packaging for upstream PD2 Trader ${v}.\n\nTracking issue: https://github.com/${repository}/issues/${issue}\nRelease PR: https://github.com/${repository}/pull/${pr.number}\nCI: ${ciURL}\n\nExisting build-and-test CI succeeded on merged main commit ${commit}, including its Nix application build, integration contracts, development shell and isolated startup steps. Cached Nix outputs may be reused; this is not a reproducibility or complete game/OAuth/audio integration claim.`;
  const release = await publish({ request, repository, version: v, commit, notes, runCommand });
  const backmerge = await request(`/repos/${repository}/compare/develop...${commit}`);
  let backmergePR;
  if (backmerge.ahead_by > 0) {
    const head = `feature/backmerge-pd2-trader-${v}`;
    await ensureBranch(request, repository, head, commit);
    backmergePR = await ensurePR(request, repository, { head, base: 'develop', title: `chore: back-merge PD2 Trader ${v}`, body: `Back-merge released commit ${commit} into develop.\n\nRelease: ${release.html_url}\n\nManual approval/merge required; do not bypass protections. Tracking issue: #${issue}` });
    await dispatchCI(request, repository, head, commit);
  }
  return { status: 'published', commit, release: release.html_url, backmerge: backmergePR?.number };
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
