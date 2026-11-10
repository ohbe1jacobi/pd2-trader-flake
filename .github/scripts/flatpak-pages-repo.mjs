import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat, mkdir, writeFile, mkdtemp, rename, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort());
}
function compareVersions(left, right) {
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
async function regularFile(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Invalid file (symlinks prohibited): ${path}`);
}
async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
const appId = 'io.github.ohbe1jacobi.PD2Trader';
const appRef = `app/${appId}/x86_64/stable`;
const runtime = 'org.gnome.Platform/x86_64/51';
const runtimeRepo = 'https://dl.flathub.org/repo/flathub.flatpakrepo';
function command(name, args, env, encoding = 'utf8') {
  const result = spawnSync(name, args, { env, encoding, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${name} ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
async function treeBytes(directory) {
  let bytes = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isDirectory()) bytes += await treeBytes(path);
    else if (stat.isFile()) bytes += stat.size;
    else throw new Error(`Unexpected site file: ${path}`);
  }
  return bytes;
}
function validateMetadata(text) {
  let section;
  const application = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#;]/.test(line)) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      if (section === 'Runtime') throw new Error('Unexpected runtime metadata');
    } else if (section === 'Application') {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (!match || application.has(match[1])) throw new Error('Malformed application metadata');
      application.set(match[1], match[2]);
    }
  }
  if (application.get('name') !== appId || application.get('runtime') !== runtime) throw new Error('Imported app/runtime metadata mismatch');
}
export async function assemble({ input, output, keyId, baseUrl, env = process.env, maxBytes = 900_000_000 }) {
  if (!(await lstat(input)).isDirectory()) throw new Error('Invalid input directory (symlinks prohibited)');
  await regularFile(join(input, 'manifest.json'));
  let manifest;
  try { manifest = JSON.parse(await readFile(join(input, 'manifest.json'), 'utf8')); }
  catch { throw new Error('Invalid manifest JSON'); }
  if (!exactKeys(manifest, ['schema', 'releases']) || manifest.schema !== 1 ||
      !Array.isArray(manifest.releases) || manifest.releases.length < 1 || manifest.releases.length > 2) throw new Error('Invalid manifest');
  let previous;
  for (const item of manifest.releases) {
    if (!exactKeys(item, ['version', 'bundle', 'sha256', 'commit', 'provenance']) ||
        !['github-actions', 'reviewed-local-bootstrap'].includes(item.provenance) ||
        typeof item.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(item.version) ||
        item.bundle !== `pd2-trader-${item.version}-x86_64.flatpak` ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        typeof item.commit !== 'string' || !/^[a-f0-9]{40}$/.test(item.commit) ||
        (previous && compareVersions(previous, item.version) >= 0)) throw new Error('Invalid manifest release or order');
    previous = item.version;
  }
  const expected = ['manifest.json', ...manifest.releases.map(item => item.bundle)].sort();
  if (JSON.stringify((await readdir(input)).sort()) !== JSON.stringify(expected)) throw new Error('Unexpected input file set');
  for (const item of manifest.releases) {
    const path = join(input, item.bundle);
    await regularFile(path);
    if (await hashFile(path) !== item.sha256) throw new Error(`Bundle checksum mismatch: ${item.bundle}`);
  }
  if (typeof keyId !== 'string' || !/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(keyId)) throw new Error('Signing key must be a full fingerprint');
  if (typeof env.GNUPGHOME !== 'string' || !env.GNUPGHOME) throw new Error('Existing GNUPGHOME is required');
  let pages;
  try { pages = new URL(baseUrl); } catch { throw new Error('Invalid Pages URL'); }
  if (typeof baseUrl !== 'string' || /[\s\x00-\x1f\x7f]/.test(baseUrl) || pages.username || pages.password || pages.search || pages.hash ||
      (pages.protocol !== 'https:' && !(pages.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(pages.hostname)))) throw new Error('Invalid Pages URL');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 900_000_000) throw new Error('Invalid site budget');
  try { await lstat(output); throw new Error('Output already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  input = resolve(input);
  output = resolve(output);
  if (output === input || output.startsWith(`${input}/`) || input.startsWith(`${output}/`)) throw new Error('Input/output paths overlap');
  try { if (!(await lstat(env.GNUPGHOME)).isDirectory()) throw new Error('not a directory'); }
  catch { throw new Error('GNUPGHOME must be an existing directory, not a symlink'); }
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), `.${basename(output)}-`));
  try {
    const repo = join(stage, 'repo');
    command('ostree', [`--repo=${repo}`, 'init', '--mode=archive-z2'], env);
    const releases = [];
    for (const item of manifest.releases) {
      command('flatpak', ['build-import-bundle', `--gpg-sign=${keyId}`, '--no-update-summary', repo, join(input, item.bundle)], env);
      const expectedRefs = [appRef, ...releases.map(release => `archive/${release.version}`)].sort();
      const refs = command('ostree', [`--repo=${repo}`, 'refs'], env).trim().split('\n').sort();
      if (JSON.stringify(refs) !== JSON.stringify(expectedRefs)) throw new Error('Imported bundle has unexpected app ref');
      const ostreeCommit = command('ostree', [`--repo=${repo}`, 'rev-parse', appRef], env).trim();
      const embeddedRef = command('ostree', [`--repo=${repo}`, 'show', '--print-metadata-key=xa.ref', ostreeCommit], env).trim();
      if (embeddedRef !== `'${appRef}'`) throw new Error('Imported commit metadata ref mismatch');
      validateMetadata(command('ostree', [`--repo=${repo}`, 'cat', ostreeCommit, '/metadata'], env));
      command('ostree', [`--repo=${repo}`, 'refs', `--create=archive/${item.version}`, ostreeCommit], env);
      releases.push({ ...item, ostreeCommit, bundleBytes: (await lstat(join(input, item.bundle))).size });
    }
    command('flatpak', ['build-update-repo', `--gpg-sign=${keyId}`, '--no-update-appstream', '--title=PD2 Trader', '--default-branch=stable', repo], env);
    command('ostree', [`--repo=${repo}`, 'fsck'], env);
    const publicKey = command('gpg', ['--batch', '--export-options', 'export-minimal', '--export', keyId], env, null).toString('base64');
    if (!publicKey) throw new Error('Signing public key export is empty');
    const url = new URL('repo/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
    await writeFile(join(stage, 'pd2-trader.flatpakrepo'), `[Flatpak Repo]\nTitle=PD2 Trader\nUrl=${url}\nDefaultBranch=stable\nGPGKey=${publicKey}\n`);
    await writeFile(join(stage, `${appId}.flatpakref`), `[Flatpak Ref]\nName=${appId}\nBranch=stable\nArch=x86_64\nTitle=PD2 Trader\nIsRuntime=false\nSuggestRemoteName=pd2-trader\nUrl=${url}\nRuntimeRepo=${runtimeRepo}\nGPGKey=${publicKey}\n`);
    const items = releases.map(item => `<li>${item.version}: ${item.provenance}; ${item.provenance === 'reviewed-local-bootstrap' ? 'commit is base checkout only, not exact CI source' : 'GitHub Actions source commit'}: <code>${item.commit}</code></li>`).join('');
    await writeFile(join(stage, 'index.html'), '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>PD2 Trader Flatpak</title><h1>PD2 Trader</h1><p>Experimental Linux x86_64 repository.</p><a href="pd2-trader.flatpakrepo">Add repository</a> <a href="' + appId + '.flatpakref">Install application</a> <a href="channel.json">Release information</a><ul>' + items + '</ul></html>\n');
    await writeFile(join(stage, '.nojekyll'), '');
    const channel = { schema: 1, appId, ref: appRef, runtime, url, latest: releases.at(-1).version, releases, repoBytes: await treeBytes(repo), siteBytes: 0 };
    // Include channel.json itself in the byte budget; converge after its size field settles.
    for (;;) {
      await writeFile(join(stage, 'channel.json'), JSON.stringify(channel, null, 2) + '\n');
      const bytes = await treeBytes(stage);
      if (bytes > maxBytes) throw new Error(`Site budget exceeded: ${bytes} > ${maxBytes} bytes`);
      if (bytes === channel.siteBytes) break;
      channel.siteBytes = bytes;
    }
    await rename(stage, output);
    return channel;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node flatpak-pages-repo.mjs INPUT OUTPUT');
    const channel = await assemble({ input: process.argv[2], output: process.argv[3],
      keyId: process.env.FLATPAK_GPG_KEY_ID, baseUrl: process.env.FLATPAK_PAGES_URL });
    console.log(JSON.stringify(channel));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
