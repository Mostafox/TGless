import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from '../cli/build.js';
import { loadConfig } from '../cli/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const example = path.join(repo, 'examples/shop-bot');
const runner = path.resolve(here, '../../test-fixtures/run-built.mjs');

function runScenario(steps: unknown[]) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tgless-')), 'scenario.json');
  fs.writeFileSync(file, JSON.stringify(steps));
  const stdout = execFileSync(process.execPath, [runner, example, file], { cwd: example, encoding: 'utf8' });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

describe('tgless build (examples/shop-bot)', () => {
  let result: Awaited<ReturnType<typeof buildProject>>;

  beforeAll(async () => {
    const cfg = await loadConfig(example);
    result = await buildProject(cfg, { quiet: true });
  });

  it('emits the tgcloud layout', () => {
    expect(result.files.map((f) => f.file).sort()).toEqual([
      'tgcloud/endpoints/addItem.js',
      'tgcloud/endpoints/getCart.js',
      'tgcloud/endpoints/listProducts.js',
      'tgcloud/handlers/callback_query.js',
      'tgcloud/handlers/message.js',
      'tgcloud/lib/app.js',
      'tgcloud/schema.js',
    ]);
    expect(result.manifest.tables).toEqual(['products', 'cart_items', 'orders', 'users', 'tgless_sessions']);
  });

  it('only imports sdk modules and relative .js files', () => {
    for (const f of result.files) {
      const src = fs.readFileSync(path.join(example, f.file), 'utf8');
      const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s === 'sdk' || s.startsWith('sdk/') || (s.startsWith('.') && s.endsWith('.js'))).toBe(true);
      expect(src).not.toMatch(/\brequire\(["'][^"']+["']\)/);
    }
  });

  it('bundles npm dependencies into lib/app.js', () => {
    const app = fs.readFileSync(path.join(example, 'tgcloud/lib/app.js'), 'utf8');
    expect(app).toContain('node_modules/dayjs');
  });

  it('runs the generated files end to end', () => {
    const report = runScenario([
      { text: '/start' },
      { text: '/addproduct' },
      { text: 'Coffee' },
      { text: '4.5' },
      { text: '3' },
      { text: '/shop' },
      { click: 'cart:add/1' },
      { endpoint: 'getCart' },
      { endpoint: 'addItem', input: { productId: 99 } },
    ]);
    const texts = report.calls.filter((c: any) => c.method === 'sendMessage').map((c: any) => c.params.text);
    expect(texts[0]).toMatch(/Hi <b>Admin<\/b>! Customer since \w{3} \d+, \d{4}/);
    expect(texts).toContain('✅ Added <b>Coffee</b> (#1).');
    const shop = report.calls.filter((c: any) => c.method === 'sendMessage').at(-1);
    expect(shop.params.reply_markup.inline_keyboard[0][0].text).toBe('Coffee — 4.50 USD');
    expect(report.calls.find((c: any) => c.method === 'answerCallbackQuery').params.text).toBe('Added Coffee 🛒');
    expect(report.results[0]).toMatchObject({ ok: true, result: { total: 4.5 } });
    expect(report.results[1]).toMatchObject({ ok: false, error: 'EndpointError', description: 'Product not found' });
  });
});
