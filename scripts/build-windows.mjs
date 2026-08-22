import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsTarget = 'x86_64-pc-windows-msvc';
const isNativeWindows = process.platform === 'win32';
const environment = { ...process.env };

if (!isNativeWindows) {
  const extraPaths = [
    join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/opt/llvm/bin',
    '/usr/local/opt/llvm/bin',
  ].filter(existsSync);
  environment.PATH = [...extraPaths, environment.PATH ?? ''].filter(Boolean).join(delimiter);
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { env: environment, stdio: 'ignore' });
  return !result.error && result.status !== null;
}

function rustTargetInstalled(target) {
  const result = spawnSync('rustup', ['target', 'list', '--installed'], {
    encoding: 'utf8',
    env: environment,
  });
  return result.status === 0 && result.stdout.split(/\r?\n/).includes(target);
}

if (!isNativeWindows) {
  const missing = [];
  if (!commandAvailable('makensis', ['-VERSION'])) missing.push('NSIS (makensis)');
  if (!commandAvailable('llvm-rc', ['--version'])) missing.push('LLVM (llvm-rc)');
  if (!commandAvailable('cargo-xwin', ['--version'])) missing.push('cargo-xwin');
  if (!rustTargetInstalled(windowsTarget)) missing.push(`Rust target ${windowsTarget}`);

  if (missing.length > 0) {
    console.error(`Windows cross-build prerequisites are missing:\n- ${missing.join('\n- ')}`);
    if (process.platform === 'darwin') {
      console.error(`\nInstall them once:\n  brew install nsis llvm\n  rustup target add ${windowsTarget}\n  cargo install --locked cargo-xwin`);
    } else {
      console.error('\nInstall NSIS, LLVM/LLD, cargo-xwin, and the Windows MSVC Rust target, then retry.');
    }
    process.exit(1);
  }
}

const tauriArguments = isNativeWindows
  ? ['build', '--bundles', 'nsis,msi']
  : [
      'build',
      '--runner',
      'cargo-xwin',
      '--target',
      windowsTarget,
      '--bundles',
      'nsis',
    ];
const tauriCli = fileURLToPath(
  new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url),
);

if (!existsSync(tauriCli)) {
  console.error('Tauri CLI is not installed. Run npm ci first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tauriCli, ...tauriArguments], {
  env: environment,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not start the Windows build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
