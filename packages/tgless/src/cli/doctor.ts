import fs from 'node:fs';
import path from 'node:path';
import { buildProject } from './build.js';
import type { ResolvedConfig } from './config.js';
import { checkAllDeps } from './deps.js';
import { color, log } from './log.js';
import { tgcloudBin } from './tgcloud.js';

/** `tgless doctor`: sanity-check the project setup. */
export async function doctor(cfg: ResolvedConfig): Promise<boolean> {
  let ok = true;
  const pass = (m: string) => log.ok(m);
  const fail = (m: string, hint?: string) => {
    ok = false;
    log.error(m);
    if (hint) log.info(color.dim(`    ${hint}`));
  };
  const warn = (m: string, hint?: string) => {
    log.warn(m);
    if (hint) log.info(color.dim(`    ${hint}`));
  };

  const [major] = process.versions.node.split('.').map(Number);
  if (major >= 18) pass(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} is too old`, 'Use Node 18.18 or newer.');

  if (fs.existsSync(cfg.entryPath)) pass(`Entry ${cfg.entry}`);
  else fail(`Entry ${cfg.entry} is missing`, 'Create it or set `entry` in tgless.config.ts.');

  try {
    tgcloudBin(cfg.root);
    pass('@tgcloud/cli installed');
  } catch {
    fail('@tgcloud/cli is not installed', 'npm i -D @tgcloud/cli');
  }

  if (fs.existsSync(path.join(cfg.root, '.tgcloud'))) pass('Project linked to tgcloud (.tgcloud/ exists)');
  else warn('Project not linked to a bot yet', 'Run: npx tgcloud login');

  const gitignore = path.join(cfg.root, '.gitignore');
  if (fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf8').includes('.tgcloud')) pass('.tgcloud/ is gitignored');
  else warn('.tgcloud/ is not in .gitignore', 'It holds your credentials; add it to .gitignore.');

  log.step('Checking runtime dependencies…');
  if (!(await checkAllDeps(cfg))) ok = false;

  log.step('Test build…');
  try {
    await buildProject(cfg, { quiet: true });
    pass('Build succeeded');
  } catch (e) {
    fail(`Build failed: ${(e as Error).message}`);
  }
  return ok;
}
