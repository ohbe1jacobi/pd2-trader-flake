import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeCI } from '../.github/scripts/release-lifecycle.mjs';
const repository = 'owner/repo';
const commit = 'a'.repeat(40);
const sourceCommit = 'd'.repeat(40);
function scenario(branch) {
  const run = { id: 11, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: commit,
    head_branch: branch, event: 'push', workflow_id: 7, path: '.github/workflows/ci.yml', head_repository: { full_name: repository } };
  const inputPR = { number: 1, state: 'closed', merged: true, merge_commit_sha: commit,
    body: `<!-- pd2-update:0.10.10:42 -->\n<!-- pd2-tested-develop:${sourceCommit}:8:1 -->\nCloses #42`,
    base: { ref: branch, repo: { full_name: repository } }, head: { sha: sourceCommit, ref: branch === 'main' ? 'release/0.10.10' : 'feature/update-pd2-trader-0.10.10', repo: { full_name: repository } } };
  const sourcePR = { ...inputPR, number: 22, merge_commit_sha: sourceCommit, base: { ref: 'develop', repo: { full_name: repository } }, head: { ref: 'feature/update-pd2-trader-0.10.10', repo: { full_name: repository } } };
  const refs = new Map([['refs/heads/develop', { ref: 'refs/heads/develop', object: { sha: commit } }]]);
  const prs = [inputPR];
  const releases = [];
  const writes = [];
  const request = async (path, options = {}) => {
    const body = options.body;
    if (options.method) writes.push([path, options]);
    if (path.endsWith('/workflows/ci.yml')) return { id: 7 };
    if (path.endsWith('/runs/11')) return run;
    if (path.endsWith('/runs/8/attempts/1')) return { ...run, id: 8, head_sha: sourceCommit, head_branch: 'develop' };
    if (path.includes('/jobs?')) return { total_count: 1, jobs: [{ name: 'Nix build and tests (x86_64-linux)', conclusion: 'success' }] };
    if (path.includes(`/commits/${sourceCommit}/pulls?`)) return [sourcePR];
    if (path.includes('/commits/') && path.includes('/pulls?')) return [inputPR];
    if (path.endsWith('/pulls/22')) return sourcePR;
    if (path.includes('/contents/native-package.nix')) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
    if (path.endsWith('/issues/42')) return { title: 'Update PD2 Trader to 0.10.10', state: branch === 'main' ? 'closed' : 'open', state_reason: 'completed' };
    if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10', draft: false, prerelease: false };
    if (path.includes('/git/matching-refs/')) {
      const key = `refs/${path.split('/git/matching-refs/')[1]}`;
      return refs.has(key) ? [refs.get(key)] : [];
    }
    if (path.endsWith('/git/refs') && body) {
      refs.set(body.ref, { ref: body.ref, object: { sha: body.sha, type: body.ref.includes('/tags/') ? 'tag' : 'commit' } }); return refs.get(body.ref);
    }
    if (path.includes('/pulls?')) {
      const url = new URL(`https://fixture${path}`);
      return prs.filter(pr => `${repository.split('/')[0]}:${pr.head.ref}` === url.searchParams.get('head') && pr.base.ref === url.searchParams.get('base'));
    }
    if (path.endsWith('/pulls') && body) {
      const pr = { ...body, number: prs.length + 1, state: 'open', head: { ref: body.head, repo: { full_name: repository } }, base: { ref: body.base, repo: { full_name: repository } } };
      prs.push(pr); return pr;
    }
    if (/\/pulls\/\d+$/.test(path)) return prs.find(pr => pr.number === Number(path.split('/').at(-1)));
    if (path.endsWith('/dispatches')) return null;
    if (path.includes('/compare/develop...')) return { ahead_by: 1 };
    if (path.includes('/compare/')) return { status: 'ahead' };
    if (path.endsWith('/git/tags') && body) return { sha: 'c'.repeat(40) };
    if (path.includes('/git/tags/')) return { tag: 'v0.10.10', message: 'PD2 Trader 0.10.10', object: { type: 'commit', sha: commit } };
    if (path.includes('/releases?')) return releases;
    throw new Error(`Unmocked API call ${path}`);
  };
  const runCommand = (command, args) => {
    assert.equal(command, 'gh'); assert.ok(args.includes('--verify-tag'));
    releases.push({ tag_name: 'v0.10.10', name: 'PD2 Trader 0.10.10', body: args[args.indexOf('--notes') + 1], draft: false, prerelease: false, html_url: 'https://fixture/release' });
    return { status: 0 };
  };
  return { request, runCommand, eventRun: { ...run }, repository, writes, refs, prs, releases, run };
}
test('successful merged develop CI freezes exact tested candidate and reuses branch/PR on retry', async () => {
  const state = scenario('develop');
  const first = await completeCI(state);
  assert.equal(first.status, 'release-prepared');
  assert.equal(first.commit, commit);
  assert.match(state.prs[1].body, /Closes #42/);
  assert.equal((await completeCI(state)).pr, first.pr);
  assert.equal(state.prs.length, 2);
  assert.equal(state.refs.get('refs/heads/release/0.10.10').object.sha, commit);
  assert.equal(state.releases.length, 0);
});
test('stale successful develop does not create a candidate for newer untested develop', async () => {
  const state = scenario('develop');
  state.refs.get('refs/heads/develop').object.sha = 'b'.repeat(40);
  await assert.rejects(completeCI(state), /Stale develop/);
  assert.equal(state.writes.length, 0);
});
test('actual merged main CI publishes exact tested SHA then opens manual backmerge, with retry reuse', async () => {
  const state = scenario('main');
  const first = await completeCI(state);
  assert.equal(first.status, 'published');
  assert.equal(first.commit, commit);
  assert.equal(state.releases.length, 1);
  assert.equal(state.prs[1].base.ref, 'develop');
  assert.equal(state.refs.get('refs/heads/feature/backmerge-pd2-trader-0.10.10').object.sha, commit);
  await completeCI(state);
  assert.equal(state.releases.length, 1);
  assert.equal(state.prs.length, 2);
});
test('missing merged release provenance blocks tag and release writes', async () => {
  const state = scenario('main');
  state.prs[0].merged = false;
  assert.equal((await completeCI(state)).status, 'ineligible');
  assert.equal(state.writes.length, 0);
});
