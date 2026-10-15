import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CliError } from './log.js';

/** Path to the project's local `@tgcloud/cli` bin. */
export function tgcloudBin(root: string): string {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const pkgJson = require.resolve('@tgcloud/cli/package.json');
    return path.join(path.dirname(pkgJson), 'bin', 'tgcloud.js');
  } catch {
    throw new CliError('The tgcloud CLI is not installed in this project. Run: npm i -D @tgcloud/cli');
  }
}

/** Run `tgcloud <args>` in the project root, inheriting stdio. Resolves with the exit code. */
export function runTgcloud(root: string, args: string[]): Promise<number> {
  const bin = tgcloudBin(root);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
