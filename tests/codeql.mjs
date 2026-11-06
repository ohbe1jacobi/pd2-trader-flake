import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CodeQL scans both maintained branches, PRs, weekly and manual events', () => {
  const workflow = read('.github/workflows/codeql.yml');
  assert.match(workflow, /  push:\n    branches: \[main, develop\]/);
  assert.match(workflow, /  pull_request:\n    branches: \[main, develop\]/);
  assert.match(workflow, /  schedule:\n(?:    #[^\n]*\n)*    - cron: "\d+ \d+ \* \* [0-6]"/);
  assert.match(workflow, /  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request_target:|workflow_run:|paths-ignore:|\n    paths:/);
  assert.match(workflow, /group: codeql-\$\{\{ github.event_name \}\}-\$\{\{ github.ref \}\}/);
});

test('CodeQL analyzes repository automation without executing candidate builds or scripts', () => {
  const workflow = read('.github/workflows/codeql.yml');
  assert.match(workflow, /language: \[actions, javascript-typescript, python\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /languages: \$\{\{ matrix.language \}\}/);
  assert.match(workflow, /build-mode: none/);
  assert.match(workflow, /category: "\/language:\$\{\{ matrix.language \}\}"/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.doesNotMatch(workflow, /\brun:|\/autobuild@|secrets\.|\n\s+ref:|\n\s+environment:/);
  assert.match(workflow, /persist-credentials: false/);
  const uses = [...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
  assert.deepEqual(uses.map(match => match[1]), [
    'actions/checkout', 'github/codeql-action/init', 'github/codeql-action/analyze',
  ]);
  for (const [, action, revision] of uses) assert.match(revision, /^[a-f0-9]{40}$/, action);
  assert.equal(uses[1][2], uses[2][2], 'Initialize and analyze must use the same CodeQL version');
});

test('CodeQL grants only analysis upload permissions and is covered by local and sandbox checks', () => {
  const workflow = read('.github/workflows/codeql.yml');
  assert.match(workflow, /\npermissions:\n  contents: read\n/);
  assert.match(workflow, /    permissions:\n      contents: read\n      security-events: write\n/);
  assert.doesNotMatch(workflow, /contents: write|actions: write|packages: write|id-token: write|write-all/);
  const hooks = read('git-hooks.nix');
  assert.match(hooks, /codeql = \{/);
  assert.match(hooks, /node --test tests\/codeql\.mjs/);
  const flake = read('flake.nix');
  assert.match(flake, /codeql =/);
  assert.match(flake, /cp \$\{\.\/\.github\/workflows\/codeql\.yml\}/);
  assert.match(flake, /node --test tests\/codeql\.mjs/);
});
