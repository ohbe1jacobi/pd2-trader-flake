import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { selectArtifact, validateFiles, ensureAssets, loadArtifact } from '../.github/scripts/flatpak-release.mjs';
const commit = 'a'.repeat(40);
const run = { id: 12, run_attempt: 2, head_sha: commit };
const expected = { schema: 1, version: '0.10.16', appId: 'io.github.ohbe1jacobi.PD2Trader', commit,
  converterRevision: '7731e8b3fca73879f8217de5a919c0a5d17303de', runtime: 'org.gnome.Platform/x86_64/51',
  runId: 12, runAttempt: 2, bundle: 'pd2-trader-0.10.16-x86_64.flatpak' };
const artifact = { id: 9, name: 'flatpak-12-2', expired: false, digest: `sha256:${'b'.repeat(64)}`,
  workflow_run: { id: 12, head_sha: commit, head_branch: 'main' } };
const digest = data => createHash('sha256').update(data).digest('hex');
async function fixture(fn) {
  const dir = await mkdtemp(join(process.env.TMPDIR, 'flatpak-release-test-'));
  try {
    const files = { [expected.bundle]: Buffer.from('fixture bundle'), 'build-info.json': Buffer.from(JSON.stringify(expected)) };
    files.SHA256SUMS = Buffer.from(Object.keys(files).sort().map(name => `${digest(files[name])}  ${name}\n`).join(''));
    for (const [name, data] of Object.entries(files)) await writeFile(join(dir, name), data);
    await fn(dir, files);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('select exactly the immutable run/attempt artifact, not PR mirrors or other attempts', () => {
  assert.equal(selectArtifact([artifact], run).id, 9);
  for (const items of [[], [artifact, artifact], [{ ...artifact, expired: true }],
    [{ ...artifact, name: 'flatpak-12-1' }], [{ ...artifact, workflow_run: { ...artifact.workflow_run, id: 13 } }],
    [{ ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: 'c'.repeat(40) } }],
    [{ ...artifact, workflow_run: { ...artifact.workflow_run, head_branch: 'feature/pr' } }]]) {
    assert.throws(() => selectArtifact(items, run), /artifact/i);
  }
});
test('validate exact metadata, checksum and file set', async () => fixture(async dir => {
  assert.equal((await validateFiles(dir, expected)).length, 3);
  for (const [key, value] of [['runId', 13], ['runAttempt', 1], ['commit', 'c'.repeat(40)], ['runtime', 'other']]) {
    await assert.rejects(validateFiles(dir, { ...expected, [key]: value }), /metadata/);
  }
  await writeFile(join(dir, 'extra'), 'bad');
  await assert.rejects(validateFiles(dir, expected), /file set/);
  await rm(join(dir, 'extra'));
  await writeFile(join(dir, expected.bundle), 'modified');
  await assert.rejects(validateFiles(dir, expected), /checksum/);
}));
test('download validates the artifact and rejects arbitrary archive paths', async () => fixture(async (_dir, files) => {
  const archive = Buffer.from('mock zip bytes');
  const selected = { ...artifact, digest: `sha256:${digest(archive)}` };
  let members = Object.keys(files).sort();
  const request = async path => path.includes('/artifacts?') ? { artifacts: [selected] } : selected;
  const runCommand = (command, args, options) => {
    if (command === 'gh') writeSync(options.stdio[1], archive);
    else if (args[0] === '-Z1') return { status: 0, stdout: `${members.join('\n')}\n` };
    else writeSync(options.stdio[1], files[args[2]]);
    return { status: 0 };
  };
  const temp = await mkdtemp(join(process.env.TMPDIR, 'flatpak-archive-test-'));
  try {
    assert.equal((await loadArtifact({ request, repository: 'owner/repo', run, expected, directory: temp, runCommand })).length, 3);
  } finally { await rm(temp, { recursive: true, force: true }); }
  const unsafe = await mkdtemp(join(process.env.TMPDIR, 'flatpak-archive-test-'));
  try {
    members = [...members, '../escape'];
    await assert.rejects(loadArtifact({ request, repository: 'owner/repo', run, expected, directory: unsafe, runCommand }), /file set/);
  } finally { await rm(unsafe, { recursive: true, force: true }); }
}));
test('upload missing assets, read them back, and reuse only matching existing assets', async () => fixture(async dir => {
  const files = await validateFiles(dir, expected), stored = [];
  const commands = [];
  const request = async (path) => {
    if (path.includes('/assets?')) return stored;
    return stored.find(item => path.endsWith(`/assets/${item.id}`));
  };
  const runCommand = (_cmd, args) => {
    commands.push(args);
    const file = files.find(item => args.includes(item.path));
    stored.push({ id: stored.length + 1, name: file.name, size: file.size, state: 'uploaded', digest: `sha256:${file.sha256}` });
    return { status: 0 };
  };
  await ensureAssets({ repository: 'owner/repo', release: { id: 10, tag_name: 'v0.10.16', draft: true }, files, request, runCommand });
  await ensureAssets({ repository: 'owner/repo', release: { id: 10, tag_name: 'v0.10.16', draft: false }, files, request, runCommand });
  assert.equal(commands.length, 3);
  stored[0].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(ensureAssets({ repository: 'owner/repo', release: { id: 10, tag_name: 'v0.10.16' }, files, request, runCommand }), /asset conflict/i);
}));
test('never backfill a published release or hide an upload failure', async () => fixture(async dir => {
  const files = await validateFiles(dir, expected), request = async () => [];
  let commands = 0;
  const runCommand = () => { commands++; return { status: 1, stderr: 'upload failed' }; };
  await assert.rejects(ensureAssets({ repository: 'owner/repo', release: { id: 10, tag_name: 'v0.10.16', draft: false }, files, request, runCommand }), /published release is missing/);
  assert.equal(commands, 0);
  await assert.rejects(ensureAssets({ repository: 'owner/repo', release: { id: 10, tag_name: 'v0.10.16', draft: true }, files, request, runCommand }), /upload failed/);
  assert.equal(commands, 1);
}));
