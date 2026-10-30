import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// This is only build deduplication, never authority to publish cache contents.
export function automationHead(event, repository) {
  const pr = event.pull_request;
  const bot = user => user?.login === 'github-actions[bot]' && user.type === 'Bot';
  if (!['opened', 'synchronize'].includes(event.action) || !bot(event.sender) || !bot(pr?.user) ||
      pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) return null;
  const markers = [...(pr.body ?? '').matchAll(/<!-- pd2-update:([0-9]+\.[0-9]+\.[0-9]+):([1-9][0-9]*) -->/g)];
  if (markers.length !== 1) return null;
  const version = markers[0][1];
  const prefix = pr.base.ref === 'develop' ? 'feature/update-pd2-trader-' : pr.base.ref === 'main' ? 'release/' : null;
  return prefix && pr.head.ref === `${prefix}${version}` && /^[a-f0-9]{40}$/.test(pr.head.sha) ? pr.head.sha : null;
}

export function selectDispatch(runs, head, branch) {
  return runs.filter(run => run.head_sha === head && run.head_branch === branch &&
    run.event === 'workflow_dispatch' && run.path === '.github/workflows/ci.yml').sort((a, b) => b.id - a.id)[0];
}

export function dispatchResult(run) {
  if (run.status !== 'completed') return false;
  if (run.conclusion !== 'success') throw new Error(`Authoritative dispatched CI: ${run.conclusion}`);
  return true;
}

// 270 minutes covers the 190-minute build plus a bounded queue allowance.
// PR jobs allow 300 minutes, leaving room for checkout and API overhead.
export async function mirrorDispatch({ repository, head, branch, token, request = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 540 }) {
  if (!token) throw new Error('A read-only GitHub token is required');
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !branch) throw new Error('Malformed dispatch lookup');
  // Reads only; no check-writing permission and no artifact download/execution.
  for (let attempt = 0; attempt < attempts; attempt++) {
    const runs = [];
    for (let page = 1; ; page++) {
      const response = await request(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?event=workflow_dispatch&head_sha=${head}&per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!response.ok) throw new Error(`Cannot read dispatched CI: HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.workflow_runs)) throw new Error('Invalid workflow run response');
      runs.push(...body.workflow_runs);
      if (body.workflow_runs.length < 100) break;
    }
    const run = selectDispatch(runs, head, branch);
    if (run && dispatchResult(run)) return run;
    await wait(30000);
  }
  throw new Error('Timed out waiting for exact-head authoritative dispatch; rerun after dispatch recovery');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const head = process.env.GITHUB_EVENT_NAME === 'pull_request' ? automationHead(event, process.env.GITHUB_REPOSITORY) : null;
  if (process.argv.includes('--mirror')) {
    if (!head) throw new Error('Not an eligible automation event');
    await mirrorDispatch({ repository: process.env.GITHUB_REPOSITORY, head, branch: event.pull_request.head.ref, token: process.env.GH_TOKEN });
  } else {
    appendFileSync(process.env.GITHUB_OUTPUT, `mirror=${Boolean(head)}\nhead=${head ?? ''}\n`);
  }
}
