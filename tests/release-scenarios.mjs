import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeCI } from '../.github/scripts/release-lifecycle.mjs';
const repository = 'owner/repo';
const commit = 'a'.repeat(40), base = 'd'.repeat(40), head = 'e'.repeat(40);
const hash = `sha256-${Buffer.alloc(32, 1).toString('base64')}`;
const before = `version = "0.10.9";\nhash = "${hash}";\nnpmDepsHash = "${hash}";\ncargoHash = "${hash}";\ndoCheck = true;\n`;
function scenario(branch = 'main') {
  const run = { id: 11, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: commit,
    head_branch: branch, event: 'push', workflow_id: 7, path: '.github/workflows/ci.yml', head_repository: { full_name: repository } };
  const pr = { number: 1, state: 'closed', merged: true, merge_commit_sha: commit,
    body: `<!-- pd2-update:0.10.10:42 -->\n<!-- pd2-main-base:${base} -->\nCloses #42`,
    base: { sha: base, ref: 'main', repo: { full_name: repository } },
    head: { sha: head, ref: 'release/0.10.10', repo: { full_name: repository } } };
  const refs = new Map();
  const releases = [], writes = [];
  const state = { run, pr, refs, releases, writes, after: before.replace('0.10.9', '0.10.10'),
    files: [{ filename: 'native-package.nix', status: 'modified' }, { filename: 'README.md', status: 'modified' }],
    parents: [{ sha: base }], trusted: true, mode: '100644', jobs: [
      { name: 'Nix build and tests (x86_64-linux)', conclusion: 'success' },
      { name: 'Publish trusted application cache', conclusion: 'success' },
    ] };
  const request = async (path, options = {}) => {
    const body = options.body;
    if (options.method) writes.push([path, options]);
    if (path.endsWith('/git/matching-refs/heads/main')) return [{ ref: 'refs/heads/main', object: { sha: commit } }];
    if (path.includes('/releases?')) return releases;
    if (path.endsWith('/releases/latest')) {
      if (!state.latest) throw Object.assign(new Error('Not Found'), { status: 404 });
      return state.latest;
    }
    if (path.endsWith('/releases/10') && options.method === 'PATCH') { state.latest = releases[0]; return releases[0]; }
    if (path.endsWith('/runs/11/attempts/1')) return { ...run, run_attempt: 1 };
    if (path.endsWith('/workflows/ci.yml')) return { id: 7 };
    if (path.endsWith('/runs/11')) return run;
    if (path.includes('/jobs?')) return { total_count: state.jobs.length, jobs: state.jobs };
    if (path.includes('/commits/') && path.includes('/pulls?')) return [pr];
    if (path.endsWith('/pulls/1')) return pr;
    if (path.includes('/contents/')) {
      const original = path.endsWith(`ref=${base}`);
      const text = path.includes('native-package.nix') ? (original ? before : state.after) : `Builds the pinned upstream **${original ? '0.10.9' : '0.10.10'}** release.`;
      return { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') };
    }
    if (path.endsWith(`/git/commits/${head}`)) return { sha: head, parents: state.parents, tree: { sha: 'f'.repeat(40) } };
    if (path.endsWith(`/git/commits/${base}`)) return { sha: base, tree: { sha: 'b'.repeat(40) } };
    if (path.includes('/git/trees/')) return { truncated: false, tree: [
      { path: 'native-package.nix', mode: path.endsWith('f'.repeat(40)) ? state.mode : '100644', type: 'blob', sha: head },
      { path: 'README.md', mode: '100644', type: 'blob', sha: head },
      { path: 'flake.lock', mode: '100644', type: 'blob', sha: base },
    ] };
    if (path.endsWith('/issues/42')) return { title: 'Update PD2 Trader to 0.10.10', state: 'closed', state_reason: 'completed' };
    if (path.includes('/repos/errolgr/')) return { tag_name: 'app-v0.10.10', draft: false, prerelease: false };
    if (path.endsWith('/releases/tags/v0.10.10')) {
      if (!releases.length) throw Object.assign(new Error('Not Found'), { status: 404 });
      return releases[0];
    }
    if (path.includes('/git/matching-refs/')) {
      const key = `refs/${path.split('/git/matching-refs/')[1]}`;
      return refs.has(key) ? [refs.get(key)] : [];
    }
    if (path.endsWith('/git/refs') && body) {
      assert.ok(body.ref.startsWith('refs/tags/'), 'no promotion or backmerge branches');
      refs.set(body.ref, { ref: body.ref, object: { sha: body.sha, type: 'tag' } }); return refs.get(body.ref);
    }
    if (path.includes(`/compare/${base}...${head}`)) return { status: 'ahead', merge_base_commit: { sha: base }, files: state.files };
    if (path.includes(`/compare/${base}...`)) return { status: state.trusted ? 'identical' : 'diverged' };
    if (path.includes(`/compare/${commit}...main`)) return { status: 'ahead' };
    if (path.endsWith('/git/tags') && body) return { sha: 'c'.repeat(40) };
    if (path.includes('/git/tags/')) return { tag: 'v0.10.10', message: 'PD2 Trader 0.10.10', object: { type: 'commit', sha: commit } };
    throw new Error(`Unmocked API call ${path}`);
  };
  const runCommand = (command, args) => {
    assert.equal(command, 'gh'); assert.ok(args.includes('--verify-tag'));
    assert.ok(args.includes('--latest=true'));
    releases.push({ id: 10, tag_name: 'v0.10.10', name: 'PD2 Trader 0.10.10', body: args[args.indexOf('--notes') + 1], draft: false, prerelease: false, html_url: 'https://fixture/release' });
    state.latest = releases[0];
    return { status: 0 };
  };
  return Object.assign(state, { request, runCommand, eventRun: { ...run }, repository });
}
test('merged main CI publishes exact tested SHA once with no promotion or backmerge', async () => {
  const state = scenario();
  const first = await completeCI(state);
  assert.equal(first.status, 'published');
  assert.equal(first.commit, commit);
  assert.equal(state.releases.length, 1);
  await completeCI(state);
  assert.equal(state.releases.length, 1);
  assert.equal(state.refs.size, 1);
  assert.equal(first.backmerge, undefined);
});
test('an older merged-main rerun is superseded without publication when main packages a newer version', async () => {
  const state = scenario(); const request = state.request;
  state.request = async (path, options) => path.endsWith('/git/matching-refs/heads/main') ?
    [{ ref: 'refs/heads/main', object: { sha: '9'.repeat(40) } }] :
    path.endsWith(`contents/native-package.nix?ref=${'9'.repeat(40)}`) ?
      { type: 'file', encoding: 'base64', content: Buffer.from(before.replace('0.10.9', '0.10.11')).toString('base64') } :
      request(path, options);
  assert.equal((await completeCI(state)).status, 'superseded');
  assert.equal(state.writes.length, 0);
  assert.equal(state.releases.length, 0);
});
test('recovery rejects existing notes missing the exact merged-main CI evidence', async () => {
  const state = scenario(); await completeCI(state);
  state.releases[0].body = `Nix packaging for upstream PD2 Trader 0.10.10. Tested ${commit}`;
  state.latest = null; state.writes.length = 0;
  await assert.rejects(completeCI(state), /provenance/);
  assert.equal(state.writes.length, 0);
});
test('a validated second CI attempt repairs Latest without replacing the original successful evidence', async () => {
  const state = scenario(); await completeCI(state);
  const original = state.releases[0].body;
  state.latest = null; state.writes.length = 0;
  state.run.run_attempt = 2; state.eventRun.run_attempt = 2;
  assert.equal((await completeCI(state)).status, 'published');
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].body, original);
  assert.match(original, /runs\/11\/attempts\/1/);
  assert.deepEqual(state.writes, [['/repos/owner/repo/releases/10', { method: 'PATCH', body: { make_latest: 'true' } }]]);
});
test('recovery rejects forged or failed original CI evidence before Latest writes', async () => {
  for (const failure of ['foreign', 'failed', 'wrong-sha', 'api']) {
    const state = scenario(); await completeCI(state);
    state.latest = null; state.writes.length = 0;
    state.run.run_attempt = 2; state.eventRun.run_attempt = 2;
    if (failure === 'foreign') state.releases[0].body = state.releases[0].body.replace('https://github.com/owner/repo/actions/', 'https://github.com/foreign/repo/actions/');
    const request = state.request;
    state.request = async (path, options) => {
      if (path.endsWith('/runs/11/attempts/1')) {
        if (failure === 'api') throw new Error('Historical CI API unavailable');
        return { ...state.run, run_attempt: 1, ...(failure === 'failed' ? { conclusion: 'failure' } : { head_sha: 'f'.repeat(40) }) };
      }
      return request(path, options);
    };
    await assert.rejects(completeCI(state), /provenance|trusted CI|API unavailable/);
    assert.equal(state.writes.length, 0);
  }
});
test('develop successful CI cannot promote an upstream bump', async () => {
  const state = scenario('develop');
  await assert.rejects(completeCI(state), /trusted CI/);
  assert.equal(state.writes.length, 0);
});
test('extra cache job cannot substitute for a missing, failed, skipped or ambiguous build job', async () => {
  for (const jobs of [
    [{ name: 'Publish trusted application cache', conclusion: 'success' }],
    [{ name: 'Nix build and tests (x86_64-linux)', conclusion: 'failure' }],
    [{ name: 'Nix build and tests (x86_64-linux)', conclusion: 'skipped' }],
    Array.from({ length: 2 }, () => ({ name: 'Nix build and tests (x86_64-linux)', conclusion: 'success' })),
  ]) {
    const state = scenario(); state.jobs = jobs;
    await assert.rejects(completeCI(state), /successful CI job/);
    assert.equal(state.writes.length, 0);
  }
});
test('legacy develop metadata fails closed without tag writes', async () => {
  const state = scenario();
  state.pr.body = `<!-- pd2-update:0.10.10:42 -->\n<!-- pd2-tested-develop:${base}:8:1 -->\nCloses #42`;
  await assert.rejects(completeCI(state), /main.*evidence|main.*baseline/i);
  assert.equal(state.writes.length, 0);
});
test('missing merged provenance remains ineligible', async () => {
  const state = scenario(); state.pr.merged = false;
  assert.equal((await completeCI(state)).status, 'ineligible');
  assert.equal(state.writes.length, 0);
});
test('publication rejects a reused update commit with executable mode changes', async () => {
  const state = scenario(); state.mode = '100755';
  await assert.rejects(completeCI(state), /tree|mode/i);
  assert.equal(state.writes.length, 0);
});
test('publication revalidates trusted main ancestry and exact generated payload', async () => {
  for (const mutate of [s => { s.trusted = false; }, s => { s.parents = [{ sha: 'f'.repeat(40) }]; },
    s => { s.after = s.after.replace('true', 'false'); }, s => { s.files.push({ filename: 'flake.lock', status: 'modified' }); }]) {
    const state = scenario(); mutate(state);
    await assert.rejects(completeCI(state), /main|parent|Native|diff|baseline/i);
    assert.equal(state.writes.length, 0);
  }
});
