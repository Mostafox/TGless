import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject } from '../cli/build.js';
import { loadConfig } from '../cli/config.js';
import { createTestBot } from '../testing/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.resolve(here, '../../.tmp-test');
const dest = path.join(tmp, 'starter');
const createBin = path.resolve(here, '../../../create-tgless/bin/create-tgless.js');

afterAll(() => fs.rmSync(dest, { recursive: true, force: true }));

describe('create-tgless template', () => {
  it('scaffolds, builds and runs', async () => {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    execFileSync(process.execPath, [createBin, 'starter'], { cwd: tmp, encoding: 'utf8' });

    for (const f of ['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'src/main.ts', 'test/bot.test.ts']) {
      expect(fs.existsSync(path.join(dest, f)), f).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).name).toBe('starter');

    const r = await buildProject(await loadConfig(dest), { quiet: true });
    expect(r.manifest).toMatchObject({ updates: ['message', 'callback_query'], tables: ['clicks'] });

    const { default: app } = await import(path.join(dest, 'src/main.ts'));
    const bot = createTestBot(app);
    await bot.send('/start');
    expect(bot.lastReply.text).toContain('Hi <b>Test</b>');
    await bot.click('core:click');
    await bot.click('core:click');
    expect(bot.api.callsOf('answerCallbackQuery').at(-1)?.text).toBe('You clicked 2 time(s) 🎉');
  });

  it('ships the same AGENTS.md in the tgless package', () => {
    const a = fs.readFileSync(path.resolve(here, '../../../create-tgless/template/AGENTS.md'), 'utf8');
    const b = fs.readFileSync(path.resolve(here, '../../AGENTS.md'), 'utf8');
    expect(b).toBe(a);
  });
});
