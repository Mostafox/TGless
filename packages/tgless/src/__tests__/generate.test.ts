import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject } from '../cli/build.js';
import { loadConfig } from '../cli/config.js';
import { generate, insertIntoLiteral } from '../cli/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../.tmp-test/gen');

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('insertIntoLiteral', () => {
  it('handles empty, inline and multiline literals', () => {
    expect(insertIntoLiteral('x({ a: [] })', 'a', 'B', '[')).toBe('x({ a: [B] })');
    expect(insertIntoLiteral('x({ a: [A] })', 'a', 'B', '[')).toBe('x({ a: [A, B] })');
    expect(insertIntoLiteral('x({\n  a: [\n    A,\n  ],\n})', 'a', 'B', '[')).toBe('x({\n  a: [\n    A,\n    B,\n  ],\n})');
    expect(insertIntoLiteral('x({ e: { a } })', 'e', 'b', '{')).toBe('x({ e: { a, b } })');
    expect(insertIntoLiteral('x({})', 'a', 'B', '[')).toBeUndefined();
  });
});

describe('tgless g', () => {
  it('scaffolds a module with every kind of file and still builds', async () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'gen', type: 'module' }));
    fs.writeFileSync(
      path.join(root, 'src/main.ts'),
      `import { createApp } from 'tgless';\n\nexport default createApp({\n  modules: [],\n});\n`,
    );
    const opts = { root, entry: 'src/main.ts' };
    generate('module', 'blog', opts);
    for (const [kind, name] of [
      ['command', 'hello'],
      ['callback', 'like-post'],
      ['hears', 'thanks'],
      ['entity', 'post'],
      ['service', 'posts'],
      ['endpoint', 'getPosts'],
      ['scene', 'new-post'],
    ] as const) {
      generate(kind, name, opts);
    }
    const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    expect(main).toContain(`import { BlogModule } from './modules/blog/blog.module';`);
    expect(main).toContain('modules: [BlogModule]');
    const mod = fs.readFileSync(path.join(root, 'src/modules/blog/blog.module.ts'), 'utf8');
    for (const s of ['helloCommand', 'likePostCallback', 'thanksHears', 'Posts', 'PostsService', 'getPosts', 'newPostScene']) {
      expect(mod).toContain(s);
    }
    expect(() => generate('command', 'hello', opts)).toThrow(/already exists/);

    const r = await buildProject(await loadConfig(root), { quiet: true });
    expect(r.manifest.updates).toEqual(['message', 'callback_query']);
    expect(r.manifest.endpoints).toEqual(['getPosts']);
    expect(r.manifest.tables).toEqual(['posts', 'tgless_sessions']);
    expect(r.manifest.commands).toEqual([{ command: 'hello', description: 'Hello' }]);
  });
});
