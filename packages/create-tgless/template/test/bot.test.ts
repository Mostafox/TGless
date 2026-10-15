import { describe, expect, it } from 'vitest';
import { createTestBot } from 'tglessjs/testing';
import app from '../src/main';

describe('bot', () => {
  it('greets on /start', async () => {
    const bot = createTestBot(app);
    await bot.send('/start');
    expect(bot.lastReply.text).toContain('Hi <b>Test</b>');
  });

  it('counts clicks', async () => {
    const bot = createTestBot(app);
    await bot.click('core:click');
    await bot.click('core:click');
    expect(bot.api.callsOf('answerCallbackQuery').at(-1)?.text).toBe('You clicked 2 time(s) 🎉');
  });
});
