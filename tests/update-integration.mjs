import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planUpdate, finishUpdate, validatePayload } from '../.github/scripts/update-integration.mjs';
const commit = 'a'.repeat(40);
const repository = 'owner/repo';
const release = { tag_name: 'app-v0.10.10', draft: false, prerelease: false };
function fixture(existing = false) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    assert.notEqual(options.method, 'POST');
    if (path.includes('/releases/tags/')) return release;
    if (path.endsWith('/issues/42')) return { number: 42, title: 'Update PD2 Trader to 0.10.10', state: 'open' };
    if (path.includes('/matching-refs/heads/develop')) return [{ ref: 'refs/heads/develop', object: { sha: commit } }];
    if (path.includes('/matching-refs/heads/feature/')) return existing ? [{ ref: 'refs/heads/feature/update-pd2-trader-0.10.10', object: { sha: 'b'.repeat(40) } }] : [];
    if (path.includes('/contents/native-package.nix')) return { encoding: 'base64', content: Buffer.from('version = "0.10.9";').toString('base64') };
    throw new Error(`Unexpected ${path}`);
  };
  return { request, calls };
}
test('update plan binds develop SHA and never overwrites an interrupted existing feature', async () => {
  for (const existing of [false, true]) {
    const { request } = fixture(existing);
    const plan = await planUpdate({ request, repository, version: '0.10.10', issue: '42' });
    assert.equal(plan.base, commit);
    assert.equal(plan.generate, !existing);
    assert.equal(plan.head, existing ? 'b'.repeat(40) : undefined);
  }
});
test('malformed inputs and dismissed updates stop before writes', async () => {
  const { request } = fixture();
  await assert.rejects(planUpdate({ request, repository, version: '0.10.10;bad', issue: '42' }), /version/i);
  await assert.rejects(planUpdate({ request, repository, version: '0.10.10', issue: '4e2' }), /issue/i);
  await assert.rejects(planUpdate({ repository, version: '0.10.10', issue: '42', request: async () => ({ title: 'Update PD2 Trader to 0.10.10', state: 'closed' }) }), /Dismissed|release/i);
});
test('writer rejects stale develop before accepting any generated output', async () => {
  const { request } = fixture();
  await assert.rejects(finishUpdate({ request, repository, version: '0.10.10', issue: '42', base: 'c'.repeat(40) }), /Stale/);
});

test('privileged writer accepts only literal version/hash substitutions and the packaged README reference', () => {
  const hash = `sha256-${Buffer.alloc(32, 1).toString('base64')}`;
  const nextHash = `sha256-${Buffer.alloc(32, 2).toString('base64')}`;
  const before = `version = "0.10.9";\n hash = "${hash}";\n npmDepsHash = "${hash}";\n cargoHash = "${hash}";\n doCheck = true;\n`;
  const after = before.replace('0.10.9', '0.10.10').replace(hash, nextHash);
  const readme = 'Builds the pinned upstream **0.10.9** release.';
  const nextReadme = readme.replace('0.10.9', '0.10.10');
  validatePayload(before, after, readme, nextReadme, '0.10.10');
  for (const changed of [after.replace('true', 'false'), `${after}postInstall = "evil";\n`, after.replace(nextHash, 'sha256-placeholder')]) {
    assert.throws(() => validatePayload(before, changed, readme, nextReadme, '0.10.10'));
  }
  assert.throws(() => validatePayload(before, after, readme, `${nextReadme}\nUnrelated text`, '0.10.10'), /README/);
});

test('reused feature branches cannot smuggle lockfile or unrelated changes into generated PRs', async () => {
  const { request: original } = fixture(true);
  const request = async (path, options = {}) => {
    assert.notEqual(options.method, 'POST');
    if (path.includes(`/contents/native-package.nix?ref=${'b'.repeat(40)}`)) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
    if (path.includes('/compare/')) return { merge_base_commit: { sha: commit }, files: [{ filename: 'flake.lock', status: 'modified' }] };
    return original(path, options);
  };
  await assert.rejects(finishUpdate({ request, repository, version: '0.10.10', issue: '42', base: commit }), /Forbidden update diff/);
});

test('interrupted update retries branch/PR/CI handoff without regenerating or overwriting a branch', async () => {
  const { request: original } = fixture(true);
  let pr;
  let failPR = true;
  let dispatches = 0;
  const request = async (path, options = {}) => {
    assert.ok(!path.endsWith('/git/refs') && !path.endsWith('/git/commits'), 'existing branch must never be overwritten');
    if (path.includes(`/contents/native-package.nix?ref=${'b'.repeat(40)}`)) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
    if (path.includes('/compare/')) return { merge_base_commit: { sha: commit }, files: [{ filename: 'native-package.nix', status: 'modified' }, { filename: 'README.md', status: 'modified' }] };
    if (path.includes('/pulls?')) return pr ? [pr] : [];
    if (path.endsWith('/pulls') && options.method === 'POST') {
      if (failPR) { failPR = false; throw new Error('Temporary PR failure'); }
      pr = { ...options.body, number: 4, state: 'open', head: { ref: options.body.head, repo: { full_name: repository } }, base: { ref: options.body.base } }; return pr;
    }
    if (path.endsWith('/pulls/4')) return pr;
    if (path.endsWith('/dispatches')) { assert.equal(options.body.inputs.expected_sha, 'b'.repeat(40)); dispatches++; return null; }
    return original(path, options);
  };
  const input = { request, repository, version: '0.10.10', issue: '42', base: commit };
  await assert.rejects(finishUpdate(input), /Temporary PR failure/);
  assert.equal((await finishUpdate(input)).pr, 4);
  assert.equal((await finishUpdate(input)).pr, 4);
  assert.equal(dispatches, 2);
});
