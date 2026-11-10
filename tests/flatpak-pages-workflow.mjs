import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

test('Pages signing is opt-in, main-only and separate from application builds', () => {
  const workflow = readFileSync('.github/workflows/flatpak-pages.yml', 'utf8');
  assert.match(workflow, /workflows: \[Publish tested packaging release\]/);
  assert.match(workflow, /vars\.FLATPAK_PAGES_ENABLED == 'true'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /group: pd2-release-state/);
  assert.match(workflow, /environment: flatpak-publish/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node \.github\/scripts\/flatpak-pages-source\.mjs/);
  assert.match(workflow, /node \.github\/scripts\/flatpak-pages-repo\.mjs/);
  assert.doesNotMatch(workflow, /nix build|nix develop|flatpak run|pull_request:|release:\n/);
  assert.match(workflow, /FLATPAK_GPG_PRIVATE_KEY: \$\{\{ secrets\.FLATPAK_GPG_PRIVATE_KEY \}\}/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /gpgconf --kill all/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /name: github-pages/);
  assert.match(workflow, /needs: assemble/);
  assert.match(workflow, /Verify deployed channel/);
  for (const line of workflow.split('\n').filter(line => /uses:/.test(line))) {
    assert.match(line, /@[a-f0-9]{40}(?:\s|$)/, line);
  }
});

test('deployed readback requires channel, summary and signature bytes, not HTTP success alone', () => {
  const workflow = readFileSync('.github/workflows/flatpak-pages.yml', 'utf8');
  const script = workflow.match(/node --input-type=module <<'JS'\n([\s\S]+?)\n\s+JS/)[1]
    .replace("import { setTimeout } from 'node:timers/promises';", 'const setTimeout = async () => {};');
  const digest = value => createHash('sha256').update(value).digest('hex');
  for (const wrong of [null, 'channel.json', 'repo/summary', 'repo/summary.sig', 'network']) {
    const setup = `globalThis.fetch = async url => {
      const path = new URL(url).pathname.replace('/project/', '');
      if (${JSON.stringify(wrong)} === 'network') throw new Error('offline');
      const body = path === ${JSON.stringify(wrong)} ? 'stale' : path;
      return { ok: true, arrayBuffer: async () => Buffer.from(body) };
    };`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', setup + script], {
      encoding: 'utf8', timeout: 10000,
      env: { PAGE_URL: 'https://example.org/project/', EXPECTED_SHA256: digest('channel.json'),
        EXPECTED_SUMMARY: digest('repo/summary'), EXPECTED_SIGNATURE: digest('repo/summary.sig') },
    });
    assert.equal(result.status, wrong === null ? 0 : 1, result.stderr);
    if (wrong === null) assert.match(result.stdout, /channel, summary and signature digests verified/);
    else assert.match(result.stderr, /did not match this publication/);
  }
});
