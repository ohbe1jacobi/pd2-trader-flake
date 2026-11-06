import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Exercise the HTTP remote protocol without installing an application/runtime
// or registering a remote in the user's real Flatpak installation.
const repository = await realpath(process.argv[2] ?? 'result-flatpak-repo');
const appId = 'io.github.ohbe1jacobi.PD2Trader';
assert.ok(process.env.TMPDIR, 'Set TMPDIR to an existing scratch directory');
const scratch = await mkdtemp(join(process.env.TMPDIR, 'pd2-flatpak-remote.'));
const env = {
  ...process.env,
  HOME: join(scratch, 'home'),
  XDG_CONFIG_HOME: join(scratch, 'config'),
  XDG_DATA_HOME: join(scratch, 'data'),
  XDG_CACHE_HOME: join(scratch, 'cache'),
  FLATPAK_USER_DIR: join(scratch, 'flatpak'),
};
const requests = [];
const server = createServer(async (request, response) => {
  try {
    assert.ok(['GET', 'HEAD'].includes(request.method));
    const path = await realpath(resolve(repository, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`));
    const rel = relative(repository, path);
    assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    const info = await stat(path);
    assert.ok(info.isFile());
    requests.push(request.url);
    response.writeHead(200, { 'Content-Length': info.size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
const flatpak = (...args) => new Promise((resolveCommand, reject) => {
  const child = spawn('flatpak', ['--user', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => {
    clearTimeout(timer);
    if (code !== 0) reject(new Error(`flatpak ${args.join(' ')} exited ${code}\n${stderr}`));
    else resolveCommand(stdout);
  });
});
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  // Unsigned is intentional and confined to this disposable loopback test.
  await flatpak('remote-add', '--no-gpg-verify', 'prototype', url);
  const apps = await flatpak('remote-ls', '--app', '--columns=application,arch,branch,runtime', 'prototype');
  assert.ok(apps.split('\n').some(line => {
    const columns = line.trim().split(/\s+/);
    return columns[0] === appId && columns[1] === 'x86_64' && columns[2] === 'stable'
      && columns[3] === 'org.gnome.Platform/x86_64/51';
  }), `Expected application/runtime not advertised:\n${apps}`);
  assert.ok(requests.some(path => /summary/.test(path)), 'Client must fetch repository metadata over HTTP');
  assert.equal((await flatpak('list', '--app', '--columns=application')).trim(), '', 'No app was installed');
  console.log(apps.trim());
  console.log('PASS: isolated Flatpak client discovered the application over loopback HTTP; nothing installed');
} finally {
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(scratch, { recursive: true, force: true });
}
