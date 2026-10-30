import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequest, readPinnedVersion } from './check-upstream.mjs';
import { validateGeneratedUpdate } from './prepare-update.mjs';
import { version, sha, marker, getRef, validateIssue, ensurePR, dispatchCI, validateUpdateCommit } from './release-lifecycle.mjs';

export function validatePayload(beforeNative, afterNative, beforeReadme, afterReadme, next) {
  return validateGeneratedUpdate({ beforeNative, afterNative, beforeReadme, afterReadme, version: next });
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
  const main = await getRef(request, repository, 'heads', 'main');
  if (!main) throw new Error('Bootstrap main before enabling automation');
  const base = sha(main.object.sha);
  const old = readPinnedVersion(await content(request, repository, 'native-package.nix', base));
  const a = v.split('.').map(BigInt), b = old.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  if (difference < 0 || a[difference] < b[difference]) throw new Error('Update already merged or stale version; rerun merged main CI for publication recovery');
  const branch = `release/${v}`;
  const existing = await getRef(request, repository, 'heads', branch);
  return { base, branch, generate: !existing, head: existing?.object.sha };
}
export async function finishUpdate({ request, repository, version: v, issue, base, native, readme }) {
  const plan = await planUpdate({ request, repository, version: v, issue });
  if (plan.base !== sha(base)) throw new Error('Stale main; retry preparation');
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
    const main = await getRef(request, repository, 'heads', 'main');
    if (main?.object.sha !== base) throw new Error('Stale main before branch write');
    await request(`/repos/${repository}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${plan.branch}`, sha: commit } });
  }
  const head = await getRef(request, repository, 'heads', plan.branch);
  if (head?.object.sha !== commit) throw new Error('Frozen release branch readback mismatch');
  if (readPinnedVersion(await content(request, repository, 'native-package.nix', commit)) !== v) throw new Error('Frozen release branch version mismatch');
  await validateUpdateCommit({ request, repository, base, commit, version: v });
  const body = `${marker(v, issue)}\n<!-- pd2-main-base:${base} -->\n\nUpdates PD2 Trader to ${v} from trusted main commit ${base}.\n\nCloses #${issue}\nUpstream: https://github.com/errolgr/pd2-trade/releases/tag/app-v${v}\n\nApplication version/source/npm/Cargo hashes and documented packaged version only; flake inputs unchanged.\n\nFull existing CI is explicitly dispatched. Manual approval/merge into main required. Failed PRs stay open for diagnosis.`;
  const pr = await ensurePR(request, repository, { head: plan.branch, base: 'main', title: `build: update PD2 Trader to ${v}`, body });
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
