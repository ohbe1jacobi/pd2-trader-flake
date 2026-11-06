import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../.github/scripts/flatpak-build.mjs', import.meta.url);
const revision = '7731e8b3fca73879f8217de5a919c0a5d17303de';
const appId = 'io.github.ohbe1jacobi.PD2Trader';
const commit = 'a'.repeat(40);
const bundle = 'pd2-trader-0.10.16-x86_64.flatpak';
function fixture(t, { exit = 0, warning = 'WARNING: informational libstdc++ detection warning', evaluatedRevision = revision } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'flatpak-build-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const directory of ['bin', 'flatpak', 'converted/flatpak-dir/files/bin', 'converted/flatpak-dir/export/share/applications']) mkdirSync(join(cwd, directory), { recursive: true });
  copyFileSync(new URL('../flatpak/probe-bundle.mjs', import.meta.url), join(cwd, 'flatpak/probe-bundle.mjs'));
  writeFileSync(join(cwd, 'converted/flatpak-dir/files/bin/pd2-trader'), '#!/bin/sh\n# PD2_TRADER_D2_DIR\nexec helper --diablo2-directory "$PD2_TRADER_D2_DIR"\n', { mode: 0o755 });
  writeFileSync(join(cwd, `converted/flatpak-dir/export/share/applications/${appId}.desktop`), '[Desktop Entry]\n');
  writeFileSync(join(cwd, 'converted/flatpak-dir/metadata'), `[Application]\nname=${appId}\ncommand=pd2-trader\nruntime=org.gnome.Platform/x86_64/51\n[Context]\nfilesystems=\n[Session Bus Policy]\norg.kde.StatusNotifierWatcher=talk\norg.com_pd2_trader_app.SingleInstance=own\n`);
  writeFileSync(join(cwd, `converted/${appId}.flatpak`), 'test bundle bytes\n');
  writeFileSync(join(cwd, 'converted/build-info.json'), JSON.stringify({ appId, runtime: 'org.gnome.Platform/51', bundleFile: `${appId}.flatpak` }));
  writeFileSync(join(cwd, 'flake.lock'), JSON.stringify({ root: 'root', nodes: { root: { inputs: { nix2flatpak: 'converter' } }, converter: { locked: { rev: revision } } } }));
  writeFileSync(join(cwd, 'bin/nix'), `#!${process.execPath}\nimport { appendFileSync, symlinkSync } from 'node:fs';\nconst args = process.argv.slice(2);\nappendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');\nif (args[0] === 'eval') console.log('0.10.16');\nelse if (args[0] === 'flake' && args[1] === 'metadata') console.log(JSON.stringify({locks:{root:'root',nodes:{root:{inputs:{nix2flatpak:'converter'}},converter:{locked:{rev:'${evaluatedRevision}'}}}}}));\nelse if (args[0] === 'build') {\n console.log('converter stdout'); console.error(${JSON.stringify(warning)});\n if (${exit} !== 0) process.exit(${exit});\n symlinkSync('converted', args[args.indexOf('--out-link') + 1]);\n} else process.exit(99);\n`);
  chmodSync(join(cwd, 'bin/nix'), 0o755);
  const run = (extra = {}) => spawnSync(process.execPath, [script.pathname], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, GITHUB_SHA: commit, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', ...extra } });
  return { cwd, run };
}

test('successful converter process with informational warnings prepares exactly the versioned artifact and sorted checksums', t => {
  const { cwd, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const directory = join(cwd, 'flatpak-artifact');
  assert.deepEqual(readdirSync(directory).sort(), ['SHA256SUMS', 'build-info.json', bundle].sort());
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'build-info.json'))), {
    schema: 1, version: '0.10.16', appId, commit, converterRevision: revision,
    runtime: 'org.gnome.Platform/x86_64/51', runId: 123, runAttempt: 2, bundle,
  });
  const expected = ['build-info.json', bundle].sort().map(name => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`).join('');
  assert.equal(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), expected);
  assert.match(readFileSync(join(cwd, 'flatpak-diagnostics/conversion.log'), 'utf8'), /WARNING: informational/);
  const calls = readFileSync(join(cwd, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const build = calls.find(args => args[0] === 'build');
  assert.ok(build.includes('.#flatpak-prototype'));
  for (const flag of ['--no-update-lock-file', '--max-jobs', '--cores', '--print-build-logs']) assert.ok(build.includes(flag));
  assert.ok(calls.every(args => !args.some(arg => arg.includes('flatpak-repo-prototype'))));
});

test('a converter process that exits nonzero fails even if its output is only an informational warning', t => {
  const { cwd, run } = fixture(t, { exit: 17 });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Flatpak conversion failed/);
  assert.match(readFileSync(join(cwd, 'flatpak-diagnostics/conversion.log'), 'utf8'), /WARNING: informational/);
  assert.throws(() => readdirSync(join(cwd, 'flatpak-artifact')), { code: 'ENOENT' });
});

test('the structural bundle probe rejects an unexpected runtime before artifact preparation', t => {
  const { cwd, run } = fixture(t);
  const metadata = join(cwd, 'converted/flatpak-dir/metadata');
  writeFileSync(metadata, readFileSync(metadata, 'utf8').replace('Platform/x86_64/51', 'Platform/x86_64/50'));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.throws(() => readdirSync(join(cwd, 'flatpak-artifact')), { code: 'ENOENT' });
});

test('mismatched converter lock and malformed run identifiers do not produce artifacts', t => {
  const { cwd, run } = fixture(t);
  assert.notEqual(run({ GITHUB_RUN_ATTEMPT: '0' }).status, 0);
  const lock = JSON.parse(readFileSync(join(cwd, 'flake.lock')));
  lock.nodes.converter.locked.rev = 'b'.repeat(40);
  writeFileSync(join(cwd, 'flake.lock'), JSON.stringify(lock));
  assert.notEqual(run().status, 0);
  assert.throws(() => readdirSync(join(cwd, 'flatpak-artifact')), { code: 'ENOENT' });
});

test('resolved flake metadata must agree with the literal converter lock', t => {
  const { cwd, run } = fixture(t, { evaluatedRevision: 'b'.repeat(40) });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /converter/i);
  assert.throws(() => readdirSync(join(cwd, 'flatpak-artifact')), { code: 'ENOENT' });
});

test('workflow builds after the native package, tests the launcher, and uploads only non-mirrored artifacts', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const native = workflow.indexOf('Build application, including Vitest and Rust tests');
  const launcher = workflow.indexOf('.#checks.x86_64-linux.flatpak-launcher');
  const conversion = workflow.indexOf('node .github/scripts/flatpak-build.mjs');
  assert.ok(native >= 0 && launcher > native && conversion > launcher);
  assert.match(workflow, /node --test tests\/flatpak-build\.mjs/);
  assert.match(workflow, /name: flatpak-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /name: flatpak-diagnostics-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  const artifactStep = workflow.split('      - name: Upload Flatpak artifact')[1].split('      - name:')[0];
  const diagnosticStep = workflow.split('      - name: Upload Flatpak diagnostics')[1].split('      - name:')[0];
  for (const step of [artifactStep, diagnosticStep]) {
    assert.match(step, /steps\.gate\.outputs\.mirror != 'true'/);
    assert.match(step, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
    assert.match(step, /if-no-files-found: error/);
    assert.match(step, /compression-level: 0/);
  }
  assert.match(diagnosticStep, /always\(\)/);
  assert.match(diagnosticStep, /steps\.flatpak-build\.outcome == 'failure'/);
});
