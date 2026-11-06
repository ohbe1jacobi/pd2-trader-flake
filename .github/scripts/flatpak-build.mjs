import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, copyFileSync, createReadStream, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const appId = 'io.github.ohbe1jacobi.PD2Trader';
const revision = '7731e8b3fca73879f8217de5a919c0a5d17303de';
const runtime = 'org.gnome.Platform/x86_64/51';
const artifact = 'flatpak-artifact';
const diagnostics = 'flatpak-diagnostics';
const log = join(diagnostics, 'conversion.log');
const output = 'result-flatpak-ci';

function nixEval(args) {
  return execFileSync('nix', ['eval', '--raw', '--no-update-lock-file', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}
function positiveNumber(value, name) {
  assert.match(value ?? '', /^[1-9][0-9]*$/, `Invalid ${name}`);
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), `Invalid ${name}`);
  return number;
}
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

rmSync(artifact, { recursive: true, force: true });
rmSync(diagnostics, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
mkdirSync(diagnostics, { recursive: true });
writeFileSync(log, 'Flatpak conversion diagnostics\n');
try {
  const commit = process.env.GITHUB_SHA;
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Invalid GitHub commit');
  const runId = positiveNumber(process.env.GITHUB_RUN_ID, 'run ID');
  const runAttempt = positiveNumber(process.env.GITHUB_RUN_ATTEMPT, 'run attempt');
  const version = nixEval(['.#packages.x86_64-linux.default.version']);
  assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid evaluated application version');
  const lock = JSON.parse(readFileSync('flake.lock', 'utf8'));
  const converterNode = lock.nodes[lock.root].inputs.nix2flatpak;
  assert.equal(lock.nodes[converterNode].locked.rev, revision, 'Unexpected converter lock');
  // Resolve the Git-filtered flake through Nix, without a raw working-tree
  // path reference which could import ignored private files into the store.
  const resolved = JSON.parse(execFileSync('nix', ['flake', 'metadata', '--json', '--no-update-lock-file'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })).locks;
  const resolvedNode = resolved.nodes[resolved.root].inputs.nix2flatpak;
  const converterRevision = resolved.nodes[resolvedNode].locked.rev;
  assert.equal(converterRevision, revision, 'Evaluated converter differs from the pinned revision');

  // Do not parse warning text: the converter exit status is authoritative.
  const fd = openSync(log, 'a');
  let result;
  try {
    result = spawnSync('nix', ['build', '.#flatpak-prototype', '--out-link', output,
      '--no-update-lock-file', '--max-jobs', '1', '--cores', '1', '--print-build-logs'],
    { stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); }
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Flatpak conversion failed (status ${result.status}, signal ${result.signal}); see ${log}`);

  // Inspect the actual converted output rather than fabricating runtime metadata.
  execFileSync(process.execPath, ['flatpak/probe-bundle.mjs', output], { stdio: 'inherit' });
  const metadata = readFileSync(join(output, 'flatpak-dir/metadata'), 'utf8');
  const actualRuntime = metadata.match(/^runtime=([^\r\n]+)$/m)?.[1];
  assert.equal(actualRuntime, runtime, 'Unexpected converted runtime');
  const bundle = `pd2-trader-${version}-x86_64.flatpak`;
  mkdirSync(artifact);
  copyFileSync(join(output, `${appId}.flatpak`), join(artifact, bundle));
  writeFileSync(join(artifact, 'build-info.json'), JSON.stringify({ schema: 1, version, appId, commit,
    converterRevision, runtime: actualRuntime, runId, runAttempt, bundle }) + '\n');
  const sums = [];
  for (const name of ['build-info.json', bundle].sort()) sums.push(`${await hash(join(artifact, name))}  ${name}\n`);
  writeFileSync(join(artifact, 'SHA256SUMS'), sums.join(''));
  console.log(`Prepared ${artifact}/${bundle}; conversion diagnostics: ${log}`);
} catch (error) {
  rmSync(artifact, { recursive: true, force: true });
  appendFileSync(log, `\nPreparation failed: ${error.stack ?? error}\n`);
  console.error(error);
  process.exitCode = 1;
}
