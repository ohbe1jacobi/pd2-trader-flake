import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequest, readPinnedVersion } from './check-upstream.mjs';
import { version, sha, marker, getRef, validateIssue, ensurePR, dispatchCI } from './release-lifecycle.mjs';

export function validatePayload(beforeNative, afterNative, beforeReadme, afterReadme, next) {
  version(next);
  const old = readPinnedVersion(beforeNative);
  if (readPinnedVersion(afterNative) !== next) throw new Error('Generated version mismatch');
  let expected = beforeNative.replace(`version = "${old}";`, `version = "${next}";`);
  for (const name of ['hash', 'npmDepsHash', 'cargoHash']) {
    const pattern = new RegExp(`^(\\s*${name} = ")(sha256-[A-Za-z0-9+/]{43}=)(";)$`, 'gm');
    const oldMatches = [...expected.matchAll(pattern)];
    const matches = [...afterNative.matchAll(pattern)];
    if (oldMatches.length !== 1 || matches.length !== 1 || Buffer.from(matches[0][2].slice(7), 'base64').toString('base64') !== matches[0][2].slice(7)) throw new Error(`Invalid ${name}`);
    expected = expected.replace(oldMatches[0][0], `${oldMatches[0][1]}${matches[0][2]}${oldMatches[0][3]}`);
  }
  if (expected !== afterNative) throw new Error('Forbidden native expression changes');
  const reference = `pinned upstream **${old}** release`;
  if (beforeReadme.split(reference).length !== 2 || beforeReadme.replace(reference, `pinned upstream **${next}** release`) !== afterReadme) throw new Error('Forbidden README changes');
}
async function content(request, repository, path, commit) {
  const file = await request(`/repos/${repository}/contents/${path}?ref=${sha(commit)}`);
  if (file.encoding !== 'base64' || file.type === 'symlink') throw new Error('Invalid source file');
  return Buffer.from(file.content, 'base64').toString('utf8');
}
export async function planUpdate({ request, repository, version: v, issue }) {
  version(v);
  if (!/^[1-9]\d*$/.test(String(issue))) throw new Error('Invalid issue');
  marker(v, issue);
  await validateIssue(request, repository, v, issue);
  const upstream = await request(`/repos/errolgr/pd2-trade/releases/tags/app-v${v}`);
  if (upstream.tag_name !== `app-v${v}` || upstream.draft || upstream.prerelease) throw new Error('Invalid upstream release');
  const develop = await getRef(request, repository, 'heads', 'develop');
  if (!develop) throw new Error('Bootstrap develop before enabling automation');
  const base = sha(develop.object.sha);
  const old = readPinnedVersion(await content(request, repository, 'native-package.nix', base));
  const a = v.split('.').map(BigInt), b = old.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  if (difference < 0 || a[difference] < b[difference]) throw new Error('Update already integrated or stale version; use CI rerun for promotion recovery');
  const branch = `feature/update-pd2-trader-${v}`;
  const existing = await getRef(request, repository, 'heads', branch);
  return { base, branch, generate: !existing, head: existing?.object.sha };
}
export async function finishUpdate({ request, repository, version: v, issue, base, native, readme }) {
  const plan = await planUpdate({ request, repository, version: v, issue });
  if (plan.base !== sha(base)) throw new Error('Stale develop; retry preparation');
  let commit = plan.head;
  if (!commit) {
    const beforeNative = await content(request, repository, 'native-package.nix', base);
    const beforeReadme = await content(request, repository, 'README.md', base);
    const afterNative = Buffer.from(native ?? '', 'base64').toString('utf8');
    const afterReadme = Buffer.from(readme ?? '', 'base64').toString('utf8');
    validatePayload(beforeNative, afterNative, beforeReadme, afterReadme, v);
    const parent = await request(`/repos/${repository}/git/commits/${base}`);
    const tree = await request(`/repos/${repository}/git/trees`, { method: 'POST', body: {
      base_tree: sha(parent.tree.sha), tree: [
        { path: 'native-package.nix', mode: '100644', type: 'blob', content: afterNative },
        { path: 'README.md', mode: '100644', type: 'blob', content: afterReadme },
      ],
    } });
    const created = await request(`/repos/${repository}/git/commits`, { method: 'POST', body: {
      message: `build: update PD2 Trader to ${v}`, tree: sha(tree.sha), parents: [base],
    } });
    commit = sha(created.sha);
    if (await content(request, repository, 'native-package.nix', commit) !== afterNative ||
        await content(request, repository, 'README.md', commit) !== afterReadme) throw new Error('Commit readback mismatch');
    const develop = await getRef(request, repository, 'heads', 'develop');
    if (develop?.object.sha !== base) throw new Error('Stale develop before branch write');
    await request(`/repos/${repository}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${plan.branch}`, sha: commit } });
  }
  const head = await getRef(request, repository, 'heads', plan.branch);
  if (head?.object.sha !== commit) throw new Error('Feature branch readback mismatch');
  if (readPinnedVersion(await content(request, repository, 'native-package.nix', commit)) !== v) throw new Error('Existing feature version mismatch');
  const diff = await request(`/repos/${repository}/compare/${base}...${commit}`);
  if (diff.merge_base_commit?.sha !== base || !Array.isArray(diff.files) || diff.files.length < 1 || diff.files.length > 2 ||
      diff.files.some(file => !['native-package.nix', 'README.md'].includes(file.filename) || file.status !== 'modified')) throw new Error('Forbidden update diff or stale feature base');
  const body = `${marker(v, issue)}\n\nUpdates PD2 Trader to ${v}.\n\nTracking issue: #${issue} (left open until release into main).\nUpstream: https://github.com/errolgr/pd2-trade/releases/tag/app-v${v}\n\nApplication version/source/npm/Cargo hashes and documented packaged version only; flake inputs unchanged.\n\nFull existing CI is explicitly dispatched. Manual integration approval/merge required. Failed PRs stay open for diagnosis.`;
  const pr = await ensurePR(request, repository, { head: plan.branch, base: 'develop', title: `build: update PD2 Trader to ${v}`, body });
  await dispatchCI(request, repository, plan.branch, commit);
  return { status: 'integration-prepared', commit, pr: pr.number };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.GITHUB_REPOSITORY !== 'ohbe1jacobi/pd2-trader-flake' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Run trusted updater on main only');
    if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
    const input = { request: createRequest(), repository: process.env.GITHUB_REPOSITORY, version: process.env.UPDATE_VERSION, issue: process.env.UPDATE_ISSUE };
    const result = process.argv.includes('--plan') ? await planUpdate(input) : await finishUpdate({ ...input, base: process.env.UPDATE_BASE, native: process.env.UPDATE_NATIVE, readme: process.env.UPDATE_README });
    if (process.argv.includes('--plan') && process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `base=${result.base}\ngenerate=${result.generate}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
