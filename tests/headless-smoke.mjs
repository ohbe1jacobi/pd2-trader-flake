// Isolated X11 startup test; never connects to the user's KDE display.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const pkg = resolve(process.argv[2] ?? './result');
const state = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'pd2-trader-smoke-'));
for (const name of ['home', 'config', 'cache', 'data', 'runtime']) mkdirSync(join(state, name), { mode: 0o700 });
const processes = [];
const start = (command, args, options = {}) => {
  const child = spawn(command, args, { detached: true, ...options });
  child.on('error', error => { console.error(`${command}: ${error.message}`); });
  processes.push(child);
  return child;
};
try {
  const displayFd = openSync(join(state, 'display'), 'w');
  const xvfbLog = openSync(join(state, 'xvfb.log'), 'w');
  const xvfb = start('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], {
    stdio: ['ignore', xvfbLog, xvfbLog, displayFd],
  });
  closeSync(displayFd);
  closeSync(xvfbLog);
  let display;
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = readFileSync(join(state, 'display'), 'utf8').trim();
    if (number) { display = `:${number}`; break; }
    if (xvfb.exitCode !== null) throw new Error('Xvfb exited before becoming ready');
    await delay(100);
  }
  if (!display) throw new Error('Xvfb readiness timed out');
  const env = {
    ...process.env,
    DISPLAY: display,
    HOME: join(state, 'home'),
    XDG_CONFIG_HOME: join(state, 'config'),
    XDG_CACHE_HOME: join(state, 'cache'),
    XDG_DATA_HOME: join(state, 'data'),
    XDG_RUNTIME_DIR: join(state, 'runtime'),
    LIBGL_ALWAYS_SOFTWARE: '1',
  };
  for (const key of ['WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'APPIMAGE_DEBUG_EXEC', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) delete env[key];
  const appLog = openSync(join(state, 'app.log'), 'w');
  const app = start('dbus-run-session', ['--', join(pkg, 'bin/pd2-trader')], {
    env, stdio: ['ignore', appLog, appLog],
  });
  closeSync(appLog);
  let tree = '';
  let detected = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (app.exitCode !== null) throw new Error(`Application exited with ${app.exitCode}`);
    const result = spawnSync('xwininfo', ['-root', '-tree'], { env, encoding: 'utf8' });
    if (result.error) throw result.error;
    tree = result.stdout ?? '';
    if (/"PD2Trader"/.test(tree)) { detected = true; break; }
    await delay(250);
  }
  if (!detected) throw new Error('No PD2 Trader window appeared within 20 seconds');
  // The tray is requested by React, not Rust startup. Seeing its dynamically
  // loaded library proves frontend execution reached the native tray boundary.
  let trayLoaded = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const pending = [app.pid];
    while (pending.length) {
      const pid = pending.pop();
      try {
        const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
        if (children) pending.push(...children.split(/\s+/).map(Number));
        const maps = readFileSync(`/proc/${pid}/maps`, 'utf8');
        if (maps.includes('libayatana-appindicator3.so')) trayLoaded = true;
      } catch {} // a child may exit between enumeration and reading
    }
    if (trayLoaded || app.exitCode !== null) break;
    await delay(250);
  }
  if (!trayLoaded) throw new Error('Frontend did not reach native tray loading (no Ayatana library mapped)');
  await delay(3000);
  if (app.exitCode !== null) throw new Error(`Application exited after creating a window: ${app.exitCode}`);
  const log = readFileSync(join(state, 'app.log'), 'utf8');
  if (/EGL_BAD_PARAMETER|undefined symbol|error while loading shared libraries/.test(log)) {
    throw new Error('Application logged a graphics or dynamic-library startup failure');
  }
  console.log('PASS: real packaged app created a PD2 Trader X11 window and remained running');
  console.log('PASS: frontend execution reached native tray library loading');
  console.log('PASS: no EGL_BAD_PARAMETER or missing-symbol startup error');
  console.log(tree);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (existsSync(join(state, 'app.log'))) console.error(readFileSync(join(state, 'app.log'), 'utf8'));
  process.exitCode = 1;
} finally {
  for (const child of processes.reverse()) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await delay(300);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  console.log(`Isolated test logs: ${state}`);
}
