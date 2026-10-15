import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { TglessConfig } from '../config.js';

export interface ResolvedConfig extends Required<Omit<TglessConfig, 'define' | 'alias' | 'stubBuiltins'>> {
  root: string;
  /** Absolute entry path. */
  entryPath: string;
  /** `<root>/tgcloud` */
  outDir: string;
  /** `<root>/.tgless` (scratch). */
  cacheDir: string;
  define: Record<string, string>;
  alias: Record<string, string>;
  stubBuiltins: string[];
}

const CONFIG_FILES = ['tgless.config.ts', 'tgless.config.mts', 'tgless.config.js', 'tgless.config.mjs'];

/** Load `tgless.config.*` (optional) from the project root. */
export async function loadConfig(root: string): Promise<ResolvedConfig> {
  const cacheDir = path.join(root, '.tgless');
  let user: TglessConfig = {};
  const file = CONFIG_FILES.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (file) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const out = path.join(cacheDir, 'config.mjs');
    await build({
      entryPoints: [file],
      outfile: out,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
    });
    const mod = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
    user = mod.default ?? {};
  }
  const entry = user.entry ?? 'src/main.ts';
  return {
    root,
    entry,
    entryPath: path.resolve(root, entry),
    outDir: path.join(root, 'tgcloud'),
    cacheDir,
    minify: user.minify ?? false,
    polyfills: user.polyfills ?? true,
    fetchShim: user.fetchShim ?? true,
    stubBuiltins: user.stubBuiltins ?? [],
    define: user.define ?? {},
    alias: Object.fromEntries(
      Object.entries(user.alias ?? {}).map(([k, v]) => [k, v.startsWith('.') ? path.resolve(root, v) : v]),
    ),
    maxFileSize: user.maxFileSize ?? 5 * 1024 * 1024,
    target: user.target ?? 'es2022',
  };
}

/** Nearest directory (from `start` up) with a package.json. */
export function findRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}
