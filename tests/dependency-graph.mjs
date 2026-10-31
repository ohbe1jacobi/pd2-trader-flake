import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pinned = JSON.parse(readFileSync(new URL('../flake.lock', import.meta.url), 'utf8'));

test('weekly Nix updates maintain the shipped version through reviewed main PRs and full CI', () => {
  const config = readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
  assert.match(config, /^version: 2$/m);
  assert.deepEqual([...config.matchAll(/package-ecosystem: "([^"]+)"/g)].map(match => match[1]), ['nix']);
  for (const setting of [
    '    directory: "/"',
    '    target-branch: "main"',
    '      interval: "weekly"',
    '      day: "monday"',
    '      time: "06:43"',
    '      timezone: "Etc/UTC"',
    '    open-pull-requests-limit: 1',
    '      prefix: "build"',
    '      include: "scope"',
    '      flake-inputs:',
    '        applies-to: version-updates',
    '        patterns: ["*"]',
    '      - dependency-name: "nixpkgs"',
    '      - dependency-name: "home-manager"',
  ]) assert.ok(config.split('\n').includes(setting), `Missing Dependabot policy: ${setting}`);
  const ceiling = `        versions: ["> ${pinned.nodes.nixpkgs.original.ref.slice('nixos-'.length)}"]`;
  assert.equal(config.split('\n').filter(line => line === ceiling).length, 2,
    'Block release-branch upgrades for both stable inputs, not same-branch revision updates');
  assert.doesNotMatch(config, /registries:|insecure-external-code-execution:|enable-beta-ecosystems:/);

  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /\n  pull_request:\n/);
  assert.match(ci, /Build application, including Vitest and Rust tests/);
  assert.match(ci, /Run all flake integration contracts/);
  // Dependabot must build normally, not wait for the release bot's dispatch.
  assert.doesNotMatch(readFileSync(new URL('../.github/scripts/cache-ci.mjs', import.meta.url), 'utf8'), /dependabot\[bot\]/);
});

test('flake inputs retain exact revisions, transitive edges and follows without duplicates', async () => {
  const { lockToSpdx } = await import('../.github/scripts/flake-lock-sbom.mjs');
  const sbom = lockToSpdx(pinned);
  assert.equal(sbom.spdxVersion, 'SPDX-2.3');
  assert.equal(sbom.packages.length, 5);
  const byName = Object.fromEntries(sbom.packages.map(pkg => [pkg.name, pkg]));
  const nixpkgs = byName['NixOS/nixpkgs'];
  assert.equal(nixpkgs.versionInfo, pinned.nodes.nixpkgs.locked.rev);
  assert.equal(nixpkgs.externalRefs[0].referenceLocator,
    `pkg:github/NixOS/nixpkgs@${pinned.nodes.nixpkgs.locked.rev}`);
  const edges = sbom.relationships.filter(edge => edge.relationshipType === 'DEPENDS_ON');
  assert.equal(edges.length, 6);
  assert.ok(edges.some(edge => edge.spdxElementId === byName['cachix/git-hooks.nix'].SPDXID
    && edge.relatedSpdxElement === nixpkgs.SPDXID));
  assert.equal(new Set(sbom.packages.map(pkg => pkg.SPDXID)).size, sbom.packages.length);
  assert.deepEqual(lockToSpdx(pinned), sbom, 'output must be deterministic');
});

test('invalid pins, missing nodes, unsupported sources and cyclic follows fail closed', async () => {
  const { lockToSpdx } = await import('../.github/scripts/flake-lock-sbom.mjs');
  for (const mutate of [
    lock => { lock.version = 8; },
    lock => { lock.nodes.nixpkgs.locked.rev = '718f670'; },
    lock => { lock.nodes.nixpkgs.locked.type = 'path'; },
    lock => { delete lock.nodes.nixpkgs; },
    lock => { lock.nodes.root.inputs.nixpkgs = ['nixpkgs']; },
  ]) {
    const lock = structuredClone(pinned);
    mutate(lock);
    assert.throws(() => lockToSpdx(lock), /version 7|Unsupported|Missing|Cyclic/);
  }
});

test('sbomnix adaptation preserves package edges and identifies the submission root', async () => {
  const { prepareSpdx } = await import('../.github/scripts/prepare-nix-sbom.mjs');
  const pkg = (id, purl) => ({ SPDXID: id, name: id, externalRefs: purl ? [{
    referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: purl,
  }] : [] });
  const edge = (from, to) => ({ spdxElementId: from, relationshipType: 'DEPENDS_ON', relatedSpdxElement: to });
  const input = { name: 'root', packages: [pkg('root', 'pkg:nix/app@1'),
    pkg('lib', 'pkg:nix/lib@2'), pkg('source')], relationships: [edge('root', 'lib'), edge('lib', 'source')] };
  const output = prepareSpdx(input);
  assert.equal(input.packages[0].SPDXID, 'root', 'do not mutate input');
  assert.equal(output.packages.length, 2, 'source fetches are not invented packages');
  assert.equal(output.packages[0].SPDXID, 'SPDXRef-RootPackage');
  assert.ok(output.relationships.some(r => r.spdxElementId === 'SPDXRef-RootPackage'
    && r.relatedSpdxElement === 'lib'));
  assert.ok(output.relationships.some(r => r.relationshipType === 'DESCRIBES'
    && r.relatedSpdxElement === 'SPDXRef-RootPackage'));
  assert.throws(() => prepareSpdx({ ...input, name: 'absent' }), /root/);
});

test('workflow isolates submission from evaluation and never publishes PR or feature-branch data', () => {
  const workflow = readFileSync(new URL('../.github/workflows/dependency-graph.yml', import.meta.url), 'utf8');
  const [generation, submission] = workflow.split('\n  submit:');
  assert.match(generation, /pull_request:/);
  assert.match(generation, /contents: read/);
  assert.doesNotMatch(generation, /contents: write|GH_TOKEN:|pull_request_target|workflow_run/);
  assert.match(generation, /--buildtime --exclude-meta --exclude-cpe-matching/);
  assert.match(generation, /--no-update-lock-file/);
  assert.match(submission, /github\.ref == 'refs\/heads\/main'/);
  assert.match(submission, /github\.event_name == 'push'/);
  assert.match(submission, /github\.event_name == 'workflow_dispatch'/);
  assert.match(submission, /contents: write/);
  assert.match(submission, /artifact-ids: \$\{\{ needs\.generate\.outputs\.artifact-id \}\}/);
  assert.doesNotMatch(submission, /install-nix-action|nix (build|eval|develop)|node \.github|actions\/checkout/);
  assert.equal((submission.match(/advanced-security\/spdx-dependency-submission-action@[a-f0-9]{40}/g) ?? []).length, 2);
  assert.match(submission, /manifestPath: flake.lock/);
  assert.match(submission, /manifestPath: native-package.nix/);
});

test('sbomnix versions containing plus survive the submission toolkit parser', async () => {
  const { prepareSpdx } = await import('../.github/scripts/prepare-nix-sbom.mjs');
  const output = prepareSpdx({ name: 'root', relationships: [], packages: [{
    SPDXID: 'root', name: 'xvfb-run', versionInfo: '1+g87f6705', externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl',
      referenceLocator: 'pkg:nix/xvfb-run@1%2Bg87f6705',
    }],
  }] });
  assert.equal(output.packages[0].externalRefs[0].referenceLocator, 'pkg:nix/xvfb-run@1+g87f6705');
  assert.equal(output.packages[0].versionInfo, '1+g87f6705', 'do not alter the version');
});

test('paths through unversioned artifacts survive filtering, including cycles', async () => {
  const { prepareSpdx } = await import('../.github/scripts/prepare-nix-sbom.mjs');
  const packages = ['root', 'artifact', 'library'].map(SPDXID => ({
    SPDXID, name: SPDXID, externalRefs: SPDXID === 'artifact' ? [] : [{
      referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:nix/${SPDXID}@1`,
    }],
  }));
  const relationships = [['root', 'artifact'], ['artifact', 'library'], ['artifact', 'artifact']]
    .map(([from, to]) => ({ spdxElementId: from, relationshipType: 'DEPENDS_ON', relatedSpdxElement: to }));
  const output = prepareSpdx({ name: 'root', packages, relationships });
  assert.deepEqual(output.relationships.filter(edge => edge.relationshipType === 'DEPENDS_ON'), [{
    spdxElementId: 'SPDXRef-RootPackage', relationshipType: 'DEPENDS_ON', relatedSpdxElement: 'library',
  }]);
});

test('nested follows paths resolve from the lock root and unreachable nodes are not reported', async () => {
  const { lockToSpdx } = await import('../.github/scripts/flake-lock-sbom.mjs');
  const lock = structuredClone(pinned);
  lock.nodes['home-manager'].inputs.nixpkgs = ['git-hooks', 'nixpkgs'];
  lock.nodes.unused = { locked: { type: 'path', path: '/must-not-be-read' } };
  const inputs = document => document.packages.filter(pkg => pkg.SPDXID !== 'SPDXRef-RootPackage');
  assert.deepEqual(inputs(lockToSpdx(lock)), inputs(lockToSpdx(pinned)));
  assert.deepEqual(lockToSpdx(lock).relationships, lockToSpdx(pinned).relationships);
});
