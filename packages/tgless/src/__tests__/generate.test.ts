import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject } from '../cli/build.js';
import { loadConfig } from '../cli/config.js';
import { fieldToCode, generate, insertIntoLiteral } from '../cli/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../.tmp-test/gen');

const oneShot = path.resolve(here, '../../.tmp-test/gen-one-shot');
const bin = path.resolve(here, '../../bin/tgless.js');

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(oneShot, { recursive: true, force: true });
});

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
      `import { createApp } from 'tglessjs';\n\nexport default createApp({\n  modules: [],\n});\n`,
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

describe('fieldToCode', () => {
  it('maps the compact field syntax', () => {
    expect(fieldToCode('title:text').code).toBe('c.text()');
    expect(fieldToCode('price:real=0').code).toBe('c.real().default(0)');
    expect(fieldToCode('sku:text!').code).toBe('c.text().unique()');
    expect(fieldToCode('userId:int#').code).toBe('c.int().index()');
    expect(fieldToCode('note:text?').code).toBe('c.text().optional()');
    expect(fieldToCode("lang:text=it's").code).toBe("c.text().default('it\\'s')");
    expect(fieldToCode('status:enum(draft|live)=draft').code).toBe("c.enum(['draft', 'live']).default('draft')");
    expect(fieldToCode('active:bool=true').code).toBe('c.bool().default(true)');
    expect(fieldToCode('seenAt:date=now').code).toBe("c.date().defaultSql('(unixepoch())')");
    expect(fieldToCode('meta:json?').code).toBe('c.json().optional()');
    expect(() => fieldToCode('x:money')).toThrow(/Unknown field type/);
    expect(() => fieldToCode('x:int=abc')).toThrow(/must be a number/);
    expect(() => fieldToCode('nope')).toThrow(/Bad field/);
  });
});

describe('tgless g module (one command)', () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [bin, 'g', ...args, '--root', oneShot], { encoding: 'utf8' });

  it('creates a whole module from flags, extends it, and builds', async () => {
    fs.rmSync(oneShot, { recursive: true, force: true });
    fs.mkdirSync(path.join(oneShot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(oneShot, 'package.json'), JSON.stringify({ name: 'one', type: 'module' }));
    fs.writeFileSync(path.join(oneShot, 'src/main.ts'), `import { createApp } from 'tglessjs';

export default createApp({
  modules: [],
});
`);

    run('module', 'users', '--entity', 'user:tgId:int!,name:text');
    run(
      'module', 'shop',
      '--imports', 'users',
      '--commands', 'shop,cart',
      '--callbacks', 'add/:id,refresh',
      '--hears', 'thanks',
      '--entity', 'product:title:text,price:real=0,sku:text!,status:enum(draft|live)=draft,note:text?,active:bool=true',
      '--entity', 'order:total:real,userId:int#',
      '--services', 'cart',
      '--endpoints', 'getCart',
      '--scenes', 'checkout',
    );
    run('module', 'shop', '--commands', 'help');
    run('command', 'about,faq', '--module', 'shop');

    const mod = fs.readFileSync(path.join(oneShot, 'src/modules/shop/shop.module.ts'), 'utf8');
    for (const s of ['UsersModule', 'shopCommand', 'cartCommand', 'helpCommand', 'aboutCommand', 'faqCommand', 'addCallback', 'refreshCallback', 'thanksHears', 'Products', 'Orders', 'CartService', 'getCart', 'checkoutScene']) {
      expect(mod, s).toContain(s);
    }
    const product = fs.readFileSync(path.join(oneShot, 'src/modules/shop/entities/product.entity.ts'), 'utf8');
    expect(product).toContain("status: c.enum(['draft', 'live']).default('draft'),");
    expect(product).toContain('sku: c.text().unique(),');
    expect(fs.readFileSync(path.join(oneShot, 'src/modules/shop/callbacks/add.callback.ts'), 'utf8')).toContain("callback('shop:add/:id'");
    expect(fs.readFileSync(path.join(oneShot, 'src/main.ts'), 'utf8')).toContain('modules: [UsersModule, ShopModule]');
    expect(() => run('module', 'shop')).toThrow();

    const r = await buildProject(await loadConfig(oneShot), { quiet: true });
    expect(r.manifest.tables).toEqual(['users', 'products', 'orders', 'tgless_sessions']);
    expect(r.manifest.endpoints).toEqual(['getCart']);
    expect(r.manifest.commands.map((c) => c.command).sort()).toEqual(['about', 'cart', 'faq', 'help', 'shop']);
  });
});
