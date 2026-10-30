import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const gate = () => import('../.github/scripts/cache-ci.mjs');
const sha = 'a'.repeat(40);
const repository = 'ohbe1jacobi/pd2-trader-flake';
const event = () => ({ action: 'opened', sender: { login: 'github-actions[bot]', type: 'Bot' }, pull_request: {
  user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- pd2-update:0.10.10:42 -->',
  base: { ref: 'develop', repo: { full_name: repository } },
  head: { ref: 'feature/update-pd2-trader-0.10.10', sha, repo: { full_name: repository } },
} });

test('only automation-marked same-repo bot events mirror explicit dispatch; humans and forks build', async () => {
  const { automationHead } = await gate();
  assert.equal(automationHead(event(), repository), sha);
  for (const mutate of [
    e => { e.sender.login = 'human'; },
    e => { e.sender.type = 'User'; },
    e => { e.pull_request.user.login = 'another-bot'; },
    e => { e.pull_request.body = ''; },
    e => { e.pull_request.body += '\\n<!-- pd2-update:0.10.10:42 -->'; },
    e => { e.pull_request.head.repo.full_name = 'attacker/fork'; },
    e => { e.pull_request.head.ref = 'unrelated'; },
    e => { e.action = 'reopened'; },
  ]) {
    const e = event(); mutate(e);
    assert.equal(automationHead(e, repository), null);
  }
  const release = event(); release.pull_request.base.ref = 'main'; release.pull_request.head.ref = 'release/0.10.10';
  assert.equal(automationHead(release, repository), sha);
});

test('dispatch mirror selects exact SHA, branch and workflow and never masks a newer failure', async () => {
  const { selectDispatch, dispatchResult } = await gate();
  const valid = { id: 10, head_sha: sha, head_branch: 'feature/update-pd2-trader-0.10.10', event: 'workflow_dispatch', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' };
  const newer = { ...valid, id: 11, conclusion: 'failure' };
  const unrelated = [ { ...valid, id: 20, head_sha: 'b'.repeat(40) }, { ...valid, id: 21, event: 'pull_request' }, { ...valid, id: 22, path: '.github/workflows/other.yml' }, { ...valid, id: 23, head_branch: 'other' } ];
  const selected = selectDispatch([valid, newer, ...unrelated], sha, valid.head_branch);
  assert.equal(selected.id, 11);
  assert.throws(() => dispatchResult(selected), /failure/);
  for (const conclusion of ['cancelled', 'skipped', 'timed_out', 'neutral', 'action_required']) assert.throws(() => dispatchResult({ ...valid, conclusion }));
  assert.equal(dispatchResult(valid), true);
  assert.equal(dispatchResult({ ...valid, status: 'in_progress', conclusion: null }), false);
  assert.equal(selectDispatch(unrelated, sha, valid.head_branch), undefined);
});

test('cache manifests bind exact trusted push run, attempt, commit, and independently evaluated roots', async () => {
  const { validateManifest } = await import('../.github/scripts/cache-transfer.mjs');
  const context = { repository, event: 'push', ref: 'refs/heads/develop', sha, run: '42', attempt: '1' };
  const roots = ['/nix/store/' + 'a'.repeat(32) + '-pd2-trader'];
  const manifest = { ...context, roots };
  assert.deepEqual(validateManifest(manifest, context, roots), roots);
  for (const field of ['repository', 'event', 'ref', 'sha', 'run', 'attempt']) assert.throws(() => validateManifest({ ...manifest, [field]: 'wrong' }, context, roots));
  for (const change of [{ roots: ['/nix/store/evil'] }, { roots: [...roots, ...roots] }, { roots: [] }]) assert.throws(() => validateManifest({ ...manifest, ...change }, context, roots));
  for (const ref of ['refs/heads/feature/evil', 'refs/tags/v1', 'refs/pull/1/merge']) assert.throws(() => validateManifest({ ...manifest, ref }, { ...context, ref }, roots));
  assert.throws(() => validateManifest({ ...manifest, event: 'pull_request' }, { ...context, event: 'pull_request' }, roots));
  const generated = { ...context, event: 'workflow_dispatch', ref: 'refs/heads/release/0.10.10' };
  assert.deepEqual(validateManifest({ ...generated, roots }, generated, roots), roots);
  assert.throws(() => validateManifest({ ...generated, ref: 'refs/heads/unrelated', roots }, { ...generated, ref: 'refs/heads/unrelated' }, roots));
});

test('CI restricts pushes, reads the public cache, isolates cache writes to trusted pushes', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /push:\n    branches: \[main, develop\]/);
  assert.doesNotMatch(ci, /pull_request_target|workflow_run/);
  assert.match(ci, /name: Nix build and tests \(x86_64-linux\)/);
  assert.match(ci, /cache-upload:\n    needs: build-and-test/);
  const [build, upload] = ci.split('  cache-upload:');
  assert.doesNotMatch(build, /CACHIX_AUTH_TOKEN|secrets\./);
  assert.match(upload, /github.event_name == 'push'/);
  assert.match(upload, /github.ref == 'refs\/heads\/main'/);
  assert.match(upload, /github.ref == 'refs\/heads\/develop'/);
  assert.match(upload, /github.repository == 'ohbe1jacobi\/pd2-trader-flake'/);
  assert.match(upload, /cache-transfer.mjs import/);
  assert.match(upload, /CACHIX_AUTH_TOKEN: \$\{\{ secrets.CACHIX_AUTH_TOKEN \}\}/);
  assert.doesNotMatch(upload, /nix develop|nix flake check|headless-smoke|cachix-action/);
  assert.match(build, /cache-ci.mjs --mirror/);
  assert.match(build, /checks.x86_64-linux.cache-smoke/);
  assert.doesNotMatch(build, /--command node tests\/headless-smoke/);
  assert.match(read('flake.nix'), /cache-smoke = import \.\/tests\/cache-smoke.nix/);
  assert.match(ci, /cancel-in-progress: false/);
  for (const uses of ci.matchAll(/uses: ([^\s]+)/g)) assert.match(uses[1], /@[a-f0-9]{40}$/);
});

// Official release tags and action.yml were checked against the actions repos.
// Keep upload/download paired: both use Node 24 and the immutable artifact service.
test('cache artifact actions use the verified Node 24 release pins', () => {
  const pins = new Map([
    ['upload-artifact', ['cf430e030ddbb5b0abf93d22962f4752f3646cd9', 'v7.0.2']],
    ['download-artifact', ['9000827ccba6bdab643e8b6fd33ac0654aef8333', 'v8.0.2']],
  ]);
  const actions = ['.github/workflows/ci.yml', '.github/workflows/cache-generated.yml']
    .flatMap(path => [...read(path).matchAll(/uses: actions\/(upload-artifact|download-artifact)@([^\s]+) # ([^\s]+)/g)]);
  assert.equal(actions.length, 3, 'one upload and both isolated publisher downloads must be covered');
  for (const [, action, pin, version] of actions) {
    assert.deepEqual([pin, version], pins.get(action), `${action} must use its verified Node 24 release`);
  }
});

test('cache artifact runtime updates preserve exact-run transfer and extraction contracts', () => {
  const ci = read('.github/workflows/ci.yml');
  const generated = read('.github/workflows/cache-generated.yml');
  const artifactStep = (workflow, action) => {
    const steps = workflow.split(/\n      - name:/).filter(step => step.includes(`uses: actions/${action}@`));
    assert.equal(steps.length, 1);
    return steps[0];
  };
  const upload = artifactStep(ci, 'upload-artifact');
  const download = artifactStep(ci, 'download-artifact');
  const authenticated = artifactStep(generated, 'download-artifact');
  for (const step of [upload, download]) {
    assert.match(step, /name: trusted-cache-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
    assert.match(step, /path: cache-transfer\//);
  }
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /compression-level: 0/);
  assert.doesNotMatch(upload, /archive: false|overwrite: true|include-hidden-files: true/);
  assert.doesNotMatch(download, /artifact-ids:|pattern:|github-token:|repository:|run-id:/);
  for (const input of [
    'artifact-ids: ${{ steps.verify.outputs.artifact }}',
    'github-token: ${{ github.token }}',
    'repository: ${{ github.repository }}',
    'run-id: ${{ github.event.workflow_run.id }}',
    'path: ${{ runner.temp }}/generated-cache-artifact',
    'merge-multiple: true',
  ]) assert.ok(authenticated.includes(input), `authenticated download must retain ${input}`);
  assert.doesNotMatch(authenticated, /\n          (?:name|pattern):/);
  for (const step of [download, authenticated]) {
    assert.doesNotMatch(step, /skip-decompress: true|digest-mismatch: (?:ignore|info|warn)/);
  }
});

test('flake advertises the verified public cache without changing module defaults or lock', () => {
  const flake = read('flake.nix');
  assert.match(flake, /extra-substituters = \[ "https:\/\/pd2-trader-flake.cachix.org" \];/);
  assert.ok(flake.includes('pd2-trader-flake.cachix.org-1:rg+7WukdJd8/1+Ky8c7kUHivrvfcmOPVlGUxz4CqLM4='));
  assert.match(flake, /cache-ci =/);
  assert.match(read('git-hooks.nix'), /tests\/cache-ci.mjs/);
});

test('generated cache eligibility accepts only the literal update transform and exact tree', async () => {
  const { validateGeneratedSources, validateGeneratedTrees } = await import('../.github/scripts/cache-generated.mjs');
  const before = 'version = "0.10.9";\n hash = "sha256-' + 'A'.repeat(43) + '=";\n npmDepsHash = "sha256-' + 'A'.repeat(43) + '=";\n cargoHash = "sha256-' + 'A'.repeat(43) + '=";\n doCheck = true;\n';
  const after = before.replace('0.10.9', '0.10.10');
  const readme = 'pinned upstream **0.10.9** release';
  validateGeneratedSources(before, after, readme, readme.replace('0.10.9', '0.10.10'), 'feature/update-pd2-trader-0.10.10');
  for (const native of [after.replace('true', 'false'), after + '\nbuiltins.getEnv "TOKEN"', after.replace('0.10.10', '0.10.11')]) assert.throws(() => validateGeneratedSources(before, native, readme, readme.replace('0.10.9','0.10.10'), 'feature/update-pd2-trader-0.10.10'));
  const tree = [{ path: 'native-package.nix', mode: '100644', type: 'blob', sha }, { path: 'README.md', mode: '100644', type: 'blob', sha }, { path: 'flake.lock', mode: '100644', type: 'blob', sha }];
  const candidate = tree.map(e => e.path === 'native-package.nix' ? { ...e, sha: 'b'.repeat(40) } : e);
  validateGeneratedTrees({ tree, truncated: false }, { tree: candidate, truncated: false });
  assert.throws(() => validateGeneratedTrees({ tree }, { tree: candidate.map(e => e.path === 'flake.lock' ? { ...e, sha: 'b'.repeat(40) } : e) }));
  assert.throws(() => validateGeneratedTrees({ tree }, { tree: candidate, truncated: true }));
  assert.throws(() => validateGeneratedTrees({ tree }, { tree: [...candidate, { path: 'evil', mode: '100644', type: 'blob', sha }] }));
  assert.throws(() => validateGeneratedTrees({ tree }, { tree: candidate.map(e => e.path === 'native-package.nix' ? { ...e, mode: '120000' } : e) }));
});

test('generated-cache authority independently authenticates run, main ancestry, full tree, and artifact', async () => {
  const { verifyGeneratedRun } = await import('../.github/scripts/cache-generated.mjs');
  const base = 'b'.repeat(40), treeSha = 'c'.repeat(40);
  const native = 'version = "0.10.9";\n hash = "sha256-' + 'A'.repeat(43) + '=";\n npmDepsHash = "sha256-' + 'A'.repeat(43) + '=";\n cargoHash = "sha256-' + 'A'.repeat(43) + '=";\n';
  const readme = 'pinned upstream **0.10.9** release';
  const tree = [{ path: 'native-package.nix', mode: '100644', type: 'blob', sha }, { path: 'README.md', mode: '100644', type: 'blob', sha }];
  const run = { id: 42, run_attempt: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', head_sha: sha, head_branch: 'release/0.10.10', repository: { id: 1, full_name: repository }, head_repository: { full_name: repository } };
  const artifact = { id: 77, name: 'trusted-cache-42-1', expired: false, workflow_run: { id: 42, repository_id: 1, head_repository_id: 1, head_sha: sha, head_branch: run.head_branch } };
  const responses = () => ({
    '/actions/runs/42': run,
    [`/git/commits/${sha}`]: { parents: [{ sha: base }], tree: { sha: treeSha } },
    [`/git/commits/${base}`]: { tree: { sha: base } },
    [`/compare/${base}...main`]: { merge_base_commit: { sha: base } },
    '/git/ref/heads/main': { object: { sha: base } },
    [`/git/trees/${base}?recursive=1`]: { tree },
    [`/git/trees/${treeSha}?recursive=1`]: { tree },
    [`/contents/native-package.nix?ref=${base}`]: { type: 'file', encoding: 'base64', content: Buffer.from(native).toString('base64') },
    [`/contents/native-package.nix?ref=${sha}`]: { type: 'file', encoding: 'base64', content: Buffer.from(native.replace('0.10.9','0.10.10')).toString('base64') },
    [`/contents/README.md?ref=${base}`]: { type: 'file', encoding: 'base64', content: Buffer.from(readme).toString('base64') },
    [`/contents/README.md?ref=${sha}`]: { type: 'file', encoding: 'base64', content: Buffer.from(readme.replace('0.10.9','0.10.10')).toString('base64') },
    '/actions/runs/42/artifacts?per_page=100&page=1': { artifacts: [artifact] },
  });
  const verify = data => verifyGeneratedRun({ repository, runId: 42, attempt: 1, head: sha, request: async path => {
    const key = path.replace(`/repos/${repository}`, ''); assert.ok(key in data, key); return structuredClone(data[key]);
  } });
  const valid = await verify(responses()); assert.equal(valid.artifact, '77'); assert.equal(valid.base, base);
  for (const change of [
    d => { d['/actions/runs/42'] = { ...run, event: 'pull_request' }; },
    d => { d['/actions/runs/42'] = { ...run, conclusion: 'failure' }; },
    d => { d['/actions/runs/42'] = { ...run, run_attempt: 2 }; },
    d => { d['/git/ref/heads/main'] = { object: { sha } }; },
    d => { d[`/compare/${base}...main`] = { merge_base_commit: { sha } }; },
    d => { d[`/git/trees/${treeSha}?recursive=1`] = { tree, truncated: true }; },
    d => { d['/actions/runs/42/artifacts?per_page=100&page=1'] = { artifacts: [{ ...artifact, expired: true }] }; },
    d => { d['/actions/runs/42/artifacts?per_page=100&page=1'] = { artifacts: [{ ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: base } }] }; },
  ]) { const data = responses(); change(data); await assert.rejects(verify(data)); }
});

test('generated cache publisher uses trusted main controller and never checks out or executes candidate code', () => {
  const workflow = read('.github/workflows/cache-generated.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /event == 'workflow_dispatch'/);
  assert.match(workflow, /ref: main/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github.event.workflow_run.head_sha/);
  assert.match(workflow, /cache-generated.mjs/);
  assert.match(workflow, /artifact-ids: \$\{\{ steps.verify.outputs.artifact \}\}/);
  assert.match(workflow, /cache-transfer.mjs import-generated/);
  assert.doesNotMatch(workflow, /nix develop|headless-smoke|nix flake check/);
  const tokenStep = workflow.split('- name: Publish validated generated closure')[1];
  assert.ok(tokenStep); assert.match(tokenStep, /secrets.CACHIX_AUTH_TOKEN/);
  assert.doesNotMatch(workflow.split('- name: Publish validated generated closure')[0], /secrets\./);
  assert.match(read('.github/workflows/ci.yml'), /startsWith\(github.ref, 'refs\/heads\/release\/'\)/);
  assert.match(workflow, /startsWith\(github.event.workflow_run.head_branch, 'release\/'\)/);
});

test('dispatch mirror validates inputs before API access and handles pagination, waiting, and denial', async () => {
  const { mirrorDispatch } = await gate();
  const completed = { id: 42, head_sha: sha, head_branch: 'release/0.10.10', event: 'workflow_dispatch', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' };
  let calls = 0, waits = 0;
  const request = async url => { calls++; return { ok: true, json: async () => ({ workflow_runs: url.endsWith('page=1') ? Array.from({ length:100 }, () => ({ ...completed, event:'push' })) : [completed] }) }; };
  assert.equal((await mirrorDispatch({repository,head:sha,branch:completed.head_branch,token:'test-only-token',request,wait:async()=>{}})).id,42);
  assert.equal(calls,2);
  await assert.rejects(mirrorDispatch({repository,head:sha,branch:completed.head_branch,token:'test-only-token',attempts:2,request:async()=>({ok:true,json:async()=>({workflow_runs:[]})}),wait:async()=>{waits++;}}),/Timed out/);
  assert.equal(waits,2);
  await assert.rejects(mirrorDispatch({repository,head:sha,branch:completed.head_branch,token:'test-only-token',request:async()=>({ok:false,status:403})}),/403/);
  calls=0;
  await assert.rejects(mirrorDispatch({repository,head:sha,branch:completed.head_branch,request,wait:async()=>{}}),/token/);
  assert.equal(calls,0);
});

test('dispatch mirror allows a full 190-minute build plus queue delay', async () => {
  const { mirrorDispatch } = await gate();
  let elapsed = 0;
  const run = { id: 42, head_sha: sha, head_branch: 'release/0.10.10', event: 'workflow_dispatch', path: '.github/workflows/ci.yml' };
  const result = await mirrorDispatch({ repository, head: sha, branch: run.head_branch, token: 'test-only-token',
    wait: async ms => { elapsed += ms; },
    request: async () => ({ ok: true, json: async () => ({ workflow_runs: [{ ...run,
      status: elapsed >= 200 * 60_000 ? 'completed' : 'in_progress', conclusion: elapsed >= 200 * 60_000 ? 'success' : null,
    }] }) }),
  });
  assert.equal(result.id, 42);
  assert.equal(elapsed, 200 * 60_000);
  assert.match(read('.github/workflows/ci.yml'), /timeout-minutes: \$\{\{ github.event_name == 'pull_request' && 300 \|\| 190 \}\}/);
});

test('both cache publishers require the protected cachix-publish environment', () => {
  const upload = read('.github/workflows/ci.yml').split('  cache-upload:')[1];
  const generated = read('.github/workflows/cache-generated.yml').split('  publish:')[1];
  for (const job of [upload, generated]) assert.match(job, /^    environment: cachix-publish$/m);
});

test('full application checks are manual-only, never a push hook', () => {
  const hook = read('git-hooks.nix').split('    flake-check = {')[1];
  assert.ok(hook);
  assert.match(hook, /stages = \[ "manual" \];/);
  assert.doesNotMatch(hook, /"pre-push"/);
});
