// Offline contracts: node --test tests/flatpak-pages-repo.mjs
// Real synthetic bundles + disposable TEST ONLY keys (no runtime downloads):
// FLATPAK_PAGES_INTEGRATION=1 node --test tests/flatpak-pages-repo.mjs
// Integration PATH needs node, flatpak, ostree, gpg and gpgconf; localhost HTTP only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { stat, readdir } from 'node:fs/promises';

const release = (version = '0.10.9') => ({ version, bundle: `pd2-trader-${version}-x86_64.flatpak`, sha256: createHash('sha256').update('bundle').digest('hex'), commit: 'a'.repeat(40), provenance: 'github-actions' });
async function withBundle(t, releases = [release()]) {
  const options = await fixture(t, { schema: 1, releases });
  for (const item of releases) if (/^[\w.-]+$/.test(item.bundle)) await writeFile(join(options.input, item.bundle), 'bundle');
  return options;
}

const script = new URL('../.github/scripts/flatpak-pages-repo.mjs', import.meta.url);
async function fixture(t, manifest = { schema: 1, releases: [] }) {
  const root = await mkdtemp(join(tmpdir(), 'flatpak-pages-test-only-'));
  const input = join(root, 'input'), output = join(root, 'site');
  const options = { root, input, output, keyId: 'A'.repeat(40), baseUrl: 'https://example.org/pd2-trader/' };
  t.after(async () => {
    if (options.env) spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env: options.env });
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(input);
  await writeFile(join(input, 'manifest.json'), JSON.stringify(manifest));
  return options;
}

test('strict manifest rejects malformed fields, duplicates, traversal and non-numeric order', async t => {
  const { assemble } = await import(script);
  const manifests = [
    null, [], { schema: 2, releases: [release()] }, { schema: 1, releases: [release()], extra: true },
    { schema: 1, releases: [release(), release()] },
    { schema: 1, releases: [release('0.10.10'), release('0.10.9')] },
    { schema: 1, releases: [release('0.10.8'), release('0.10.9'), release('0.10.10')] },
    ...[{ version: 'v0.10.9' }, { version: '00.10.9' }, { bundle: '../escape.flatpak' }, { bundle: 'wrong.flatpak' }, { sha256: 'A'.repeat(64) }, { commit: 'abc' }, { surprise: true }].map(change => ({ schema: 1, releases: [{ ...release(), ...change }] })),
  ];
  for (const manifest of manifests) await assert.rejects(assemble(await fixture(t, manifest)), /manifest/i);
});

test('input rejects unexpected files, symlinks and mismatched bundle checksums', async t => {
  const { assemble } = await import(script);
  for (const kind of ['extra', 'symlink', 'checksum', 'manifest-link', 'directory']) {
    const options = await withBundle(t);
    if (kind === 'extra') await writeFile(join(options.input, 'extra'), 'untrusted');
    if (kind === 'checksum') await writeFile(join(options.input, release().bundle), 'changed');
    if (kind === 'symlink' || kind === 'directory') {
      await rm(join(options.input, release().bundle));
      if (kind === 'symlink') await symlink('../manifest.json', join(options.input, release().bundle));
      else await mkdir(join(options.input, release().bundle));
    }
    if (kind === 'manifest-link') {
      await rm(join(options.input, 'manifest.json'));
      await symlink('../absent', join(options.input, 'manifest.json'));
    }
    await assert.rejects(assemble(options), /file|checksum|symlink/i);
  }
});

function command(name, args, env) {
  const result = spawnSync(name, args, { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${name} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const appId = 'io.github.ohbe1jacobi.PD2Trader';
const appRef = `app/${appId}/x86_64/stable`;
const integration = process.env.FLATPAK_PAGES_INTEGRATION === '1';
async function realFixture(t) {
  const options = await fixture(t);
  const home = join(options.root, 'TEST-ONLY-gnupg');
  await mkdir(home, { mode: 0o700 });
  const env = { ...process.env, GNUPGHOME: home, HOME: options.root,
    XDG_DATA_HOME: join(options.root, 'data'), XDG_CONFIG_HOME: join(options.root, 'config'),
    XDG_CACHE_HOME: join(options.root, 'cache'), FLATPAK_USER_DIR: join(options.root, 'installation') };
  options.env = env;
  command('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-generate-key',
    'Disposable Flatpak Pages TEST ONLY <test-only@invalid.example>', 'rsa2048', 'sign', '0'], env);
  options.keyId = command('gpg', ['--batch', '--with-colons', '--list-keys'], env).split('\n').find(line => line.startsWith('fpr:')).split(':')[9];
  await writeFile(join(home, 'pubring.gpg'), spawnSync('gpg', ['--batch', '--export', options.keyId], { env }).stdout);
  const source = join(options.root, 'source');
  const build = join(options.root, 'build');
  await mkdir(join(build, 'files'), { recursive: true });
  await mkdir(join(build, 'export'));
  const releases = [];
  for (const version of ['0.10.9', '0.10.10']) {
    await writeFile(join(build, 'metadata'), `[Application]\nname=${appId}\nruntime=org.gnome.Platform/x86_64/51\ncommand=test-only\n`);
    await writeFile(join(build, 'files/version'), version);
    command('flatpak', ['build-export', '--disable-sandbox', '--arch=x86_64', source, build, 'stable'], env);
    const item = release(version);
    command('flatpak', ['build-bundle', '--arch=x86_64', source, join(options.input, item.bundle), appId, 'stable'], env);
    item.sha256 = createHash('sha256').update(await readFile(join(options.input, item.bundle))).digest('hex');
    releases.push(item);
  }
  await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases }));
  return { ...options, env, releases, source, build };
}

test('real two-version signed archive repository and public descriptors', { skip: !integration }, async t => {
  const options = await realFixture(t);
  const { assemble } = await import(script);
  options.releases[0].provenance = 'reviewed-local-bootstrap';
  await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases: options.releases }));
  const channel = await assemble(options);
  assert.equal(channel.releases[0].provenance, 'reviewed-local-bootstrap');
  assert.match(await readFile(join(options.output, 'index.html'), 'utf8'), /reviewed-local-bootstrap/);
  assert.match(await readFile(join(options.output, 'index.html'), 'utf8'), /base checkout only/i);
  assert.match(await readFile(join(options.output, 'index.html'), 'utf8'), /<p>Linux x86_64 repository\.<\/p>/);
  assert.doesNotMatch(await readFile(join(options.output, 'index.html'), 'utf8'), /experimental/i);
  assert.equal(channel.latest, '0.10.10');
  assert.equal(channel.ref, appRef);
  assert.equal(channel.releases.length, 2);
  assert.ok(channel.siteBytes <= 900_000_000);
  const repo = join(options.output, 'repo');
  let measuredSiteBytes = 0, measuredRepoBytes = 0;
  const pending = [options.output];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else {
        assert.ok(entry.isFile(), 'Pages site must contain only regular files/directories');
        const bytes = (await stat(path)).size;
        measuredSiteBytes += bytes;
        if (path.startsWith(`${repo}/`)) measuredRepoBytes += bytes;
      }
    }
  }
  assert.equal(channel.siteBytes, measuredSiteBytes);
  assert.equal(channel.repoBytes, measuredRepoBytes);
  assert.ok((await stat(join(repo, 'summary.sig'))).size > 0);
  assert.equal(command('ostree', [`--repo=${repo}`, 'config', 'get', 'core.mode'], options.env), 'archive-z2');
  command('ostree', [`--repo=${repo}`, 'fsck'], options.env);
  for (const item of channel.releases) {
    assert.match(item.ostreeCommit, /^[a-f0-9]{64}$/);
    assert.equal(item.bundleBytes, (await stat(join(options.input, item.bundle))).size);
    assert.equal(command('ostree', [`--repo=${repo}`, 'rev-parse', `archive/${item.version}`], options.env), item.ostreeCommit);
    assert.match(command('ostree', [`--repo=${repo}`, 'show', `--gpg-homedir=${options.env.GNUPGHOME}`, item.ostreeCommit], options.env), /Good signature/);
  }
  assert.equal(command('ostree', [`--repo=${repo}`, 'rev-parse', appRef], options.env), channel.releases[1].ostreeCommit);
  const publicKey = command('gpg', ['--batch', '--export', options.keyId], options.env);
  assert.ok(publicKey.length > 0);
  for (const name of ['pd2-trader.flatpakrepo', `${appId}.flatpakref`]) {
    const descriptor = await readFile(join(options.output, name), 'utf8');
    assert.match(descriptor, /GPGKey=[A-Za-z0-9+/]+=*/);
    assert.match(descriptor, /Url=https:\/\/example.org\/pd2-trader\/repo\//);
  }
  assert.match(await readFile(join(options.output, `${appId}.flatpakref`), 'utf8'), /RuntimeRepo=https:\/\/dl.flathub.org\/repo\/flathub.flatpakrepo/);
  assert.match(await readFile(join(options.output, `${appId}.flatpakref`), 'utf8'), /SuggestRemoteName=pd2-trader/);
  assert.deepEqual(JSON.parse(await readFile(join(options.output, 'channel.json'), 'utf8')), channel);
  assert.match(await readFile(join(options.output, 'index.html'), 'utf8'), /pd2-trader.flatpakrepo/);
});
test('requires signing fingerprint, GNUPGHOME and safe absolute Pages URL before any tool runs', async t => {
  const { assemble } = await import(script);
  for (const change of [
    { keyId: 'short' }, { keyId: '--keyserver=example.org' }, { env: {} },
    { baseUrl: 'file:///tmp/site' }, { baseUrl: 'https://user:password@example.org/' },
    { baseUrl: 'https://example.org/?query=x' }, { baseUrl: 'https://example.org/#fragment' },
    { baseUrl: 'https://example.org/\nInjected=true' }, { maxBytes: 900_000_001 },
  ]) await assert.rejects(assemble({ ...await withBundle(t), env: { GNUPGHOME: '/unused' }, ...change }), /fingerprint|GNUPGHOME|URL|budget/i);
});

test('rejects input directory symlinks, malformed JSON and missing bundles', async t => {
  const { assemble } = await import(script);
  const options = await withBundle(t);
  const alias = join(options.root, 'alias');
  await symlink(options.input, alias);
  await assert.rejects(assemble({ ...options, input: alias }), /symlink/i);
  await writeFile(join(options.input, 'manifest.json'), '{not JSON');
  await assert.rejects(assemble(options), /manifest JSON/i);
  await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases: [release()] }));
  await rm(join(options.input, release().bundle));
  await assert.rejects(assemble(options), /file set/i);
});

test('refuses overlapping input and output before invoking tools', async t => {
  const { assemble } = await import(script);
  const options = await withBundle(t);
  await assert.rejects(assemble({ ...options, env: { GNUPGHOME: options.root }, output: join(options.input, 'nested') }), /overlap/i);
});

test('requires an existing signing home without creating one', async t => {
  const { assemble } = await import(script);
  const options = await withBundle(t);
  const GNUPGHOME = join(options.root, 'absent-home');
  await assert.rejects(assemble({ ...options, env: { GNUPGHOME } }), /GNUPGHOME/i);
  await assert.rejects(stat(GNUPGHOME), { code: 'ENOENT' });
});

test('requires explicit valid provenance in manifest', async t => {
  const { assemble } = await import(script);
  for (const provenance of [undefined, 'local', '']) {
    await assert.rejects(assemble(await withBundle(t, [{ ...release(), provenance }])), /manifest/i);
  }
});

test('real invalid imported runtime or ref never creates a publishable site', { skip: !integration }, async t => {
  const options = await realFixture(t);
  const { assemble } = await import(script);
  for (const kind of ['runtime', 'branch', 'name']) {
    const name = kind === 'name' ? 'io.example.Wrong' : appId;
    const branch = kind === 'branch' ? 'beta' : 'stable';
    const platform = kind === 'runtime' ? '50' : '51';
    await writeFile(join(options.build, 'metadata'), `[Application]\nname=${name}\nruntime=org.gnome.Platform/x86_64/${platform}\ncommand=test-only\n`);
    command('flatpak', ['build-export', '--disable-sandbox', '--arch=x86_64', options.source, options.build, branch], options.env);
    const item = options.releases[1];
    await rm(join(options.input, item.bundle));
    command('flatpak', ['build-bundle', '--arch=x86_64', options.source, join(options.input, item.bundle), name, branch], options.env);
    item.sha256 = createHash('sha256').update(await readFile(join(options.input, item.bundle))).digest('hex');
    await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases: options.releases }));
    const output = join(options.root, `rejected-${kind}`);
    await assert.rejects(assemble({ ...options, output }), /metadata|runtime|ref/i);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});

test('real site budget failure is atomic and never overwrites an existing output', { skip: !integration }, async t => {
  const options = await realFixture(t);
  const { assemble } = await import(script);
  await assert.rejects(assemble({ ...options, maxBytes: 1 }), /budget/i);
  await assert.rejects(stat(options.output), { code: 'ENOENT' });
  await mkdir(options.output);
  await writeFile(join(options.output, 'sentinel'), 'unchanged');
  await assert.rejects(assemble(options), /exist/i);
  assert.equal(await readFile(join(options.output, 'sentinel'), 'utf8'), 'unchanged');
});

test('real CLI signed HTTP install, update, rollback and wrong-key rejection', { skip: !integration }, async t => {
  const options = await realFixture(t);
  const served = join(options.root, 'served');
  const server = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:http';
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(new URL(req.url, 'http://test').pathname);
        if (path.includes('..')) throw new Error('path');
        const bytes = await readFile(join(process.argv[1], path));
        res.writeHead(200, { 'Content-Length': bytes.length }); res.end(bytes);
      } catch { res.writeHead(404); res.end(); }
    }).listen(0, '127.0.0.1', function () { console.log(String(this.address().port)); });
  `, served], { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill());
  const [ready] = await once(server.stdout, 'data');
  assert.match(ready.toString(), /^[0-9]+\n$/, 'HTTP fixture must report a numeric listening port');
  const baseUrl = `http://127.0.0.1:${Number(ready.toString().trim())}/`;
  const env = { ...options.env, FLATPAK_GPG_KEY_ID: options.keyId, FLATPAK_PAGES_URL: baseUrl };
  const savedV2 = await readFile(join(options.input, options.releases[1].bundle));
  await rm(join(options.input, options.releases[1].bundle));
  await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases: [options.releases[0]] }));
  command(process.execPath, [script.pathname, options.input, options.output], env);
  const v1 = JSON.parse(await readFile(join(options.output, 'channel.json'), 'utf8'));
  await symlink(options.output, served);
  command('flatpak', ['remote-add', '--user', 'test-only', `${baseUrl}pd2-trader.flatpakrepo`], env);
  assert.match(command('flatpak', ['remote-ls', '--user', '--app', '--columns=application,branch', 'test-only'], env), new RegExp(`${appId}\\s+stable`));
  const install = ['--user', '--noninteractive', '--no-deps', '--no-related', '--no-static-deltas'];
  command('flatpak', ['install', ...install, 'test-only', appRef], env);
  assert.equal(command('flatpak', ['info', '--user', '--show-commit', appId], env), v1.releases[0].ostreeCommit);
  assert.equal(await readFile(join(command('flatpak', ['info', '--user', '--show-location', appId], env), 'files/version'), 'utf8'), '0.10.9');
  assert.equal(command('flatpak', ['list', '--user', '--runtime', '--columns=application'], env), '');
  await writeFile(join(options.input, options.releases[1].bundle), savedV2);
  await writeFile(join(options.input, 'manifest.json'), JSON.stringify({ schema: 1, releases: options.releases }));
  const next = join(options.root, 'site-v2');
  command(process.execPath, [script.pathname, options.input, next], env);
  const v2 = JSON.parse(await readFile(join(next, 'channel.json'), 'utf8'));
  await rm(served);
  await symlink(next, served);
  command('flatpak', ['update', ...install, appId], env);
  assert.equal(command('flatpak', ['info', '--user', '--show-commit', appId], env), v2.releases[1].ostreeCommit);
  assert.equal(await readFile(join(command('flatpak', ['info', '--user', '--show-location', appId], env), 'files/version'), 'utf8'), '0.10.10');
  command('flatpak', ['update', ...install, `--commit=${v2.releases[0].ostreeCommit}`, appId], env);
  assert.equal(command('flatpak', ['info', '--user', '--show-commit', appId], env), v1.releases[0].ostreeCommit);
  assert.equal(await readFile(join(command('flatpak', ['info', '--user', '--show-location', appId], env), 'files/version'), 'utf8'), '0.10.9');
  assert.equal(command('ostree', [`--repo=${join(next, 'repo')}`, 'rev-parse', 'archive/0.10.9'], env), v1.releases[0].ostreeCommit);
  const clientConfig = await readFile(join(env.FLATPAK_USER_DIR, 'repo/config'), 'utf8');
  assert.match(clientConfig, /gpg-verify=true/);
  assert.match(clientConfig, /gpg-verify-summary=true/);
  command('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-generate-key',
    'Wrong signing key TEST ONLY <wrong-test-only@invalid.example>', 'rsa2048', 'sign', '0'], env);
  const wrongKey = spawnSync('gpg', ['--batch', '--export', 'wrong-test-only@invalid.example'], { env });
  assert.equal(wrongKey.status, 0);
  const descriptor = join(options.root, 'wrong.flatpakrepo');
  await writeFile(descriptor, `[Flatpak Repo]\nTitle=Wrong key TEST ONLY\nUrl=${baseUrl}repo/\nGPGKey=${wrongKey.stdout.toString('base64')}\n`);
  const wrongAdd = spawnSync('flatpak', ['remote-add', '--user', 'wrong-test-only', descriptor], { env, encoding: 'utf8', timeout: 30_000 });
  const wrongList = wrongAdd.status === 0 ? spawnSync('flatpak', ['remote-ls', '--user', 'wrong-test-only'], { env, encoding: 'utf8', timeout: 30_000 }) : wrongAdd;
  assert.notEqual(wrongList.status, 0, 'Wrong signing key must fail closed');
  assert.match(wrongList.stderr, /signature|GPG|public key/i);
});

test('rejects an empty release manifest before invoking signing tools', async t => {
  const { assemble } = await import(script);
  await assert.rejects(assemble(await fixture(t)), /manifest/i);
});
