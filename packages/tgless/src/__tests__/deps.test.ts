import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject } from '../cli/build.js';
import { loadConfig } from '../cli/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Inside the repo so `tgless` resolves through the workspace node_modules.
const tmpRoot = path.resolve(here, '../../.tmp-test');

let n = 0;
function project(files: Record<string, string>) {
  const root = path.join(tmpRoot, `p${++n}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [file, contents] of Object.entries(files)) {
    const p = path.join(root, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
  }
  return root;
}

const pkg = (name: string, main: string, extra: object = {}) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...extra }),
  [`node_modules/${name}/index.js`]: main,
});

const app = (imports: string, use: string) => ({
  'package.json': JSON.stringify({ name: 'p', type: 'module' }),
  'src/main.ts': `import { createApp, command } from 'tgless';
${imports}
export default createApp({ commands: { start: (ctx) => ctx.reply(String(${use})) } });
`,
});

async function build(root: string) {
  return buildProject(await loadConfig(root), { quiet: true });
}

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('npm dependencies', () => {
  it('bundles a plain ESM/CJS package', async () => {
    const root = project({ ...app(`import { slug } from 'slugger';`, `slug('Hello World')`), ...pkg('slugger', `exports.slug = (s) => s.toLowerCase().replace(/ /g, '-');`) });
    await build(root);
    const out = fs.readFileSync(path.join(root, 'tgcloud/lib/app.js'), 'utf8');
    expect(out).toContain('node_modules/slugger');
    expect(out).not.toMatch(/from ["']slugger["']/);
  });

  it('fails with a clear message when a package needs Node built-ins', async () => {
    const root = project({
      ...app(`import { read } from 'needs-fs';`, `read`),
      ...pkg('needs-fs', `const fs = require('fs'); const net = require('node:net'); exports.read = () => fs.readFileSync('x');`),
    });
    await expect(build(root)).rejects.toThrow(/needs-fs.*imports "fs", "net"/s);
  });

  it('honours stubBuiltins', async () => {
    const root = project({
      ...app(`import { read } from 'needs-fs';`, `typeof read`),
      ...pkg('needs-fs', `const fs = require('fs'); exports.read = () => fs.readFileSync('x');`),
      'tgless.config.ts': `export default { stubBuiltins: ['fs'] };`,
    });
    await expect(build(root)).resolves.toBeTruthy();
  });

  it("honours a package's browser field", async () => {
    const root = project({
      ...app(`import { ok } from 'browser-aware';`, `ok`),
      ...pkg('browser-aware', `const fs = require('fs'); exports.ok = 'yes';`, { browser: { fs: false } }),
    });
    await expect(build(root)).resolves.toBeTruthy();
  });

  it('injects the Buffer polyfill only when used', async () => {
    const withBuf = project({ ...app(`import { b64 } from 'uses-buffer';`, `b64('hi')`), ...pkg('uses-buffer', `exports.b64 = (s) => Buffer.from(s).toString('base64');`) });
    await build(withBuf);
    expect(fs.readFileSync(path.join(withBuf, 'tgcloud/lib/app.js'), 'utf8')).toContain('node_modules/buffer');

    const without = project(app('', `'plain'`));
    await build(without);
    expect(fs.readFileSync(path.join(without, 'tgcloud/lib/app.js'), 'utf8')).not.toContain('node_modules/buffer');
  });

  it('generates only the handlers the app uses', async () => {
    const root = project(app('', `'x'`));
    const r = await build(root);
    expect(r.files.map((f) => f.file)).toEqual(['tgcloud/handlers/message.js', 'tgcloud/lib/app.js', 'tgcloud/schema.js']);
  });
});
