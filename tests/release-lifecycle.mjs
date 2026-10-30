import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as lifecycle from '../.github/scripts/release-lifecycle.mjs';

const sha = 'a'.repeat(40);
// All writes and command execution below are offline fixtures, never GitHub calls.
function publicationFixture() {
  const release = { id: 10, tag_name: 'v0.10.10', name: 'PD2 Trader 0.10.10',
    body: `Nix packaging for upstream PD2 Trader 0.10.10. Tested ${sha}`, draft: false, prerelease: false };
  const state = { release, latest: null, mainVersion: '0.10.10', releases: [release], calls: [], commands: [] };
  const request = async (path, options = {}) => {
    state.calls.push([path, options]);
    if (state.intercept) {
      const result = await state.intercept(path, options);
      if (result !== undefined) return result;
    }
    if (path.endsWith('/git/matching-refs/heads/main')) return [{ ref: 'refs/heads/main', object: { sha } }];
    if (path.includes('/contents/native-package.nix?')) return { encoding: 'base64', content: Buffer.from(`version = "${state.mainVersion}";`).toString('base64') };
    if (path.includes('/releases?')) return state.releases;
    if (path.endsWith('/releases/latest')) {
      if (!state.latest) throw Object.assign(new Error('Not Found'), { status: 404 });
      return state.latest;
    }
    if (path.includes('/matching-refs/tags/')) return [{ ref: 'refs/tags/v0.10.10', object: { type: 'tag', sha } }];
    if (path.includes('/git/tags/')) return { tag: release.tag_name, message: release.name, object: { type: 'commit', sha } };
    if (path.endsWith('/releases/tags/v0.10.10')) return state.release;
    if (path.endsWith('/releases/10') && options.method === 'PATCH') {
      assert.deepEqual(options.body, { make_latest: 'true' });
      state.latest = state.release;
      return state.release;
    }
    assert.fail(`Unexpected fixture call ${path}`);
  };
  return Object.assign(state, { request, repository: 'owner/repo', version: '0.10.10', commit: sha,
    notes: release.body, delay: async () => {}, runCommand: (...args) => { state.commands.push(args); assert.fail('must not recreate existing release'); } });
}

test('existing eligible stable release recovers Latest once and verifies the designation on retry', async () => {
  const state = publicationFixture();
  await lifecycle.publish(state);
  await lifecycle.publish(state);
  assert.equal(state.calls.filter(([, options]) => options.method === 'PATCH').length, 1);
  assert.ok(state.calls.filter(([path]) => path.endsWith('/releases/latest')).length >= 3);
  assert.equal(state.commands.length, 0);
});
test('stale publication cannot displace newer main or a newer stable release on any page', async () => {
  for (const source of ['main', 'releases', 'latest']) {
    const state = publicationFixture();
    const newer = { ...state.release, id: 11, tag_name: 'v0.10.11', name: 'PD2 Trader 0.10.11' };
    if (source === 'main') state.mainVersion = '0.10.11';
    if (source === 'latest') state.latest = newer;
    if (source === 'releases') state.intercept = async path => {
      if (path.includes('/releases?')) return path.endsWith('page=1') ? Array(100).fill(state.release) : [newer];
    };
    assert.equal(await lifecycle.publish(state), null);
    assert.equal(state.calls.some(([, options]) => options.method), false, source);
    assert.equal(state.commands.length, 0);
  }
});
test('already correct Latest is read back without any mutation', async () => {
  const state = publicationFixture(); state.latest = state.release;
  await lifecycle.publish(state);
  assert.equal(state.calls.some(([, options]) => options.method), false);
  assert.ok(state.calls.filter(([path]) => path.endsWith('/releases/latest')).length >= 2);
});
test('draft, prerelease, unrelated and conflicting releases are never promoted', async () => {
  for (const change of [{ draft: true }, { prerelease: true }, { name: 'feature release' }, { tag_name: 'feature-v0.10.10' }, { body: 'wrong provenance' }]) {
    const state = publicationFixture(); state.release = { ...state.release, ...change };
    await assert.rejects(lifecycle.publish(state), /Release readback mismatch/);
    assert.equal(state.calls.some(([, options]) => options.method), false);
  }
  const state = publicationFixture(); state.latest = { ...state.release, tag_name: 'feature-v2' };
  await assert.rejects(lifecycle.publish(state), /Unrelated or invalid Latest/);
  assert.equal(state.calls.some(([, options]) => options.method), false);
});
test('Latest mismatched identity or metadata never counts as verified publication', async () => {
  for (const change of [{ id: 999 }, { name: 'wrong' }, { draft: true }, { prerelease: true }, { body: 'wrong' }]) {
    const state = publicationFixture();
    state.intercept = async (path, options) => {
      if (options.method === 'PATCH') { state.latest = { ...state.release, ...change }; return state.release; }
    };
    await assert.rejects(lifecycle.publish(state), /Latest release readback mismatch/);
    assert.equal(state.calls.filter(([, options]) => options.method === 'PATCH').length, 1);
  }
});
test('Latest API failures propagate and never masquerade as absence or success', async () => {
  for (const endpoint of ['main', 'list', 'latest', 'patch', 'readback']) {
    const state = publicationFixture();
    state.intercept = async (path, options) => {
      if ((endpoint === 'main' && path.endsWith('/heads/main')) ||
          (endpoint === 'list' && path.includes('/releases?')) ||
          (endpoint === 'latest' && path.endsWith('/releases/latest')) ||
          (endpoint === 'patch' && options.method === 'PATCH') ||
          (endpoint === 'readback' && state.latest && path.endsWith('/releases/latest'))) {
        throw Object.assign(new Error(`API unavailable: ${endpoint}`), { status: 503 });
      }
    };
    await assert.rejects(lifecycle.publish(state), /API unavailable/);
    assert.equal(state.calls.filter(([, options]) => options.method === 'PATCH').length, ['patch', 'readback'].includes(endpoint) ? 1 : 0);
  }
});
test('Latest recovery has bounded readback retries without repeated PATCH writes', async () => {
  const state = publicationFixture(); let reads = 0;
  state.intercept = async path => {
    if (state.latest && path.endsWith('/releases/latest') && ++reads < 3) throw Object.assign(new Error('Transient'), { status: 503 });
  };
  await lifecycle.publish(state);
  assert.equal(reads, 3);
  assert.equal(state.calls.filter(([, options]) => options.method === 'PATCH').length, 1);
});
test('main advancing during publication prevents an existing release repair', async () => {
  const state = publicationFixture(); let mainReads = 0;
  state.intercept = async path => { if (path.endsWith('/heads/main') && ++mainReads === 2) state.mainVersion = '0.10.11'; };
  assert.equal(await lifecycle.publish(state), null);
  assert.equal(state.calls.some(([, options]) => options.method), false);
});
test('successful create command alone cannot establish Latest and is not repeated on readback failure', async () => {
  const state = publicationFixture(); const release = state.release;
  state.release = null; state.releases = [];
  state.runCommand = (command, args) => {
    state.commands.push([command, args]);
    assert.ok(args.includes('--latest=true'));
    state.release = release;
    return { status: 0 };
  };
  await assert.rejects(lifecycle.publish(state), /Latest release readback mismatch/);
  assert.equal(state.commands.length, 1);
  assert.equal(state.calls.some(([, options]) => options.method === 'PATCH'), false);
});
test('main advancing during tag lookup prevents stale new release creation', async () => {
  const state = publicationFixture(); const release = state.release; state.release = null; state.releases = [];
  state.intercept = async path => { if (path.includes('/matching-refs/tags/')) state.mainVersion = '0.10.11'; };
  state.runCommand = () => { state.commands.push('create'); state.release = release; state.latest = release; return { status: 0 }; };
  assert.equal(await lifecycle.publish(state), null);
  assert.equal(state.commands.length, 0);
});
test('a newer draft, prerelease or unrelated listing is not promoted instead of the eligible target', async () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'feature-v99.0.0' }]) {
    const state = publicationFixture();
    state.releases.push({ ...state.release, id: 99, tag_name: 'v99.0.0', ...change });
    assert.equal((await lifecycle.publish(state)).id, state.release.id);
    assert.deepEqual(state.calls.filter(([, options]) => options.method).map(([path]) => path), ['/repos/owner/repo/releases/10']);
  }
});
test('release controller workflow publishes only main and needs no promotion write permissions', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-lifecycle.yml', import.meta.url), 'utf8');
  const publish = workflow.split('  diagnose:')[0];
  assert.match(publish, /head_branch == 'main'/);
  assert.doesNotMatch(publish, /head_branch == 'develop'|pull-requests: write|actions: write/);
});
test('publication accepts only successful exact-SHA main CI, rejecting stale attempts', () => {
  const run = { id: 1, run_attempt: 2, status: 'completed', conclusion: 'success', head_sha: sha,
    head_branch: 'main', event: 'push', workflow_id: 7, path: '.github/workflows/ci.yml',
    head_repository: { full_name: 'owner/repo' } };
  assert.equal(lifecycle.validateRun(run, { ...run }, 7, 'owner/repo'), sha);
  for (const change of [{ conclusion: 'failure' }, { head_sha: 'b'.repeat(40) },
    { run_attempt: 1 }, { event: 'pull_request' }, { head_branch: 'feature/no' },
    { head_branch: 'develop' }, { workflow_id: 8 }, { head_repository: { full_name: 'attacker/repo' } }]) {
    assert.throws(() => lifecycle.validateRun(run, { ...run, ...change }, 7, 'owner/repo'));
  }
});

test('PR eligibility binds merge SHA, repository, branch, version and issue metadata', () => {
  const pr = { merged: true, merge_commit_sha: sha, body: '<!-- pd2-update:0.10.10:42 -->',
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    head: { ref: 'release/0.10.10', repo: { full_name: 'owner/repo' } } };
  assert.deepEqual(lifecycle.eligiblePR(pr, 'main', sha, 'owner/repo'), { version: '0.10.10', issue: 42 });
  for (const change of [{ merged: false }, { merge_commit_sha: 'b'.repeat(40) },
    { body: '<!-- pd2-update:0.10.10;evil:42 -->' },
    { head: { ...pr.head, ref: 'feature/no' } }]) {
    assert.equal(lifecycle.eligiblePR({ ...pr, ...change }, 'main', sha, 'owner/repo'), null);
  }
});

test('frozen branch creation is read back; conflicts never move existing branches', async () => {
  let exists = false;
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    if (options.method === 'POST') { exists = true; return {}; }
    return exists ? [{ ref: 'refs/heads/release/0.10.10', object: { sha } }] : [];
  };
  await lifecycle.ensureBranch(request, 'owner/repo', 'release/0.10.10', sha);
  await lifecycle.ensureBranch(request, 'owner/repo', 'release/0.10.10', sha);
  assert.equal(calls.filter(([, o]) => o.method === 'POST').length, 1);
  await assert.rejects(lifecycle.ensureBranch(async () => [{ ref: 'refs/heads/release/0.10.10', object: { sha: 'b'.repeat(40) } }], 'owner/repo', 'release/0.10.10', sha), /frozen|conflict/i);
});

test('tag publication reuses an annotated exact target, rejects conflicts and retries missing release', async () => {
  let ref;
  let release;
  const commands = [];
  const request = async (path, options = {}) => {
    if (path.endsWith('/git/matching-refs/heads/main')) return [{ ref: 'refs/heads/main', object: { sha } }];
    if (path.includes('/contents/native-package.nix?')) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
    if (path.includes('/releases?')) return release ? [release] : [];
    if (path.endsWith('/releases/latest')) {
      if (!release) throw Object.assign(new Error('Not Found'), { status: 404 });
      return release;
    }
    if (path.includes('/matching-refs/')) return ref ? [ref] : [];
    if (path.endsWith('/git/tags') && options.method === 'POST') {
      assert.equal(options.body.object, sha);
      return { sha: 'c'.repeat(40) };
    }
    if (path.endsWith('/git/refs') && options.method === 'POST') {
      ref = { ref: 'refs/tags/v0.10.10', object: { type: 'tag', sha: 'c'.repeat(40) } };
      return ref;
    }
    if (path.includes('/git/tags/')) return { tag: 'v0.10.10', message: 'PD2 Trader 0.10.10', object: { type: 'commit', sha } };
    if (path.endsWith('/releases/tags/v0.10.10')) {
      if (!release) throw Object.assign(new Error('Not Found'), { status: 404 });
      return release;
    }
    throw new Error(`Unexpected ${path}`);
  };
  const runCommand = (command, args) => {
    commands.push([command, args]);
    assert.ok(args.includes('--verify-tag'));
    assert.ok(args.includes('--latest=true'), 'new stable release explicitly selects Latest');
    release = { id: 10, tag_name: 'v0.10.10', name: 'PD2 Trader 0.10.10', body: args[args.indexOf('--notes') + 1], draft: false, prerelease: false, html_url: 'fixture' };
    return { status: 0 };
  };
  const input = { request, repository: 'owner/repo', version: '0.10.10', commit: sha, notes: `Nix packaging for upstream PD2 Trader 0.10.10.\nTested ${sha}`, runCommand };
  await lifecycle.publish(input);
  await lifecycle.publish(input);
  assert.equal(commands.length, 1);
  await assert.rejects(lifecycle.publish({ ...input, commit: 'd'.repeat(40) }), /conflict/i);
  release = undefined;
  await assert.rejects(lifecycle.publish({ ...input, runCommand: () => ({ status: 1, stderr: 'failed' }) }), /failed/);
  await lifecycle.publish(input);
  assert.equal(commands.length, 2);
});

test('release readback retries only absent/transient responses without duplicate creation', async () => {
  const tagRef = { ref: 'refs/tags/v0.10.10', object: { type: 'tag', sha: 'c'.repeat(40) } };
  const good = { id: 10, tag_name: 'v0.10.10', name: 'PD2 Trader 0.10.10', draft: false, prerelease: false,
    body: `Nix packaging for upstream PD2 Trader 0.10.10. Tested ${sha}` };
  for (const statuses of [[404, 404, 503, 200], [403], [404, 404, 404, 404]]) {
    let reads = 0, creates = 0;
    const waits = [];
    const input = { repository: 'owner/repo', version: '0.10.10', commit: sha, notes: good.body,
      delay: async ms => waits.push(ms), request: async path => {
        if (path.endsWith('/git/matching-refs/heads/main')) return [{ ref: 'refs/heads/main', object: { sha } }];
        if (path.includes('/contents/native-package.nix?')) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
        if (path.includes('/releases?')) return [];
        if (path.endsWith('/releases/latest')) return good;
        if (path.includes('/matching-refs/')) return [tagRef];
        if (path.includes('/git/tags/')) return { tag: 'v0.10.10', message: good.name, object: { type: 'commit', sha } };
        if (path.includes('/releases/tags/')) {
          const status = statuses[Math.min(reads++, statuses.length - 1)];
          if (status !== 200) throw Object.assign(new Error(`HTTP ${status}`), { status });
          return good;
        }
        assert.fail(path);
      }, runCommand: () => { creates++; return { status: 0 }; } };
    if (statuses.at(-1) === 200) {
      await lifecycle.publish(input);
      assert.equal(creates, 1); assert.deepEqual(waits, [1000, 2000]);
    } else {
      await assert.rejects(lifecycle.publish(input), statuses[0] === 403 ? /403/ : /readback.*absent/i);
      assert.equal(creates, statuses[0] === 403 ? 0 : 1);
      assert.ok(reads <= 4);
    }
  }
});

test('release conflicts report mismatched fields and never recreate', async () => {
  await assert.rejects(lifecycle.publish({ repository: 'owner/repo', version: '0.10.10', commit: sha,
    request: async path => {
      if (path.endsWith('/git/matching-refs/heads/main')) return [{ ref: 'refs/heads/main', object: { sha } }];
      if (path.includes('/contents/native-package.nix?')) return { encoding: 'base64', content: Buffer.from('version = "0.10.10";').toString('base64') };
      if (path.includes('/releases?')) return [];
      if (path.endsWith('/releases/latest')) throw Object.assign(new Error('Not Found'), { status: 404 });
      if (path.includes('/matching-refs/')) return [{ ref: 'refs/tags/v0.10.10', object: { type: 'tag', sha } }];
      if (path.includes('/git/tags/')) return { tag: 'v0.10.10', message: 'PD2 Trader 0.10.10', object: { type: 'commit', sha } };
      return { tag_name: 'v0.10.10', name: 'wrong', draft: true, prerelease: false, body: 'wrong' };
    }, runCommand: () => assert.fail('must not recreate conflict') }), /name.*draft.*body/);
});

test('closed existing PRs and mismatched dispatch heads fail without writes', async () => {
  const request = async (_path, options = {}) => {
    assert.notEqual(options.method, 'POST');
    return [{ state: 'closed', head: { ref: 'release/0.10.10', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' } }];
  };
  await assert.rejects(lifecycle.ensurePR(request, 'owner/repo', { head: 'release/0.10.10', base: 'main' }), /closed/);
  await assert.rejects(lifecycle.dispatchCI(async () => [], 'owner/repo', 'release/0.10.10', sha), /Stale/);
});

test('completion requires real successful jobs and eligible PRs before publication', async () => {
  const run = { id: 1, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: sha,
    head_branch: 'main', event: 'push', workflow_id: 7, path: '.github/workflows/ci.yml',
    head_repository: { full_name: 'owner/repo' } };
  for (const conclusion of ['skipped', 'success']) {
    const request = async (path, options = {}) => {
      assert.notEqual(options.method, 'POST');
      if (path.endsWith('/workflows/ci.yml')) return { id: 7 };
      if (path.endsWith('/runs/1')) return run;
      if (path.includes('/jobs?')) return { jobs: [{ name: 'Nix build and tests (x86_64-linux)', conclusion }], total_count: 1 };
      if (path.includes('/pulls?')) return [];
      throw new Error(`Unexpected ${path}`);
    };
    const input = { request, repository: 'owner/repo', eventRun: run };
    if (conclusion === 'skipped') await assert.rejects(lifecycle.completeCI(input), /job/);
    else assert.equal((await lifecycle.completeCI(input)).status, 'ineligible');
  }
});

test('failed exact-head CI leaves one diagnostic and never closes the PR', async () => {
  const run = { id: 3, run_attempt: 1, status: 'completed', conclusion: 'failure', head_sha: sha,
    head_branch: 'feature/update-pd2-trader-0.10.10', event: 'workflow_dispatch', workflow_id: 7,
    path: '.github/workflows/ci.yml', head_repository: { full_name: 'owner/repo' } };
  const comments = [];
  const request = async (path, options = {}) => {
    if (path.endsWith('/workflows/ci.yml')) return { id: 7 };
    if (path.endsWith('/runs/3')) return run;
    if (path.includes('/commits/')) return [{ number: 10 }];
    if (path.endsWith('/pulls/10')) return { number: 10, state: 'open', head: { sha, ref: run.head_branch, repo: { full_name: 'owner/repo' } } };
    if (path.includes('/comments?')) return comments;
    if (path.endsWith('/comments') && options.method === 'POST') {
      comments.push({ id: 9, body: options.body.body }); return comments[0];
    }
    if (path.endsWith('/comments/9')) return comments[0];
    throw new Error(`Unexpected ${path}`);
  };
  await lifecycle.diagnoseCI({ request, repository: 'owner/repo', eventRun: run });
  await lifecycle.diagnoseCI({ request, repository: 'owner/repo', eventRun: run });
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /actions\/runs\/3/);
});

test('retry reuses release PR after a different successful CI attempt on the same frozen SHA', async () => {
  const pr = { number: 2, state: 'open', body: '<!-- pd2-update:0.10.10:42 -->\nOriginal successful CI link',
    head: { ref: 'release/0.10.10', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' } };
  const result = await lifecycle.ensurePR(async (path, options = {}) => {
    assert.notEqual(options.method, 'POST');
    return path.includes('/pulls?') ? [pr] : pr;
  }, 'owner/repo', { head: pr.head.ref, base: 'main', body: '<!-- pd2-update:0.10.10:42 -->\nRetry CI link' });
  assert.equal(result.number, 2);
});

test('release publication rejects missing main baseline and legacy develop evidence', async () => {
  await assert.rejects(lifecycle.validateReleaseEvidence({ request: async () => assert.fail('no lookup without evidence'), repository: 'owner/repo', pr: { body: '<!-- pd2-update:0.10.10:42 -->' }, version: '0.10.10', issue: 42, workflowId: 7 }), /evidence/);
  const pr = { body: `<!-- pd2-tested-develop:${sha}:8:1 -->`, head: { sha: 'b'.repeat(40) } };
  await assert.rejects(lifecycle.validateReleaseEvidence({ request: async () => ({ id: 8, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'failure', workflow_id: 7, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'develop', head_repository: { full_name: 'owner/repo' } }), repository: 'owner/repo', pr, version: '0.10.10', issue: 42, workflowId: 7 }), /main baseline evidence/);
});

test('PR retries preserve notes but reject missing or changed main baseline metadata', async () => {
  const expected = `<!-- pd2-update:0.10.10:42 -->\n<!-- pd2-main-base:${sha} -->`;
  for (const body of ['<!-- pd2-update:0.10.10:42 -->', expected.replace(sha, 'b'.repeat(40))]) {
    const pr = { number: 2, state: 'open', body,
      head: { ref: 'release/0.10.10', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' } };
    await assert.rejects(lifecycle.ensurePR(async (path, options = {}) => {
      assert.notEqual(options.method, 'POST');
      return path.includes('/pulls?') ? [pr] : pr;
    }, 'owner/repo', { head: pr.head.ref, base: 'main', body: expected }), /metadata differs/);
  }
});

test('main publication may accept a completed issue closure but never a not-planned dismissal', async () => {
  for (const state_reason of ['completed', 'not_planned']) {
    const request = async () => ({ title: 'Update PD2 Trader to 0.10.10', state: 'closed', state_reason });
    if (state_reason === 'completed') await lifecycle.validateIssue(request, 'owner/repo', '0.10.10', 42, true);
    else await assert.rejects(lifecycle.validateIssue(request, 'owner/repo', '0.10.10', 42, true), /Dismissed/);
    await assert.rejects(lifecycle.validateIssue(request, 'owner/repo', '0.10.10', 42), /Dismissed/);
  }
});
