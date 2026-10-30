import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Independent cache authority: filenames or derivation paths alone are not
// sufficient. Authenticate the complete workflow/source tree and allow data
// literals only, relative to a commit already in protected main's history.
export function validateGeneratedTrees(before, after) {
  for (const tree of [before, after]) {
    assert.ok(!tree.truncated && Array.isArray(tree.tree), 'Truncated or invalid source tree');
    assert.equal(new Set(tree.tree.map(e => e.path)).size, tree.tree.length);
  }
  const blobs = tree => tree.tree.filter(e => e.type !== 'tree').map(({ path, mode, type, sha }) => ({ path, mode, type, sha })).sort((a,b) => a.path.localeCompare(b.path));
  const base = blobs(before), head = blobs(after);
  assert.equal(base.length, head.length, 'Added/deleted source paths');
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = head[i];
    if (['native-package.nix', 'README.md'].includes(a.path)) {
      assert.equal(a.path, b.path);
      assert.equal(a.mode, '100644'); assert.equal(b.mode, '100644');
      assert.equal(a.type, 'blob'); assert.equal(b.type, 'blob');
    } else assert.deepEqual(a, b, 'Forbidden source/workflow change');
  }
}
export function validateGeneratedSources(beforeNative, afterNative, beforeReadme, afterReadme, branch) {
  const match = /^(?:release\/|feature\/update-pd2-trader-)((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/.exec(branch);
  assert.ok(match, 'Not a canonical generated update branch');
  const versions = [...beforeNative.matchAll(/^\s*version = "([0-9]+\.[0-9]+\.[0-9]+)";/gm)];
  assert.equal(versions.length, 1);
  const old = versions[0][1], next = match[1];
  const a = next.split('.').map(BigInt), b = old.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  assert.ok(difference >= 0 && a[difference] > b[difference], 'Not a newer update');
  let expected = beforeNative.replace(`version = "${old}";`, `version = "${next}";`);
  for (const name of ['hash', 'npmDepsHash', 'cargoHash']) {
    const pattern = new RegExp(`^(\\s*${name} = ")(sha256-[A-Za-z0-9+/]{43}=)(";)$`, 'gm');
    const before = [...expected.matchAll(pattern)], after = [...afterNative.matchAll(pattern)];
    assert.equal(before.length, 1); assert.equal(after.length, 1);
    assert.equal(Buffer.from(after[0][2].slice(7), 'base64').toString('base64'), after[0][2].slice(7));
    expected = expected.replace(before[0][0], `${before[0][1]}${after[0][2]}${before[0][3]}`);
  }
  assert.equal(afterNative, expected, 'Forbidden native expression change');
  const reference = `pinned upstream **${old}** release`;
  assert.equal(beforeReadme.split(reference).length, 2);
  assert.equal(afterReadme, beforeReadme.replace(reference, `pinned upstream **${next}** release`));
  return next;
}

export async function verifyGeneratedRun({ repository, runId, attempt, head, request }) {
  assert.equal(repository, 'ohbe1jacobi/pd2-trader-flake');
  assert.match(String(runId), /^[1-9][0-9]*$/); assert.match(String(attempt), /^[1-9][0-9]*$/);
  assert.match(head, /^[a-f0-9]{40}$/);
  const api = path => request(`/repos/${repository}${path}`);
  const run = await api(`/actions/runs/${runId}`);
  assert.equal(String(run.id), String(runId)); assert.equal(String(run.run_attempt), String(attempt));
  assert.equal(run.repository?.full_name, repository); assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  assert.equal(run.path, '.github/workflows/ci.yml'); assert.equal(run.head_sha, head);
  assert.match(run.head_branch, /^(?:release\/|feature\/update-pd2-trader-)[0-9]+\.[0-9]+\.[0-9]+$/);
  const commit = await api(`/git/commits/${head}`);
  assert.equal(commit.parents?.length, 1, 'Generated update must be one commit');
  const base = commit.parents[0].sha; assert.match(base, /^[a-f0-9]{40}$/);
  // Do not inherit historical CI safety assumptions. The candidate must be a
  // literal update of the current controller baseline, including sandboxed GUI
  // execution. A moved/merged main fails closed; the trusted push can cache it.
  assert.equal((await api('/git/ref/heads/main')).object?.sha, base, 'Main moved since candidate generation');
  const ancestry = await api(`/compare/${base}...main`);
  assert.equal(ancestry.merge_base_commit?.sha, base, 'Baseline is not trusted main history');
  const parent = await api(`/git/commits/${base}`);
  for (const hash of [parent.tree?.sha, commit.tree?.sha]) assert.match(hash, /^[a-f0-9]{40}$/);
  validateGeneratedTrees(await api(`/git/trees/${parent.tree.sha}?recursive=1`), await api(`/git/trees/${commit.tree.sha}?recursive=1`));
  const content = async (path, sha) => {
    const file = await api(`/contents/${path}?ref=${sha}`);
    assert.equal(file.type, 'file'); assert.equal(file.encoding, 'base64');
    return Buffer.from(file.content, 'base64').toString('utf8');
  };
  const beforeNative = await content('native-package.nix', base), native = await content('native-package.nix', head);
  const beforeReadme = await content('README.md', base), readme = await content('README.md', head);
  validateGeneratedSources(beforeNative, native, beforeReadme, readme, run.head_branch);
  const artifacts = [];
  for (let page = 1; ; page++) {
    const response = await api(`/actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    assert.ok(Array.isArray(response.artifacts)); artifacts.push(...response.artifacts);
    if (response.artifacts.length < 100) break;
  }
  const matches = artifacts.filter(a => a.name === `trusted-cache-${runId}-${attempt}`);
  assert.equal(matches.length, 1, 'Missing/ambiguous cache artifact');
  const artifact = matches[0]; assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run?.id, run.id);
  assert.equal(artifact.workflow_run?.head_sha, head);
  assert.equal(artifact.workflow_run?.head_branch, run.head_branch);
  assert.equal(artifact.workflow_run?.repository_id, run.repository.id);
  assert.equal(artifact.workflow_run?.head_repository_id, run.repository.id);
  assert.match(String(artifact.id), /^[1-9][0-9]*$/);
  return { base, native, readme, artifact: String(artifact.id), context: {
    repository, event: 'workflow_dispatch', ref: `refs/heads/${run.head_branch}`, sha: head, run: String(runId), attempt: String(attempt),
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // This controller is checked out from protected main, NEVER the run's head.
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_run');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const request = async path => {
    const response = await fetch(`https://api.github.com${path}`, { headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    } });
    if (!response.ok) throw new Error(`Cache provenance lookup failed: HTTP ${response.status}`);
    return response.json();
  };
  const verified = await verifyGeneratedRun({ repository: process.env.GITHUB_REPOSITORY,
    runId: event.workflow_run?.id, attempt: event.workflow_run?.run_attempt, head: event.workflow_run?.head_sha, request });
  // Export a TRUSTED BASELINE tree, not candidate code. Only independently
  // validated literals are written into it. No PR checkout or build takes place.
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), verified.base, 'Controller checkout differs from candidate baseline');
  execFileSync('git', ['merge-base', '--is-ancestor', verified.base, 'origin/main']);
  const snapshot = mkdtempSync(join(process.env.RUNNER_TEMP, 'cache-evaluation-'));
  const archive = execFileSync('git', ['archive', verified.base], { maxBuffer: 16 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', snapshot], { input: archive });
  for (const [file, value] of [['native-package.nix', verified.native], ['README.md', verified.readme]]) {
    assert.ok(lstatSync(join(snapshot, file)).isFile()); writeFileSync(join(snapshot, file), value);
  }
  const roots = JSON.parse(execFileSync('nix', ['eval', '--json', '--no-update-lock-file', '--option', 'allow-import-from-derivation', 'false',
    `path:${snapshot}#packages.x86_64-linux`, '--apply', 'p: map (x: x.outPath) [ p.pd2-trader p.pd2-trader.native p.frontend ]'], { encoding: 'utf8' }));
  writeFileSync(join(process.env.RUNNER_TEMP, 'generated-cache-context.json'), JSON.stringify({ ...verified.context, roots: [...new Set(roots)].sort() }) + '\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `artifact=${verified.artifact}\n`);
}
