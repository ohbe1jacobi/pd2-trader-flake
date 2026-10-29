import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = await import('../.github/scripts/prepare-update.mjs').catch(() => ({}));

test('accepts only canonical stable application versions', () => {
  assert.equal(typeof script.validateVersion, 'function', 'version validator is implemented');
  assert.equal(script.validateVersion('0.10.10'), '0.10.10');
  for (const value of ['', undefined, 'v0.10.10', '01.2.3', '1.2.3-rc1', '1.2.3\n', '--help', '1.2.3;touch bad']) {
    assert.throws(() => script.validateVersion(value), /version/i);
  }
});

const hash = byte => `sha256-${Buffer.alloc(32, byte).toString('base64')}`;
const native = (version = '0.10.9', byte = 1) => `let
  version = "${version}";
  src = { hash = "${hash(byte)}"; };
  frontend = { npmDepsHash = "${hash(byte + 1)}"; doCheck = true; };
in { cargoHash = "${hash(byte + 2)}"; doCheck = true; }
`;
const readme = 'Builds the pinned upstream **0.10.9** release. Example v0.10.9 remains.\n';
const before = { native: native(), readme, flake: 'flake baseline', lock: 'lock baseline' };
const after = { ...before, native: native('0.10.10', 4), readme: readme.replace('**0.10.9**', '**0.10.10**') };

test('allows exactly the four native values and packaged README reference', () => {
  assert.equal(typeof script.validateGeneratedDiff, 'function', 'diff validator is implemented');
  assert.deepEqual(script.validateGeneratedDiff(before, after, ['README.md', 'native-package.nix'], '0.10.10'), {
    version: '0.10.10', hash: hash(4), npmDepsHash: hash(5), cargoHash: hash(6),
  });
  assert.equal(script.updateReadme(readme, '0.10.9', '0.10.10'), after.readme);
  assert.throws(() => script.updateReadme('No packaged reference', '0.10.9', '0.10.10'), /README/);
  assert.throws(() => script.updateReadme(readme + readme, '0.10.9', '0.10.10'), /README/);
  for (const changed of [
    { ...after, native: after.native.replace('doCheck = true', 'doCheck = false') },
    { ...after, native: after.native + '# extra change\n' },
    { ...after, native: native('0.10.11', 4) },
    { ...after, native: after.native.replace(hash(4), hash(0)) },
    { ...after, native: after.native.replace(hash(4), 'sha256-invalid') },
    { ...after, native: after.native + 'version = "0.10.10";\n' },
    { ...after, readme: after.readme.replace('Example v0.10.9', 'Example v0.10.10') },
    { ...after, flake: 'changed flake' },
    { ...after, lock: 'changed lock' },
  ]) assert.throws(() => script.validateGeneratedDiff(before, changed, ['native-package.nix'], '0.10.10'));
  assert.throws(() => script.validateGeneratedDiff(before, after, ['evil.nix'], '0.10.10'), /allowed/);
  assert.deepEqual(script.validateGeneratedDiff(after, after, [], '0.10.10'), script.validateGeneratedDiff(before, after, [], '0.10.10'));
});

test('exports a strict payload validator for the privileged writer', () => {
  assert.equal(typeof script.validateGeneratedUpdate, 'function');
  assert.deepEqual(script.validateGeneratedUpdate({
    beforeNative: before.native, afterNative: after.native,
    beforeReadme: before.readme, afterReadme: after.readme, version: '0.10.10',
  }), { version: '0.10.10', hash: hash(4), npmDepsHash: hash(5), cargoHash: hash(6) });
});

test('requires realized recursive hashes and both upstream test flags', () => {
  assert.equal(typeof script.validateRealizedHashes, 'function');
  const declared = { version: '0.10.10', hash: hash(4), npmDepsHash: hash(5), cargoHash: hash(6) };
  const evaluated = { ...declared, nativeCheck: true, frontendCheck: true };
  const realized = { hash: hash(4), npmDepsHash: hash(5), cargoHash: hash(6) };
  assert.doesNotThrow(() => script.validateRealizedHashes(declared, evaluated, realized));
  for (const key of ['hash', 'npmDepsHash', 'cargoHash']) {
    assert.throws(() => script.validateRealizedHashes(declared, { ...evaluated, [key]: hash(9) }, realized), /hash/i);
    assert.throws(() => script.validateRealizedHashes(declared, evaluated, { ...realized, [key]: hash(9) }), /hash/i);
  }
  assert.throws(() => script.validateRealizedHashes(declared, { ...evaluated, nativeCheck: false }, realized), /doCheck/);
  assert.throws(() => script.validateRealizedHashes(declared, { ...evaluated, frontendCheck: false }, realized), /doCheck/);
  assert.throws(() => script.validateRealizedHashes(declared, { ...evaluated, version: '0.10.9' }, realized), /version/i);
});

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'prepare-update-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const [file, contents] of Object.entries({ 'native-package.nix': before.native, 'README.md': before.readme, 'flake.nix': before.flake, 'flake.lock': before.lock })) {
    await writeFile(join(cwd, file), contents);
  }
  return cwd;
}

function mockTools(cwd, { dirty = false, mutateSecond = false, badHash = false } = {}) {
  const calls = [];
  let updates = 0;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') {
      if (args.includes('status')) return dirty ? ' M unrelated\0' : '';
      if (args.includes('--name-only')) return 'native-package.nix\0README.md\0';
      return '';
    }
    if (command === '/trusted/nix-update') {
      updates++;
      await writeFile(join(cwd, 'native-package.nix'), after.native + (mutateSecond && updates === 2 ? '# non-idempotent\n' : ''));
      return '';
    }
    assert.equal(command, 'nix');
    if (args[0] === 'eval') return JSON.stringify({ version: '0.10.10', hash: hash(4), npmDepsHash: hash(5), cargoHash: hash(6), nativeCheck: true, frontendCheck: true });
    if (args[0] === 'build') return JSON.stringify([{ outputs: { out: `/nix/store/${'a'.repeat(32)}-${args.at(-1).split('.').at(-1)}` } }]);
    if (args[0] === 'hash') {
      const path = args.at(-1);
      return hash(badHash ? 9 : path.endsWith('-src') ? 4 : path.endsWith('-npmDeps') ? 5 : 6) + '\n';
    }
    assert.fail(`Unexpected command ${command} ${args.join(' ')}`);
  };
  return { run, calls };
}

test('tokenless generator verifies fixed outputs, repeats update, and emits only validated base64 payloads', async t => {
  assert.equal(typeof script.prepareUpdate, 'function');
  const cwd = await fixture(t);
  const { run, calls } = mockTools(cwd);
  const output = join(cwd, 'workflow-output');
  const result = await script.prepareUpdate({ cwd, env: { PATH: '/trusted/bin', TMPDIR: tmpdir(), UPDATE_VERSION: '0.10.10', NIX_UPDATE_BIN: '/trusted/nix-update', GITHUB_OUTPUT: output, UNRELATED_SECRET: 'must-not-reach-nix' }, run });
  assert.equal(result.version, '0.10.10');
  const updates = calls.filter(call => call.command === '/trusted/nix-update');
  assert.equal(updates.length, 2, 'repeat must prove idempotence');
  for (const call of updates) assert.deepEqual(call.args, ['--flake', 'pd2-trader.native', '--version=0.10.10', '--subpackage', 'frontend', '--option', 'sandbox', 'true', '--option', 'max-jobs', '1', '--option', 'cores', '1']);
  assert.equal(calls.filter(call => call.command === 'nix' && call.args[0] === 'build').length, 3);
  for (const call of calls) {
    assert.equal(call.options.cwd, cwd);
    assert.equal(call.options.env.UNRELATED_SECRET, undefined);
    assert.equal(call.options.env.GITHUB_OUTPUT, undefined);
    assert.notEqual(call.options.env.HOME, process.env.HOME);
    assert.ok(!call.args.includes('update'), 'no flake update');
  }
  assert.equal(await readFile(output, 'utf8'), `native=${Buffer.from(after.native).toString('base64')}\nreadme=${Buffer.from(after.readme).toString('base64')}\n`);
});

test('generator fails closed on dirty input, non-idempotence, invalid hash, or token-bearing environment', async t => {
  assert.equal(typeof script.prepareUpdate, 'function');
  for (const options of [{ dirty: true }, { mutateSecond: true }, { badHash: true }]) {
    const cwd = await fixture(t);
    const { run } = mockTools(cwd, options);
    const output = join(cwd, 'workflow-output');
    await assert.rejects(() => script.prepareUpdate({ cwd, env: { UPDATE_VERSION: '0.10.10', NIX_UPDATE_BIN: '/trusted/nix-update', GITHUB_OUTPUT: output }, run }));
    await assert.rejects(() => readFile(output), /ENOENT/);
  }
  let ran = false;
  await assert.rejects(() => script.prepareUpdate({ env: { UPDATE_VERSION: '0.10.10', GITHUB_TOKEN: 'never-pass' }, run: async () => { ran = true; } }), /token/i);
  assert.equal(ran, false);
});
