import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'ohbe1jacobi/pd2-trader-flake';
const fields = ['repository', 'event', 'ref', 'sha', 'run', 'attempt'];
const storePath = /^\/nix\/store\/[0-9abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9+._?=-]+$/;
function trusted(context) {
  assert.equal(context.repository, repository);
  assert.ok((context.event === 'push' && ['refs/heads/main', 'refs/heads/develop'].includes(context.ref)) ||
    (context.event === 'workflow_dispatch' && /^refs\/heads\/(?:release\/|feature\/update-pd2-trader-)[0-9]+\.[0-9]+\.[0-9]+$/.test(context.ref)));
  assert.match(context.sha, /^[a-f0-9]{40}$/);
  assert.match(context.run, /^[1-9][0-9]*$/);
  assert.match(context.attempt, /^[1-9][0-9]*$/);
}
export function validateManifest(manifest, context, expectedRoots) {
  trusted(context);
  for (const field of fields) assert.equal(manifest[field], context[field], `Provenance mismatch: ${field}`);
  assert.ok(Array.isArray(manifest.roots) && manifest.roots.length > 0);
  for (const path of manifest.roots) assert.match(path, storePath);
  assert.deepEqual(manifest.roots, [...new Set(expectedRoots)].sort(), 'Unexpected store roots');
  return manifest.roots;
}
function run(args) {
  return execFileSync('nix', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}
function expectedRoots() {
  // Independently evaluate fixed package attributes from the exact trusted
  // checkout; never evaluate a manifest-supplied expression or installable.
  return [...new Set(JSON.parse(run(['eval', '--json', '--no-update-lock-file',
    '.#packages.x86_64-linux', '--apply', 'p: map (x: x.outPath) [ p.pd2-trader p.pd2-trader.native p.frontend ]'])))].sort();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generated = process.argv[2] === 'import-generated';
  const context = generated ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : Object.fromEntries(fields.map((key, index) => [key, process.env[
    ['GITHUB_REPOSITORY', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'][index]
  ]]));
  trusted(context);
  const directory = resolve(generated ? process.argv[4] : 'cache-transfer');
  const binaryCache = pathToFileURL(resolve(directory, 'store')).href;
  const manifestPath = resolve(directory, 'manifest.json');
  // Generated context is produced by the trusted main-only controller after
  // full source provenance validation and independent Nix evaluation.
  const roots = generated ? context.roots : expectedRoots();
  if (process.argv[2] === 'export') {
    mkdirSync(directory, { recursive: true });
    validateManifest({ ...context, roots }, context, roots);
    run(['copy', '--to', binaryCache, ...roots]);
    writeFileSync(manifestPath, JSON.stringify({ ...context, roots }) + '\n');
  } else if (process.argv[2] === 'import' || generated) {
    if (!generated) assert.equal(context.event, 'push');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest, context, roots);
    // Input-addressed paths alone CANNOT authenticate arbitrary NARs. Only
    // protected-branch builds or independently source-validated generated
    // builds reach import; no general PR/dispatch artifacts are authorized.
    run(['copy', '--no-check-sigs', '--from', binaryCache, ...roots]);
    writeFileSync(resolve(directory, 'validated-roots'), roots.join('\n') + '\n');
  } else throw new Error('Expected export or import');
}
