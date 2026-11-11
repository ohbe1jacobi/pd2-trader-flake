import { createHash } from 'node:crypto';
import { createReadStream, openSync, closeSync } from 'node:fs';
import { readFile, readdir, lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function selectArtifact(items, run) {
  const matches = items.filter(item => item.name === `flatpak-${run.id}-${run.run_attempt}`);
  if (matches.length !== 1) throw new Error('Missing or ambiguous Flatpak artifact');
  const item = matches[0];
  if (!Number.isSafeInteger(item.id) || item.id < 1 || item.expired !== false ||
      item.workflow_run?.id !== run.id || item.workflow_run?.head_sha !== run.head_sha ||
      item.workflow_run?.head_branch !== 'main' || !/^sha256:[a-f0-9]{64}$/.test(item.digest ?? '')) {
    throw new Error('Flatpak artifact identity/expiry mismatch');
  }
  return item;
}
export function expectedFiles(expected) {
  return ['SHA256SUMS', 'build-info.json', expected.bundle].sort();
}
export async function validateFiles(directory, expected) {
  const names = expectedFiles(expected);
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) throw new Error('Unexpected Flatpak artifact file set');
  const files = [];
  for (const name of names) {
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.size === 0) throw new Error('Invalid Flatpak artifact file');
    files.push({ name, path, size: stat.size, sha256: await fileHash(path) });
  }
  const info = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'));
  if (!isDeepStrictEqual(info, expected)) throw new Error('Flatpak metadata mismatch');
  const sums = files.filter(file => file.name !== 'SHA256SUMS').map(file => `${file.sha256}  ${file.name}\n`).join('');
  if (await readFile(join(directory, 'SHA256SUMS'), 'utf8') !== sums) throw new Error('Flatpak checksum mismatch');
  return files;
}
function command(runCommand, commandName, args, options = {}) {
  const result = runCommand(commandName, args, { encoding: 'utf8', timeout: 300_000, ...options });
  if (result.error || result.status !== 0) throw new Error(`Flatpak transfer failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function toFile(runCommand, commandName, args, path) {
  const fd = openSync(path, 'wx', 0o600);
  try { command(runCommand, commandName, args, { stdio: ['ignore', fd, 'pipe'] }); }
  finally { closeSync(fd); }
}
// Read ZIP members to fixed filenames, never extract candidate paths, modes,
// links or executables onto this privileged runner. Neither bundle nor scripts
// from the artifact are executed.
export async function loadArtifact({ request, repository, run, expected, directory, runCommand = spawnSync }) {
  const items = [];
  for (let page = 1; ; page++) {
    const batch = await request(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100&page=${page}`);
    if (!Array.isArray(batch.artifacts)) throw new Error('Invalid artifact listing');
    items.push(...batch.artifacts);
    if (batch.artifacts.length < 100) break;
  }
  const item = selectArtifact(items, run);
  const zip = join(directory, 'artifact.zip');
  toFile(runCommand, 'gh', ['api', `/repos/${repository}/actions/artifacts/${item.id}/zip`], zip);
  if (`sha256:${await fileHash(zip)}` !== item.digest) throw new Error('Artifact archive checksum mismatch');
  const names = command(runCommand, 'unzip', ['-Z1', zip]).trimEnd().split('\n').sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedFiles(expected))) throw new Error('Unexpected artifact ZIP file set');
  const output = await mkdtemp(join(directory, 'files-'));
  for (const name of names) toFile(runCommand, 'unzip', ['-p', zip, name], join(output, name));
  const readback = await request(`/repos/${repository}/actions/artifacts/${item.id}`);
  selectArtifact([readback], run);
  if (readback.id !== item.id || readback.name !== item.name || readback.digest !== item.digest) throw new Error('Artifact identity changed during download');
  return validateFiles(output, expected);
}
function assetLabel(name) {
  if (name.endsWith('.flatpak')) return 'Flatpak — Linux x86_64';
  if (name === 'SHA256SUMS') return 'Flatpak — SHA-256 checksums';
  if (name === 'build-info.json') return 'Flatpak — Build information';
  throw new Error(`Unexpected release asset: ${name}`);
}
export async function ensureAssets({ request, repository, release, files, runCommand = spawnSync }) {
  const root = `/repos/${repository}/releases`;
  const assets = [];
  for (let page = 1; ; page++) {
    const batch = await request(`${root}/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid asset listing');
    assets.push(...batch);
    if (batch.length < 100) break;
  }
  if (assets.some(asset => !files.some(file => file.name === asset.name))) throw new Error('Unexpected release asset');
  const matches = (asset, file) => asset?.name === file.name && asset.state === 'uploaded' &&
    asset.size === file.size && asset.digest === `sha256:${file.sha256}`;
  const matchesLabel = (asset, file) => matches(asset, file) && asset.label === assetLabel(file.name);
  // Detect every conflict before uploading anything; never use --clobber.
  for (const file of files) {
    const found = assets.filter(asset => asset.name === file.name);
    if (found.length > 1 || (found.length === 1 && !matches(found[0], file))) throw new Error(`Release asset conflict: ${file.name}`);
  }
  for (const file of files) {
    const existing = assets.find(asset => asset.name === file.name);
    if (!existing) {
      if (release.draft !== true) throw new Error(`Existing published release is missing asset: ${file.name}`);
      command(runCommand, 'gh', ['release', 'upload', release.tag_name, `${file.path}#${assetLabel(file.name)}`, '--repo', repository]);
    } else if (existing.label !== assetLabel(file.name)) {
      // Matching bytes may retain an older display label. Repair only metadata;
      // keep the filename, asset identity and contents unchanged on retries.
      if (!Number.isSafeInteger(existing.id) || existing.id < 1) throw new Error('Invalid release asset ID');
      await request(`${root}/assets/${existing.id}`, { method: 'PATCH', body: { label: assetLabel(file.name) } });
    }
  }
  const final = [];
  for (let page = 1; ; page++) {
    const batch = await request(`${root}/${release.id}/assets?per_page=100&page=${page}`);
    final.push(...batch);
    if (batch.length < 100) break;
  }
  if (final.length !== files.length) throw new Error('Release asset readback file set mismatch');
  for (const file of files) {
    const found = final.filter(asset => asset.name === file.name);
    if (found.length !== 1 || !matchesLabel(found[0], file) || !Number.isSafeInteger(found[0].id)) throw new Error('Release asset readback mismatch');
    if (!matchesLabel(await request(`${root}/assets/${found[0].id}`), file)) throw new Error('Release asset readback mismatch');
  }
}

export async function withArtifact(options, callback) {
  const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.TMPDIR, 'flatpak-publication-'));
  try { return await callback(await loadArtifact({ ...options, directory })); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
