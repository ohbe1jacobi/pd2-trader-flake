import assert from 'node:assert/strict';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { join, posix } from 'node:path';

// Resolve the launcher as the sandbox will see it, not using host /app or /nix.
const bundle = await realpath(process.argv[2] ?? 'result-flatpak');
const files = join(bundle, 'flatpak-dir/files');
let target = '/app/bin/pd2-trader';
let executable;
for (let hops = 0; hops < 40; hops++) {
  assert.ok(target.startsWith('/app/'), `Launcher escapes /app: ${target}`);
  const parts = target.slice('/app/'.length).split('/');
  let redirected = false;
  for (let index = 0; index < parts.length; index++) {
    const virtual = `/app/${parts.slice(0, index + 1).join('/')}`;
    const local = join(files, ...parts.slice(0, index + 1));
    const info = await lstat(local);
    if (info.isSymbolicLink()) {
      target = posix.resolve(posix.dirname(virtual), await readlink(local), ...parts.slice(index + 1));
      redirected = true;
      break;
    }
    if (index === parts.length - 1) {
      assert.ok(info.isFile() && (info.mode & 0o111), `Launcher is not executable: ${virtual}`);
      executable = virtual;
    }
  }
  if (!redirected) break;
}
assert.ok(executable, 'Launcher symlink chain exceeds 40 hops');
const launcher = await readFile(join(files, executable.slice('/app/'.length)), 'utf8');
assert.match(launcher, /PD2_TRADER_D2_DIR/,
  'Flatpak entrypoint must honor the persistent game-directory override');
assert.match(launcher, /--diablo2-directory "\$PD2_TRADER_D2_DIR"/);
assert.doesNotMatch(launcher, /(?<!\/app)\/nix\/store\//,
  'Launcher dependencies must use converted /app paths');
for (const [dependency] of launcher.matchAll(/\/app\/nix\/store\/[^\s"'\\]+/g)) {
  await lstat(join(files, dependency.slice('/app/'.length)));
}
assert.doesNotMatch(launcher, /GST_PLUGIN_SYSTEM_PATH_1_0/,
  'Flatpak launcher must use runtime plugin discovery, not the Nix media wrapper');
const metadata = await readFile(join(bundle, 'flatpak-dir/metadata'), 'utf8');
assert.match(metadata, /^name=io\.github\.ohbe1jacobi\.PD2Trader$/m);
assert.match(metadata, /^command=pd2-trader$/m);
assert.match(metadata, /^runtime=org\.gnome\.Platform\/x86_64\/51$/m);
assert.match(metadata, /^filesystems=$/m);
const busPolicy = metadata.match(/^\[Session Bus Policy\]\r?\n([^[]*)/m)?.[1];
assert.ok(busPolicy, 'Session bus policy is missing');
assert.deepEqual(busPolicy.trim().split(/\r?\n/).sort(), [
  'org.com_pd2_trader_app.SingleInstance=own',
  'org.kde.StatusNotifierWatcher=talk',
], 'Only the tray watcher and exact single-instance bus name should be permitted');
await lstat(join(bundle, 'flatpak-dir/export/share/applications/io.github.ohbe1jacobi.PD2Trader.desktop'));
console.log(`PASS: /app/bin/pd2-trader resolves to executable ${executable}`);
console.log('PASS: application/runtime/desktop metadata and default filesystem confinement');
console.log('Structural checks only: the application was not launched');
