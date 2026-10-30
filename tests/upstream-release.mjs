import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as checker from '../.github/scripts/check-upstream.mjs';
const { checkUpstream } = checker;

test('a newer stable release creates an update issue and reads it back', async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10', draft: false, prerelease: false }];
    if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10', draft: false, prerelease: false };
    if (options.method === 'POST') return { number: 42 };
    if (path.endsWith('/issues/42')) {
      return { title: 'Update PD2 Trader to 0.10.10', state: 'open', number: 42 };
    }
    return [];
  };
  const result = await checkUpstream({ version: '0.10.9', repository: 'owner/package', request });
  assert.equal(result.status, 'created');
  const post = calls.find(call => call.method === 'POST');
  assert.equal(post.path, '/repos/owner/package/issues');
  assert.equal(post.body.title, 'Update PD2 Trader to 0.10.10');
  assert.match(post.body.body, /0\.10\.9/);
  assert.match(post.body.body, /errolgr\/pd2-trade\/releases\/tag\/app-v0\.10\.10/);
  assert.match(post.body.body, /cargoHash/);
  assert.doesNotMatch(post.body.body, /develop/);
  assert.match(post.body.body, /release\/<version>.*main/);
  assert.equal(calls.at(-2).path, '/repos/owner/package/issues/42');
  assert.deepEqual(calls.at(-1).body, { ref: 'main', inputs: { version: '0.10.10', issue: '42' } });
});

test('the pinned version must be a unique literal numeric version', () => {
  assert.equal(checker.readPinnedVersion('  version = "0.10.9";\n'), '0.10.9');
  for (const source of ['', 'version = "0.10.9-rc.1";', 'version = "0.10.9";\nversion = "0.10.10";']) {
    assert.throws(() => checker.readPinnedVersion(source), /literal version/);
  }
});

test('equal, older, prerelease, draft, and unrelated releases never create issues', async () => {
  for (const release of [
    { tag_name: 'app-v0.10.9' },
    { tag_name: 'app-v0.9.99' },
    { tag_name: 'app-v0.10.10', prerelease: true },
    { tag_name: 'app-v0.10.10', draft: true },
    { tag_name: 'app-v0.10.10-rc.1' },
    { tag_name: 'other-v9.0.0' },
  ]) {
    let calls = 0;
    const result = await checkUpstream({
      version: '0.10.9', repository: 'owner/package',
      request: async () => {
        assert.equal(calls++, 0, 'must stop after checking the release');
        return [release];
      },
    });
    assert.equal(result.status, 'skipped');
  }
});

test('open and closed issues are deduplicated across pages, but PRs are not issues', async () => {
  for (const state of ['open', 'closed']) {
    const paths = [];
    const result = await checkUpstream({
      version: '0.10.9', repository: 'owner/package',
      request: async (path, options = {}) => {
        paths.push(path);
        if (path.endsWith('/dispatches')) return null;
        assert.notEqual(options.method, 'POST');
        if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10' }];
        if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10' };
        if (path.endsWith('/issues/7')) return { title: 'Update PD2 Trader to 0.10.10', state, number: 7 };
        if (path.endsWith('page=1')) {
          return Array.from({ length: 100 }, () => ({
            title: 'Update PD2 Trader to 0.10.10', pull_request: {},
          }));
        }
        return [{ title: 'Update PD2 Trader to 0.10.10', state, number: 7 }];
      },
    });
    assert.equal(result.status, state === 'closed' ? 'dismissed' : 'reused');
    assert.equal(result.issue, 7);
    assert.match(paths[2], /state=all/);
    assert.ok(paths.some(path => path.endsWith('page=2')));
    assert.equal(paths.some(path => path.endsWith('/dispatches')), state === 'open');
  }
});

test('dry run reports the candidate without creating an issue', async () => {
  const result = await checkUpstream({
    version: '0.10.9', repository: 'owner/package', dryRun: true,
    request: async (path, options = {}) => {
      assert.notEqual(options.method, 'POST');
      if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10' }];
      return path.includes('/releases/tags/') ? { tag_name: 'app-v0.10.10' } : [];
    },
  });
  assert.equal(result.status, 'would-create');
  assert.equal(result.title, 'Update PD2 Trader to 0.10.10');
});

test('the gh adapter uses arguments and JSON stdin, handles empty replies, and propagates errors', async () => {
  const calls = [];
  const request = checker.createRequest((command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: calls.length === 1 ? '{"number":1}' : '', stderr: '' };
  });
  const body = { title: 'literal $(touch bad); "quotes"' };
  assert.deepEqual(await request('/repos/owner/repo/issues', { method: 'POST', body }), { number: 1 });
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args, ['api', '/repos/owner/repo/issues', '--method', 'POST',
    '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', '--input', '-']);
  assert.equal(calls[0].options.input, JSON.stringify(body));
  assert.equal(calls[0].options.encoding, 'utf8');
  assert.notEqual(calls[0].options.shell, true);
  assert.equal(await request('/repos/owner/repo/actions/workflows/prepare-update.yml/dispatches', { method: 'POST', body: {} }), null);
  await request('/repos/owner/repo');
  assert.equal(calls[2].args.includes('--input'), false);
  for (const status of [403, 404]) {
    const failure = checker.createRequest(() => ({ status: 1, stderr: `HTTP ${status}`, stdout: '' }));
    await assert.rejects(failure('/repos/owner/repo'), error => error.status === status && /GitHub API/.test(error.message));
  }
  await assert.rejects(checker.createRequest(() => ({ error: new Error('spawn gh ENOENT') }))('/repos/x/y'), /ENOENT/);
  await assert.rejects(checker.createRequest(() => ({ status: 0, stdout: 'not JSON' }))('/repos/x/y'), /JSON/);
});

test('API lookup failures propagate without creating an issue', async () => {
  await assert.rejects(checkUpstream({
    version: '0.10.9', repository: 'owner/package',
    request: async () => { throw new Error('API unavailable'); },
  }), /API unavailable/);
});

test('a failed issue readback is not reported as success', async () => {
  await assert.rejects(checkUpstream({
    version: '0.10.9', repository: 'owner/package',
    request: async (path, options = {}) => {
      if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10' }];
      if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10' };
      if (options.method === 'POST') return { number: 42 };
      if (path.endsWith('/issues/42')) return { title: 'Wrong issue', state: 'open' };
      return [];
    },
  }), /could not be verified/);
});

test('canonical numeric versions compare without lexical or floating-point errors', () => {
  for (const value of ['01.2.3', 'v1.2.3', '1.2.3-rc.1', '1.2.3\n', '--help']) assert.throws(() => checker.validateVersion(value));
  assert.equal(checker.compareVersions('0.10.10', '0.10.9'), 1);
  assert.equal(checker.compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(checker.compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(checker.compareVersions('1.0.0', '1.0.0'), 0);
});

test('release discovery paginates and selects the highest stable application version, not first or latest-designated', async () => {
  const paths = [];
  const result = await checkUpstream({ version: '0.10.9', repository: 'owner/package', dryRun: true,
    request: async (path, options = {}) => {
      assert.notEqual(options.method, 'POST'); paths.push(path);
      if (path.includes('/releases?') && path.endsWith('page=1')) return Array.from({ length: 100 }, (_, i) => ({ tag_name: i ? 'unrelated-v99.0.0' : 'app-v0.10.9' }));
      if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10' }, { tag_name: 'app-v99.0.0', prerelease: true }, { tag_name: 'app-v01.2.3' }];
      if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10' };
      return [];
    },
  });
  assert.equal(result.version, '0.10.10');
  assert.ok(paths.some(path => path.includes('/releases?') && path.endsWith('page=2')));
});

test('failed dispatch retries an existing open issue without duplicate issue creation', async () => {
  let issue;
  let issueWrites = 0;
  let dispatches = 0;
  const request = async (path, options = {}) => {
    if (path.includes('/releases?')) return [{ tag_name: 'app-v0.10.10' }];
    if (path.includes('/releases/tags/')) return { tag_name: 'app-v0.10.10' };
    if (path.includes('/issues?')) return issue ? [issue] : [];
    if (path.endsWith('/issues') && options.method === 'POST') {
      issueWrites++; issue = { number: 42, title: options.body.title, state: 'open' }; return issue;
    }
    if (path.endsWith('/issues/42')) return issue;
    if (path.endsWith('/dispatches')) { if (++dispatches === 1) throw new Error('Dispatch unavailable'); return null; }
    assert.fail(`Unexpected ${path}`);
  };
  await assert.rejects(checkUpstream({ version: '0.10.9', repository: 'owner/package', request }), /Dispatch unavailable/);
  assert.equal((await checkUpstream({ version: '0.10.9', repository: 'owner/package', request })).status, 'reused');
  assert.equal(issueWrites, 1);
  const dry = await checkUpstream({ version: '0.10.9', repository: 'owner/package', request, dryRun: true });
  assert.equal(dry.status, 'would-dispatch');
  assert.equal(dispatches, 2);
});
