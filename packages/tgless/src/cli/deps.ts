import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type { ResolvedConfig } from './config.js';
import { CliError, color, formatBytes, log } from './log.js';
import { platformPlugin } from './plugins.js';

/** `@scope/pkg@^1` → `@scope/pkg` */
export function packageName(spec: string): string {
  if (spec.startsWith('@')) {
    const [scope, rest] = spec.split('/');
    return `${scope}/${rest.split('@')[0]}`;
  }
  return spec.split('@')[0];
}

/** Packages the framework itself provides; never bundled as user deps. */
const SKIP = new Set(['tglessjs', 'tgless', '@tgcloud/cli', 'typescript', 'vitest', 'better-sqlite3', 'drizzle-orm']);

export interface DepReport {
  name: string;
  ok: boolean;
  size?: number;
  problems?: string[];
  error?: string;
}

/** Try to bundle `import * as m from '<pkg>'` the way `tgless build` would. */
export async function checkPackage(cfg: ResolvedConfig, name: string): Promise<DepReport> {
  const problems: { pkg: string; builtin: string; importer: string }[] = [];
  try {
    const result = await esbuild.build({
      stdin: { contents: `export * from ${JSON.stringify(name)};`, resolveDir: cfg.root, loader: 'js' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      mainFields: ['browser', 'module', 'main'],
      conditions: ['worker', 'browser', 'import', 'default'],
      target: cfg.target,
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis', ...cfg.define },
      alias: cfg.alias,
      plugins: [platformPlugin({ polyfills: cfg.polyfills, allowEmpty: cfg.stubBuiltins, problems })],
      logLevel: 'silent',
    });
    const size = result.outputFiles.reduce((n, f) => n + f.contents.length, 0);
    if (problems.length) {
      const list = [...new Set(problems.map((p) => `${p.pkg} → ${p.builtin}`))];
      return { name, ok: false, size, problems: list };
    }
    return { name, ok: true, size };
  } catch (e) {
    const errors = (e as esbuild.BuildFailure)?.errors;
    return { name, ok: false, error: errors?.map((x) => x.text).join('; ') ?? String(e) };
  }
}

export function printReport(reports: DepReport[]) {
  for (const r of reports) {
    if (r.ok) log.ok(`${color.bold(r.name)} bundles fine ${color.dim(`(~${formatBytes(r.size ?? 0)} minified)`)}`);
    else {
      log.error(`${color.bold(r.name)} is not compatible with tgcloud as-is`);
      for (const p of r.problems ?? []) log.info(`    needs Node built-in: ${p}`);
      if (r.error) log.info(`    ${r.error}`);
    }
  }
  if (reports.some((r) => !r.ok)) {
    log.info(
      color.dim(
        '  Fix with `alias` (map a built-in to an npm polyfill) or `stubBuiltins` in tgless.config.ts, or pick a browser/edge-compatible library.',
      ),
    );
  }
}

function npm(root: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** `tgless add <pkg...>`: npm install + compatibility check. */
export async function addPackages(cfg: ResolvedConfig, specs: string[], dev = false) {
  if (!specs.length) throw new CliError('Usage: tgless add <package> [more packages] [--dev]');
  const code = await npm(cfg.root, ['install', dev ? '--save-dev' : '--save', ...specs]);
  if (code !== 0) throw new CliError('npm install failed.');
  if (dev) return;
  log.step('Checking that the packages can be bundled for tgcloud…');
  const reports = await Promise.all(specs.map((s) => checkPackage(cfg, packageName(s))));
  printReport(reports);
  if (reports.every((r) => r.ok)) log.info(color.dim('  Import them normally; `tgless build` bundles them into tgcloud/lib/app.js.'));
}

/** `tgless deps`: check every runtime dependency in package.json. */
export async function checkAllDeps(cfg: ResolvedConfig) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cfg.root, 'package.json'), 'utf8'));
  const names = Object.keys(pkg.dependencies ?? {}).filter((n) => !SKIP.has(n) && !n.startsWith('@types/'));
  if (!names.length) {
    log.info('No runtime dependencies to check.');
    return true;
  }
  const reports = await Promise.all(names.map((n) => checkPackage(cfg, n)));
  printReport(reports);
  return reports.every((r) => r.ok);
}
