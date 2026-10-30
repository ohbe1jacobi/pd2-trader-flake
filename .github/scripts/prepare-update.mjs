import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export function validateVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('UPDATE_VERSION must be a canonical stable version (for example 0.10.10)');
  }
  return version;
}

const fields = ['version', 'hash', 'npmDepsHash', 'cargoHash'];

function readFields(source) {
  const values = {};
  let skeleton = source;
  for (const field of fields) {
    const pattern = new RegExp(`\\b${field} = "([^"\\n]*)";`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`Expected exactly one literal ${field}`);
    values[field] = matches[0][1];
    if (field === 'version') validateVersion(values[field]);
    else {
      const value = values[field];
      const bytes = Buffer.from(value.slice(7), 'base64');
      if (!value.startsWith('sha256-') || bytes.length !== 32 ||
          bytes.toString('base64') !== value.slice(7) || bytes.every(byte => byte === 0)) {
        throw new Error(`Invalid or placeholder ${field}`);
      }
    }
    skeleton = skeleton.replace(pattern, `${field} = "<${field}>";`);
  }
  return { values, skeleton };
}

export function updateReadme(source, oldVersion, version) {
  validateVersion(oldVersion);
  validateVersion(version);
  const reference = `Builds the pinned upstream **${oldVersion}** release`;
  if (source.split(reference).length !== 2) throw new Error('Expected exactly one packaged-version README reference');
  return source.replace(reference, `Builds the pinned upstream **${version}** release`);
}

export function validateGeneratedDiff(before, after, changedFiles, version) {
  validateVersion(version);
  if (changedFiles.some(file => !['README.md', 'native-package.nix'].includes(file))) {
    throw new Error('Generated diff contains files outside the allowed README/native package set');
  }
  if (before.flake !== after.flake || before.lock !== after.lock) throw new Error('Flake or lockfile changed');
  const original = readFields(before.native);
  const generated = readFields(after.native);
  if (original.skeleton !== generated.skeleton) throw new Error('Native changes exceed the four allowed values');
  if (generated.values.version !== version) throw new Error('Generated version differs from UPDATE_VERSION');
  if (after.readme !== updateReadme(before.readme, original.values.version, version)) {
    throw new Error('README changes exceed the packaged-version reference');
  }
  return generated.values;
}

// Shared with the trusted, privileged writer: validate the decoded payload
// against that writer's own checkout, never against generator-supplied baselines.
export function validateGeneratedUpdate({ beforeNative, afterNative, beforeReadme, afterReadme, version }) {
  return validateGeneratedDiff(
    { native: beforeNative, readme: beforeReadme },
    { native: afterNative, readme: afterReadme }, [], version,
  );
}

export function validateRealizedHashes(declared, evaluated, realized) {
  if (evaluated.nativeCheck !== true || evaluated.frontendCheck !== true) {
    throw new Error('Native and frontend doCheck must both remain true');
  }
  if (evaluated.version !== declared.version) throw new Error('Evaluated version differs from declaration');
  for (const key of fields.slice(1)) {
    if (evaluated[key] !== declared[key] || realized[key] !== declared[key]) {
      throw new Error(`Realized/evaluated ${key} hash differs from declaration`);
    }
  }
}

const budget = ['--option', 'sandbox', 'true', '--option', 'max-jobs', '1', '--option', 'cores', '1'];
const immutable = ['--no-update-lock-file', '--no-write-lock-file'];
const exec = promisify(execFile);

async function execute(command, args, options) {
  const { stdout, stderr } = await exec(command, args, { ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

// Invoke the trusted script with cwd set to a clean, disposable main checkout.
// No GitHub API, commits, staging, flake updates, or application compilation.
export async function prepareUpdate({ cwd = process.cwd(), env = process.env, run = execute } = {}) {
  const version = validateVersion(env.UPDATE_VERSION);
  if (['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'].some(name => env[name])) {
    throw new Error('Run update generation without GitHub tokens');
  }
  cwd = resolve(cwd);
  const home = await mkdtemp(join(env.TMPDIR || tmpdir(), 'pd2-update-home-'));
  // Allowlist rather than delete known secrets. A separate HOME also prevents
  // implicit ~/.config/nix/access-tokens and Git credential configuration use.
  const childEnv = { HOME: home, PATH: env.PATH || process.env.PATH, TMPDIR: env.TMPDIR || tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', NIX_USER_CONF_FILES: '/dev/null' };
  for (const key of ['NIX_SSL_CERT_FILE', 'SSL_CERT_FILE']) if (env[key]) childEnv[key] = env[key];
  const command = (tool, args) => run(tool, args, { cwd, env: childEnv });
  const git = args => command('git', ['-c', `safe.directory=${cwd}`, ...args]);
  const snapshot = async () => {
    const state = {};
    for (const [key, file] of Object.entries({ native: 'native-package.nix', readme: 'README.md', flake: 'flake.nix', lock: 'flake.lock' })) {
      const path = join(cwd, file);
      if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${file}`);
      state[key] = await readFile(path, 'utf8');
    }
    return state;
  };
  const checkDiff = async (before, after) => {
    if ((await git(['ls-files', '--others', '--exclude-standard', '-z'])).length) throw new Error('Generated untracked files');
    if ((await git(['diff', '--no-ext-diff', '--summary', 'HEAD'])).length) throw new Error('Generated mode, rename, or file-type changes');
    const files = (await git(['diff', '--no-ext-diff', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean);
    return validateGeneratedDiff(before, after, files, version);
  };
  try {
    if ((await git(['status', '--porcelain=v1', '--untracked-files=all', '-z'])).length) {
      throw new Error('Update generation requires a clean disposable checkout');
    }
    const before = await snapshot();
    const oldVersion = readFields(before.native).values.version;
    const updateArgs = ['--flake', 'pd2-trader.native', `--version=${version}`, '--subpackage', 'frontend', ...budget];
    await command(env.NIX_UPDATE_BIN || 'nix-update', updateArgs);
    if (await readFile(join(cwd, 'README.md'), 'utf8') !== before.readme) throw new Error('Updater unexpectedly changed README');
    await writeFile(join(cwd, 'README.md'), updateReadme(before.readme, oldVersion, version));
    const after = await snapshot();
    const declared = await checkDiff(before, after);

    // A second real updater run must be a byte-for-byte no-op.
    await command(env.NIX_UPDATE_BIN || 'nix-update', updateArgs);
    if (JSON.stringify(await snapshot()) !== JSON.stringify(after)) throw new Error('Repeated update is not idempotent');
    await checkDiff(before, after);

    const evaluated = JSON.parse(await command('nix', ['eval', '--json', ...immutable, ...budget,
      '.#pd2-trader.native', '--apply', `p: {
        version = p.version; nativeCheck = p.doCheck; frontendCheck = p.frontend.doCheck;
        hash = p.src.outputHash; npmDepsHash = p.frontend.npmDeps.outputHash;
        cargoHash = p.cargoDeps.vendorStaging.outputHash;
      }`]));
    const realized = {};
    for (const [key, attr] of Object.entries({ hash: 'src', npmDepsHash: 'frontend.npmDeps', cargoHash: 'cargoDeps.vendorStaging' })) {
      const outputs = JSON.parse(await command('nix', ['build', '--json', '--no-link', ...immutable, ...budget, `.#pd2-trader.native.${attr}`]));
      const path = outputs.length === 1 && outputs[0].outputs?.out;
      if (typeof path !== 'string' || !/^\/nix\/store\/[a-z0-9]{32}-[^/\n]+$/.test(path)) throw new Error(`Invalid realized ${attr} output`);
      realized[key] = (await command('nix', ['hash', 'path', '--type', 'sha256', '--sri', path])).trim();
    }
    validateRealizedHashes(declared, evaluated, realized);
    // Catch side effects of evaluation/builds too; only emit after every check.
    const final = await snapshot();
    if (JSON.stringify(final) !== JSON.stringify(after)) throw new Error('Files changed during hash verification');
    await checkDiff(before, final);
    if (env.GITHUB_OUTPUT) {
      await appendFile(env.GITHUB_OUTPUT, `native=${Buffer.from(final.native).toString('base64')}\nreadme=${Buffer.from(final.readme).toString('base64')}\n`);
    }
    return { version, hashes: realized, changed: final.native !== before.native || final.readme !== before.readme };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await prepareUpdate()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
