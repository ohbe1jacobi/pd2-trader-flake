import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const repository = 'ohbe1jacobi/pd2-trader-flake';
const root = `/repos/${repository}`;
const commit = 'a'.repeat(40), converterRevision = 'b'.repeat(40);
const digest = data => createHash('sha256').update(data).digest('hex');
const clone = value => structuredClone(value);
const source = text => ({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') });
const script = new URL('../.github/scripts/flatpak-pages-source.mjs', import.meta.url);
const release = (v, id = 1) => ({ id, tag_name: `v${v}`, draft: false, prerelease: false, published_at: '2026-11-01T00:00:00Z' });

test('stable releases use semantic descending order, excluding unpublished and unrelated tags', async () => {
  const { stableReleases } = await import(script);
  assert.deepEqual(stableReleases([release('0.10.9', 1), release('0.10.17', 2),
    { ...release('9.0.0'), draft: true }, { ...release('8.0.0'), prerelease: true },
    { ...release('7.0.0'), published_at: null }, { ...release('6.0.0'), tag_name: '../escape' }]).map(r => r.tag_name),
  ['v0.10.17', 'v0.10.9']);
  assert.throws(() => stableReleases([]), /stable release/i);
  assert.throws(() => stableReleases([release('0.10.17'), release('0.10.17', 2)]), /duplicate/i);
});

// Real, uncompressed ZIP bytes: the API digest binds the independently frozen
// CI files, and the offline unzip adapter reads the downloaded archive itself.
function zipFiles(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
function unzipFiles(archive) {
  const files = {};
  for (let offset = 0; archive.readUInt32LE(offset) === 0x04034b50;) {
    const size = archive.readUInt32LE(offset + 18), length = archive.readUInt16LE(offset + 26);
    const start = offset + 30 + length + archive.readUInt16LE(offset + 28);
    files[archive.subarray(offset + 30, offset + 30 + length).toString()] = archive.subarray(start, start + size);
    offset = start + size;
  }
  return files;
}

async function fixture(t, versions = ['0.10.17']) {
  const directory = await mkdtemp(join(process.env.TMPDIR, 'pages-source-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { directory, outputDirectory: join(directory, 'output'), calls: [], commands: [], downloads: [], entries: [] };
  for (const [index, v] of versions.entries()) {
    const id = index + 1, runId = id + 100, runAttempt = 2, tagSha = String(id).repeat(40);
    const bundle = `pd2-trader-${v}-x86_64.flatpak`;
    const info = { schema: 1, version: v, appId: 'io.github.ohbe1jacobi.PD2Trader', commit,
      converterRevision, runtime: 'org.gnome.Platform/x86_64/51', runId, runAttempt, bundle };
    const files = { [bundle]: Buffer.from(`not executable: ${v}`), 'build-info.json': Buffer.from(JSON.stringify(info)) };
    files.SHA256SUMS = Buffer.from(Object.keys(files).sort().map(name => `${digest(files[name])}  ${name}\n`).join(''));
    const assets = Object.entries(files).map(([name, data], n) => ({ id: id * 10 + n, name, size: data.length,
      state: 'uploaded', digest: `sha256:${digest(data)}` }));
    const item = { ...release(v, id), name: `PD2 Trader ${v}`, body: `CI: https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}` };
    const run = { id: runId, run_attempt: runAttempt, head_sha: commit, workflow_id: 99, path: '.github/workflows/ci.yml',
      head_repository: { full_name: repository }, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success' };
    const jobs = [{ name: 'Nix build and tests (x86_64-linux)', status: 'completed', conclusion: 'success',
      steps: ['Check Flatpak launcher contract', 'Build Flatpak bundle with verified runtime discovery', 'Upload Flatpak artifact']
        .map(name => ({ name, conclusion: 'success' })) }];
    const pr = { number: id, merged: true, merge_commit_sha: commit, body: `<!-- pd2-update:${v}:${id} -->`,
      base: { ref: 'main', repo: { full_name: repository } }, head: { ref: `release/${v}`, repo: { full_name: repository } } };
    const ciFiles = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, Buffer.from(data)]));
    const archive = zipFiles(ciFiles);
    const artifact = { id: id + 1000, name: `flatpak-${runId}-${runAttempt}`, expired: false,
      digest: `sha256:${digest(archive)}`, workflow_run: { id: runId, head_sha: commit, head_branch: 'main' } };
    state.entries.push({ item, assets, files, ciFiles, archive, artifact, info, run, jobs, pr, tagSha,
      tag: { sha: tagSha, tag: item.tag_name, message: item.name, object: { type: 'commit', sha: commit } },
      ref: { ref: `refs/tags/${item.tag_name}`, object: { type: 'tag', sha: tagSha } } });
  }
  state.request = async (path, options = {}) => {
    state.calls.push(path);
    assert.equal(options.method ?? 'GET', 'GET', 'downloader may not write to GitHub');
    assert.ok(path.startsWith(root + '/'), `fixed repository only: ${path}`);
    let result;
    if (state.intercept) result = await state.intercept(path);
    if (result !== undefined) return clone(result);
    const entries = state.entries;
    if (path.startsWith(`${root}/releases?`)) return clone(entries.map(e => e.item));
    if (path === `${root}/actions/workflows/ci.yml`) return { id: 99 };
    if (path.startsWith(`${root}/contents/native-package.nix?`)) return source(`version = "${state.pin ?? entries[0].info.version}";`);
    if (path.startsWith(`${root}/contents/flake.lock?`)) return source(JSON.stringify({ root: 'root', nodes: {
      root: { inputs: { nix2flatpak: 'converter' } }, converter: { locked: { type: 'github', owner: 'neobrain', repo: 'nix2flatpak', rev: converterRevision } } } }));
    if (path.startsWith(`${root}/commits/${commit}/pulls?`)) return entries.map(e => ({ number: e.pr.number }));
    for (const e of entries) {
      if (path.startsWith(`${root}/actions/runs/${e.run.id}/artifacts?`)) return { artifacts: e.artifact ? [clone(e.artifact)] : [] };
      if (path === `${root}/actions/artifacts/${e.artifact?.id}`) return clone(e.artifact);
      if (path === `${root}/releases/${e.item.id}` || path === `${root}/releases/tags/${e.item.tag_name}`) return clone(e.item);
      if (path.startsWith(`${root}/releases/${e.item.id}/assets?`)) return clone(e.assets);
      const asset = e.assets.find(a => path === `${root}/releases/assets/${a.id}`);
      if (asset) return clone(asset);
      if (path === `${root}/git/matching-refs/tags/${e.item.tag_name}`) return [clone(e.ref)];
      if (path === `${root}/git/tags/${e.tagSha}`) return clone(e.tag);
      if (path === `${root}/actions/runs/${e.run.id}` || path === `${root}/actions/runs/${e.run.id}/attempts/${e.run.run_attempt}`) return clone(e.run);
      if (path.startsWith(`${root}/actions/runs/${e.run.id}/attempts/${e.run.run_attempt}/jobs?`)) return { total_count: e.jobs.length, jobs: clone(e.jobs) };
      if (path === `${root}/pulls/${e.pr.number}`) return clone(e.pr);
      if (path === `${root}/issues/${e.item.id}`) return { number: e.item.id, title: `Update PD2 Trader to ${e.info.version}`, state: 'closed', state_reason: 'completed' };
    }
    assert.fail(`Unexpected API ${path}`);
  };
  state.runCommand = (command, args, options) => {
    state.commands.push([command, args]);
    if (command === 'unzip') {
      const files = unzipFiles(readFileSync(args[1]));
      if (args[0] === '-Z1') return { status: 0, stdout: Object.keys(files).join('\n') + '\n' };
      assert.equal(args[0], '-p');
      assert.ok(files[args[2]], 'only existing immutable ZIP members can be read');
      writeSync(options.stdio[1], files[args[2]]);
      return { status: 0 };
    }
    assert.equal(command, 'gh'); assert.equal(args[0], 'api');
    const artifactEntry = state.entries.find(e => args[1] === `${root}/actions/artifacts/${e.artifact?.id}/zip`);
    if (artifactEntry) {
      writeSync(options.stdio[1], artifactEntry.archive);
      return state.commandResult ?? { status: 0 };
    }
    state.downloads.push(args[1]);
    assert.ok(args.includes('Accept: application/octet-stream'));
    const entry = state.entries.find(e => e.assets.some(a => args.includes(`${root}/releases/assets/${a.id}`)));
    const asset = entry.assets.find(a => args.includes(`${root}/releases/assets/${a.id}`));
    assert.equal(typeof options.stdio[1], 'number', 'stream to exclusive-created fd, not memory or gh-selected filename');
    writeSync(options.stdio[1], state.bytes?.(asset, entry) ?? entry.files[asset.name]);
    return state.commandResult ?? { status: 0 };
  };
  return state;
}

test('download authenticates provenance offline and emits only the bundle and exact manifest', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t);
  const manifest = await downloadSources(state);
  const entry = state.entries[0];
  assert.deepEqual(manifest, { schema: 1, releases: [{ version: entry.info.version, bundle: entry.info.bundle,
    sha256: digest(entry.files[entry.info.bundle]), commit, provenance: 'github-actions' }] });
  assert.deepEqual(JSON.parse(await readFile(join(state.outputDirectory, 'manifest.json'), 'utf8')), manifest);
  assert.deepEqual((await readdir(state.outputDirectory)).sort(), ['manifest.json', entry.info.bundle].sort());
  assert.equal(state.downloads.length, 3);
  assert.ok(state.calls.includes(`${root}/actions/runs/${entry.run.id}/artifacts?per_page=100&page=1`));
  assert.ok(state.calls.includes(`${root}/actions/artifacts/${entry.artifact.id}`));
  assert.deepEqual(state.commands.filter(([command, args]) => command === 'gh' && args[1].endsWith('/zip')),
    [['gh', ['api', `${root}/actions/artifacts/${entry.artifact.id}/zip`]]]);
  assert.equal(state.commands.filter(([command, args]) => command === 'unzip' && args[0] === '-p').length, 3);
  assert.ok(state.calls.includes(`${root}/actions/runs/${entry.run.id}/attempts/2`));
  assert.ok(state.calls.includes(`${root}/contents/native-package.nix?ref=${commit}`));
});

test('retains at most two newest automated bundles, skips only historical source-only and manual 0.10.16', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t, ['0.10.18', '0.10.17', '0.10.16', '0.10.15', '0.10.14']);
  // Isolate the merged PR and version pin for each fixture release.
  let pin;
  state.intercept = async path => {
    const entry = state.entries.find(e => path === `${root}/git/matching-refs/tags/${e.item.tag_name}`);
    if (entry) pin = entry.info.version;
    if (path.startsWith(`${root}/contents/native-package.nix?`)) return source(`version = "${pin}";`);
    if (path.includes('/commits/') && path.includes('/pulls?')) return state.entries.filter(e => e.info.version === pin).map(e => ({ number: e.pr.number }));
  };
  state.entries[1].assets = [];
  state.entries[2].item.body = 'manual build, deliberately not CI';
  const result = await downloadSources(state);
  assert.deepEqual(result.releases.map(e => e.version), ['0.10.15', '0.10.18']);
  assert.equal(state.downloads.length, 6);
  assert.equal(state.calls.some(path => path.includes('/actions/runs/103')), false);
});

test('missing newest bundle fails closed rather than serving older eligible bundles', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t, ['0.10.18', '0.10.17']);
  state.entries[0].assets = [];
  await assert.rejects(downloadSources(state), /newest.*bundle/i);
  assert.deepEqual(await readdir(state.directory), []);
  assert.equal(state.downloads.length, 0);
});


test('rejects unsafe asset names, duplicate IDs/names, bad digests and size limits before any download', async t => {
  const { downloadSources } = await import(script);
  const mutations = [
    e => e.assets.push({ ...e.assets[0], id: 999, name: '../escape.flatpak' }),
    e => e.assets.push({ ...e.assets[0], id: 999 }),
    e => { e.assets[1].id = e.assets[0].id; },
    e => { e.assets[0].id = '../escape'; },
    e => { e.assets[0].digest = null; },
    e => { e.assets[0].digest = 'sha256:' + 'A'.repeat(64); },
    e => { e.assets[0].state = 'new'; },
    e => { e.assets[0].size = 0; },
    e => { e.assets[0].size = 1536 * 1024 * 1024 + 1; },
    e => { e.assets[1].size = 16 * 1024 + 1; },
    e => { e.assets[2].size = 4097; },
    e => { e.assets.pop(); },
  ];
  for (const mutate of mutations) {
    const state = await fixture(t); mutate(state.entries[0]);
    await assert.rejects(downloadSources(state), /asset/i);
    assert.equal(state.downloads.length, 0, 'reject the whole asset set before downloading anything');
    assert.deepEqual(await readdir(state.directory), []);
  }
});

test('reads back exact individual assets, release identity and tag target after download', async t => {
  const { downloadSources } = await import(script);
  for (const target of ['asset', 'release', 'release-tag', 'tag-ref', 'tag-object', 'asset-list']) {
    const state = await fixture(t), e = state.entries[0];
    state.intercept = async path => {
      if (state.downloads.length !== 3) return;
      if (target === 'asset' && path === `${root}/releases/assets/${e.assets[0].id}`) return { ...e.assets[0], digest: 'sha256:' + '0'.repeat(64) };
      if (target === 'release' && path === `${root}/releases/${e.item.id}`) return { ...e.item, id: 999 };
      if (target === 'release-tag' && path === `${root}/releases/tags/${e.item.tag_name}`) return { ...e.item, body: 'changed provenance' };
      if (target === 'tag-ref' && path.includes('/git/matching-refs/')) return [{ ...e.ref, object: { type: 'tag', sha: 'e'.repeat(40) } }];
      if (target === 'tag-object' && path.includes('/git/tags/')) return { ...e.tag, object: { type: 'commit', sha: 'f'.repeat(40) } };
      if (target === 'asset-list' && path.includes('/assets?')) return e.assets.slice(1);
    };
    await assert.rejects(downloadSources(state), /changed|mismatch/i, target);
    assert.equal(state.downloads.length, 3);
    assert.deepEqual(await readdir(state.directory), []);
  }
});


const manualAssets = [
  { id: 717530215, name: 'build-info.json', size: 2049, digest: 'sha256:6a8e249407370376a882899e72d00cf4a6419ed9b81e567faa7aeb3dad5ce7e9', state: 'uploaded' },
  { id: 717530211, name: 'pd2-trader-0.10.16-experimental-x86_64.flatpak', size: 44018792, digest: 'sha256:a43364909232601bf457a6e832f5c6415fb08ea8755c3110d9f474b8d83b9c83', state: 'uploaded' },
  { id: 717530210, name: 'SHA256SUMS', size: 195, digest: 'sha256:2e2d9835008721e076d8b993025caaa3b5a7b2ed107913c0dcd22773aae69a68', state: 'uploaded' },
];
test('manual bootstrap is disabled by default, and enabling accepts only the exact reviewed frozen identities', async t => {
  const { downloadSources, reviewedManualRelease } = await import(script);
  const manual = { ...release('0.10.16', 434361585), body: 'local build; not CI' };
  const selected = reviewedManualRelease(manual, clone(manualAssets));
  assert.equal(selected.bundle, manualAssets[1].name);
  assert.equal(selected.commit, '44bcc2d0212c1edcaf0eea3e4da7e3bfb7a4ac63');
  assert.equal(selected.version, '0.10.16');
  for (const change of [{ id: 1 }, { tag_name: 'v0.10.17' }, { draft: true }, { prerelease: true }]) {
    assert.throws(() => reviewedManualRelease({ ...manual, ...change }, clone(manualAssets)), /bootstrap/i);
  }
  for (const change of [{ id: 1 }, { name: '../escape.flatpak' }, { digest: 'sha256:' + '0'.repeat(64) }, { size: 1 }]) {
    const assets = clone(manualAssets); Object.assign(assets[1], change);
    assert.throws(() => reviewedManualRelease(manual, assets), /asset|bootstrap/i);
  }
  assert.throws(() => reviewedManualRelease(manual, [...manualAssets, manualAssets[0]]), /asset|bootstrap/i);
  for (const allowManualBootstrap of [undefined, false, 'true']) {
    const state = await fixture(t, ['0.10.16']);
    state.entries[0].item = manual;
    await assert.rejects(downloadSources({ ...state, allowManualBootstrap }), /eligible/i);
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(await readdir(state.directory), []);
  }
  const state = await fixture(t, ['0.10.16']);
  state.entries[0].item = manual;
  state.entries[0].assets = clone(manualAssets);
  state.intercept = async path => {
    if (path.endsWith('/git/matching-refs/tags/v0.10.16')) return [state.entries[0].ref];
  };
  // Offline intentionally wrong bytes: opting in never bypasses pinned hashes.
  state.bytes = () => Buffer.from('tampered bootstrap bytes');
  await assert.rejects(downloadSources({ ...state, allowManualBootstrap: true }), /digest|size/i);
  assert.equal(state.downloads.length, 1);
  assert.equal(state.calls.some(path => path.includes('/actions/')), false, 'manual bootstrap must not pretend to have CI provenance');
  assert.deepEqual(await readdir(state.directory), []);
});


test('rejects tag, run, PR, tracking issue and pinned version mismatches without falling back', async t => {
  const { downloadSources } = await import(script);
  const mutations = [
    e => { e.ref.object.type = 'commit'; },
    e => { e.tag.sha = 'f'.repeat(40); },
    e => { e.tag.tag = 'v0.10.18'; },
    e => { e.tag.message = 'unrelated annotation'; },
    e => { e.tag.object.sha = 'f'.repeat(40); },
    e => { e.run.id++; },
    e => { e.run.run_attempt++; },
    e => { e.run.status = 'in_progress'; },
    e => { e.run.conclusion = 'failure'; },
    e => { e.run.path = '.github/workflows/evil.yml'; },
    e => { e.run.event = 'pull_request'; },
    e => { e.run.head_branch = 'feature/untrusted'; },
    e => { e.run.head_repository.full_name = 'attacker/fork'; },
    e => { e.run.head_sha = 'f'.repeat(40); },
    e => { e.run.workflow_id = 100; },
    e => { e.jobs[0].conclusion = 'failure'; },
    e => { e.jobs[0].steps[1].conclusion = 'skipped'; },
    e => { e.pr.merged = false; },
    e => { e.pr.head.ref = 'feature/release'; },
    e => { e.pr.body += '\n<!-- pd2-update:0.10.17:2 -->'; },
    e => { e.item.body += '\n' + e.item.body; },
    e => { e.item.body = e.item.body.replace(repository, 'attacker/fork'); },
  ];
  for (const mutate of mutations) {
    const state = await fixture(t); mutate(state.entries[0]);
    await assert.rejects(downloadSources(state));
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(await readdir(state.directory), []);
  }
  for (const target of ['issue', 'pin', 'workflow', 'pr-id', 'release-id']) {
    const state = await fixture(t);
    if (target === 'pin') state.pin = '0.10.18';
    if (target === 'release-id') state.entries[0].item.id = '../escape';
    state.intercept = async path => {
      assert.ok(!path.includes('../'), 'validate API IDs before constructing endpoints');
      if (target === 'issue' && path.includes('/issues/')) return { title: 'Update PD2 Trader to 0.10.17', state: 'closed', state_reason: 'not_planned' };
      if (target === 'workflow' && path.endsWith('/workflows/ci.yml')) return {};
      if (target === 'pr-id' && path.includes('/commits/') && path.includes('/pulls?')) return [{ number: '../escape' }];
    };
    await assert.rejects(downloadSources(state));
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(await readdir(state.directory), []);
  }
});

test('CI attempt changing during download fails closed', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t), e = state.entries[0];
  state.intercept = async path => {
    if (state.downloads.length === 3 && path === `${root}/actions/runs/${e.run.id}`) return { ...e.run, run_attempt: 3 };
  };
  await assert.rejects(downloadSources(state), /CI run/i);
  assert.deepEqual(await readdir(state.directory), []);
});

test('never replaces existing output, including empty directories, files and symlinks', async t => {
  const { downloadSources } = await import(script);
  for (const kind of ['empty', 'file', 'symlink']) {
    const state = await fixture(t);
    if (kind === 'empty') await mkdir(state.outputDirectory);
    if (kind === 'file') await writeFile(state.outputDirectory, 'keep');
    if (kind === 'symlink') await symlink(join(state.directory, 'missing'), state.outputDirectory);
    await assert.rejects(downloadSources(state), /exists/i);
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(await readdir(state.directory), ['output']);
    if (kind === 'file') assert.equal(await readFile(state.outputDirectory, 'utf8'), 'keep');
  }
});


test('paginates release, related PR and CI job discovery without trusting first-page absence', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t), e = state.entries[0];
  state.intercept = async path => {
    if (path.startsWith(`${root}/releases?`)) return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ ...release('9.0.0', 900 + i), draft: true })) : [e.item];
    if (path.includes('/commits/') && path.includes('/pulls?')) return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ number: 900 + i })) : [{ number: e.pr.number }];
    if (/\/pulls\/9[0-9]{2}$/.test(path)) return { number: Number(path.split('/').at(-1)), merged: false };
    if (path.includes('/jobs?')) return { total_count: 101, jobs: path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ name: `cache ${i}`, conclusion: 'success' })) : e.jobs };
  };
  assert.equal((await downloadSources(state)).releases.length, 1);
  for (const name of ['/releases?', '/pulls?', '/jobs?']) assert.ok(state.calls.some(p => p.includes(name) && p.endsWith('page=2')), name);
});

test('does not publish stale output if newest stable release appears or disappears during download', async t => {
  const { downloadSources } = await import(script);
  for (const mode of ['newer', 'missing']) {
    const state = await fixture(t);
    state.intercept = async path => {
      if (state.downloads.length === 3 && path.startsWith(`${root}/releases?`)) return mode === 'newer' ? [release('0.10.18', 999), state.entries[0].item] : [];
    };
    await assert.rejects(downloadSources(state), /stable release|changed|newest/i);
    assert.deepEqual(await readdir(state.directory), []);
  }
});

test('network, missing-resource and gh failures never count as an absent historical release', async t => {
  const { downloadSources } = await import(script);
  for (const target of ['releases', 'assets', 'run', 'tag', 'source', 'readback', 'gh-status', 'gh-error']) {
    const state = await fixture(t);
    state.intercept = async path => {
      if ((target === 'releases' && path.startsWith(`${root}/releases?`)) ||
          (target === 'assets' && path.includes('/assets?')) ||
          (target === 'run' && path.includes('/actions/runs/')) ||
          (target === 'tag' && path.includes('/git/tags/')) ||
          (target === 'source' && path.includes('/contents/')) ||
          (target === 'readback' && state.downloads.length === 3 && path.includes('/releases/tags/'))) {
        throw Object.assign(new Error(`API unavailable: ${target}`), { status: target === 'readback' ? 404 : 503 });
      }
    };
    if (target === 'gh-status') state.commandResult = { status: 1, stderr: 'network unavailable' };
    if (target === 'gh-error') state.commandResult = { status: null, error: new Error('spawn failed') };
    await assert.rejects(downloadSources(state), /API unavailable|network unavailable|spawn failed/);
    assert.deepEqual(await readdir(state.directory), []);
  }
});

function refreshFixture(e) {
  e.files.SHA256SUMS = Buffer.from(Object.keys(e.files).filter(n => n !== 'SHA256SUMS').sort().map(n => `${digest(e.files[n])}  ${n}\n`).join(''));
  for (const asset of e.assets) { asset.size = e.files[asset.name].length; asset.digest = `sha256:${digest(e.files[asset.name])}`; }
}
test('rejects a swapped bundle with refreshed release digests and checksums but unchanged immutable CI evidence', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t), e = state.entries[0];
  const originalArchiveDigest = e.artifact.digest;
  e.files[e.info.bundle] = Buffer.from('replacement bundle with self-consistent release checksums');
  refreshFixture(e);
  assert.notEqual(digest(e.files[e.info.bundle]), digest(e.ciFiles[e.info.bundle]));
  assert.equal(e.artifact.digest, originalArchiveDigest);
  await assert.rejects(downloadSources(state), /immutable CI artifact.*mismatch/i);
  assert.deepEqual(await readdir(state.directory), []);
});

test('requires the exact non-expired immutable artifact for the cited run and attempt', async t => {
  const { downloadSources } = await import(script);
  for (const mode of ['missing', 'expired', 'wrong-attempt', 'wrong-run', 'wrong-sha', 'wrong-branch', 'missing-digest', 'ambiguous']) {
    const state = await fixture(t), e = state.entries[0];
    if (mode === 'missing') e.artifact = undefined;
    if (mode === 'expired') e.artifact.expired = true;
    if (mode === 'wrong-attempt') e.artifact.name = `flatpak-${e.run.id}-1`;
    if (mode === 'wrong-run') e.artifact.workflow_run.id++;
    if (mode === 'wrong-sha') e.artifact.workflow_run.head_sha = 'f'.repeat(40);
    if (mode === 'wrong-branch') e.artifact.workflow_run.head_branch = 'untrusted';
    if (mode === 'missing-digest') delete e.artifact.digest;
    if (mode === 'ambiguous') state.intercept = async path => {
      if (path.includes('/artifacts?')) return { artifacts: [e.artifact, e.artifact] };
    };
    await assert.rejects(downloadSources(state), /artifact/i, mode);
    assert.deepEqual(await readdir(state.directory), []);
    assert.equal(state.commands.some(([command, args]) => command === 'gh' && args[1].endsWith('/zip')), false, mode);
  }
});

test('artifact proof rejects archive digest, metadata, file-set and identity readback mismatches', async t => {
  const { downloadSources } = await import(script);
  for (const mode of ['digest', 'metadata', 'extra-file', 'missing-file', 'readback-digest', 'readback-expired', 'unavailable']) {
    const state = await fixture(t), e = state.entries[0];
    if (mode === 'digest') e.artifact.digest = 'sha256:' + '0'.repeat(64);
    if (mode === 'metadata') {
      e.ciFiles['build-info.json'] = Buffer.from(JSON.stringify({ ...e.info, runAttempt: 1 }));
      e.ciFiles.SHA256SUMS = Buffer.from(Object.keys(e.ciFiles).filter(n => n !== 'SHA256SUMS').sort()
        .map(n => `${digest(e.ciFiles[n])}  ${n}\n`).join(''));
    }
    if (mode === 'extra-file') e.ciFiles['../unexpected'] = Buffer.from('unsafe member');
    if (mode === 'missing-file') delete e.ciFiles[e.info.bundle];
    if (['metadata', 'extra-file', 'missing-file'].includes(mode)) {
      e.archive = zipFiles(e.ciFiles); e.artifact.digest = `sha256:${digest(e.archive)}`;
    }
    state.intercept = async path => {
      if (path !== `${root}/actions/artifacts/${e.artifact.id}`) return;
      if (mode === 'readback-digest') return { ...e.artifact, digest: 'sha256:' + '0'.repeat(64) };
      if (mode === 'readback-expired') return { ...e.artifact, expired: true };
      if (mode === 'unavailable') throw new Error('artifact unavailable');
    };
    await assert.rejects(downloadSources(state), /artifact|metadata/i, mode);
    assert.deepEqual(await readdir(state.directory), []);
  }
});

test('semantic metadata equality is insufficient: all release file bytes must match the CI artifact', async t => {
  const { downloadSources } = await import(script);
  const state = await fixture(t), e = state.entries[0];
  e.files['build-info.json'] = Buffer.from(JSON.stringify(e.info, null, 2) + '\n');
  refreshFixture(e);
  assert.deepEqual(JSON.parse(e.files['build-info.json']), JSON.parse(e.ciFiles['build-info.json']));
  assert.equal(digest(e.files[e.info.bundle]), digest(e.ciFiles[e.info.bundle]));
  await assert.rejects(downloadSources(state), /immutable CI artifact.*mismatch/i);
  assert.deepEqual(await readdir(state.directory), []);
});

test('rejects tampered bytes, forged metadata fields and wrong checksum text despite internally matching API digests', async t => {
  const { downloadSources } = await import(script);
  for (const field of ['schema', 'commit', 'version', 'converterRevision', 'runId', 'runAttempt', 'bundle', 'runtime', 'appId', 'extra']) {
    const state = await fixture(t), e = state.entries[0];
    e.files['build-info.json'] = Buffer.from(JSON.stringify({ ...e.info, [field]: field === 'runId' ? 999 : 'forged' }));
    refreshFixture(e);
    await assert.rejects(downloadSources(state), /metadata/i, field);
    assert.deepEqual(await readdir(state.directory), []);
  }
  for (const target of ['bundle', 'sums']) {
    const state = await fixture(t), e = state.entries[0];
    if (target === 'bundle') state.bytes = (asset, entry) => asset.name === entry.info.bundle ? Buffer.from('tampered') : entry.files[asset.name];
    else {
      e.files.SHA256SUMS = Buffer.from('bad checksum list');
      const asset = e.assets.find(a => a.name === 'SHA256SUMS'); asset.size = e.files.SHA256SUMS.length; asset.digest = `sha256:${digest(e.files.SHA256SUMS)}`;
    }
    await assert.rejects(downloadSources(state), /digest|size|checksum/i);
    assert.deepEqual(await readdir(state.directory), []);
  }
});


test('bootstrap manifest uses canonical output filename and discloses reviewed local provenance', async () => {
  const { reviewedManualRelease, manifestRelease } = await import(script);
  const expected = reviewedManualRelease(release('0.10.16', 434361585), manualAssets);
  const hash = manualAssets[1].digest.slice(7);
  assert.deepEqual(manifestRelease(expected, hash, true), { version: '0.10.16',
    bundle: 'pd2-trader-0.10.16-x86_64.flatpak', sha256: hash,
    commit: '44bcc2d0212c1edcaf0eea3e4da7e3bfb7a4ac63', provenance: 'reviewed-local-bootstrap' });
  assert.equal(expected.bundle, 'pd2-trader-0.10.16-experimental-x86_64.flatpak', 'original checksum identity must not be rewritten');
});


test('incomplete or contradictory CI job pagination cannot authorize release bytes', async t => {
  const { downloadSources } = await import(script);
  for (const mode of ['empty', 'overcount', 'changed-total']) {
    const state = await fixture(t), e = state.entries[0];
    state.intercept = async path => {
      if (!path.includes('/jobs?')) return;
      if (mode === 'empty') return { total_count: 1, jobs: [] };
      if (mode === 'overcount') return { total_count: 0, jobs: e.jobs };
      return path.endsWith('page=1') ? { total_count: 2, jobs: [{ name: 'cache' }] } : { total_count: 1, jobs: e.jobs };
    };
    await assert.rejects(downloadSources(state), /CI jobs|pagination/i);
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(await readdir(state.directory), []);
  }
});
