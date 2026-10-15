import { callback, command, defineModule, html, inline } from 'tglessjs';
import { c, entity } from 'tglessjs/db';

/** One row per user who pressed the button. */
export const Clicks = entity('clicks', {
  id: c.id(),
  userId: c.int().unique(),
  count: c.int().default(0),
  ...c.timestamps(),
});

export const clickButton = callback('core:click', async (ctx) => {
  const existing = await Clicks.find({ userId: ctx.from.id });
  const row = existing
    ? (await Clicks.increment({ id: existing.id }, 'count'))[0]
    : await Clicks.create({ userId: ctx.from.id, count: 1 });
  await ctx.answer(`You clicked ${row.count} time(s) 🎉`);
});

export const CoreModule = defineModule({
  name: 'core',
  entities: [Clicks],
  commands: [
    command('start', { description: 'Start the bot' }, (ctx) =>
      ctx.reply(html`Hi <b>${ctx.from.first_name}</b>! I run on Telegram Serverless 🚀`, {
        keyboard: inline().text('Click me', clickButton.data()),
      }),
    ),
    command('help', { description: 'What can this bot do?' }, (ctx) => ctx.reply('Send /start and press the button.')),
  ],
  callbacks: [clickButton],
});
