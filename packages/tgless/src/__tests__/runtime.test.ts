import { describe, expect, it } from 'vitest';
import {
  callback,
  command,
  createApp,
  defineModule,
  endpoint,
  fail,
  guards,
  hears,
  inject,
  inline,
  InjectionToken,
  on,
  scene,
} from '../index.js';
import { c, entity, gte, inArray } from '../db/index.js';
import { createTestBot } from '../testing/index.js';

const Users = entity('rt_users', {
  id: c.id(),
  tgId: c.int().unique(),
  name: c.text(),
  lang: c.text().default('en'),
  role: c.enum(['user', 'admin']).default('user'),
  prefs: c.json<{ theme: string }>().optional(),
  ...c.timestamps(),
});

const Orders = entity('rt_orders', {
  id: c.id(),
  userId: c.int().index(),
  total: c.real(),
  paid: c.bool().default(false),
});

const UsersR = Users.relations((r) => ({ orders: r.hasMany(() => Orders, 'userId') }));

const GREETING = new InjectionToken<string>('greeting');

class UsersService {
  greeting = inject(GREETING);
  async ensure(tgId: number, name: string) {
    return Users.findOrCreate({ tgId }, { name });
  }
}

const UsersModule = defineModule({
  name: 'users',
  providers: [UsersService, { provide: GREETING, useValue: 'Hello' }],
  exports: [UsersService],
  entities: [Users, Orders],
});

const addToCart = callback('cart:add/:id', async (ctx) => {
  await ctx.answer(`added ${ctx.params.id}`);
});

const signup = scene<{ name?: string }>('signup', [
  async (ctx) => {
    await ctx.reply('Your name?');
    ctx.scene.next();
  },
  async (ctx) => {
    if (!ctx.text) return ctx.reply('Text please');
    ctx.scene.state.name = ctx.text;
    await ctx.reply(`Nice to meet you, ${ctx.text}`);
    ctx.scene.leave();
  },
]);

const ShopModule = defineModule({
  name: 'shop',
  imports: [UsersModule],
  commands: {
    start: async (ctx) => {
      const svc = ctx.inject(UsersService);
      const user = await svc.ensure(ctx.from.id, ctx.from.first_name);
      await ctx.reply(`${svc.greeting} ${user.name}`, { keyboard: inline().text('Add', addToCart.data({ id: 7 })) });
    },
  },
  routes: [
    command('admin', { guards: [guards.admins([1], 'nope')] }, (ctx) => ctx.reply('secret')),
    command('signup', (ctx) => ctx.scene.enter('signup')),
    hears(/^ping$/i, (ctx) => ctx.reply('pong')),
    on('message:photo', (ctx) => ctx.reply('nice photo')),
  ],
  callbacks: [addToCart],
  scenes: [signup],
  endpoints: {
    me: endpoint(async (ctx) => {
      const u = await Users.find({ tgId: ctx.user.id });
      if (!u) throw fail('Not registered', { code: 'NOT_FOUND' });
      return { name: u.name };
    }),
    double: endpoint({ input: (x: any) => ({ n: Number(x.n) }) }, (ctx) => ctx.input.n * 2),
  },
});

const app = createApp({ modules: [ShopModule] });

describe('runtime', () => {
  it('builds a manifest', () => {
    const m = app.manifest();
    expect(m.updates).toEqual(['message', 'callback_query']);
    expect(m.endpoints.sort()).toEqual(['double', 'me']);
    expect(m.entities.map((e) => e.tableName)).toEqual(expect.arrayContaining(['rt_users', 'rt_orders', 'tgless_sessions']));
  });

  it('handles commands with DI and keyboards', async () => {
    const bot = createTestBot(app);
    await bot.send('/start');
    expect(bot.lastReply.text).toBe('Hello Test');
    expect(bot.lastReply.reply_markup.inline_keyboard[0][0].callback_data).toBe('cart:add/7');
    expect(await Users.count()).toBe(1);
  });

  it('routes callbacks with params', async () => {
    const bot = createTestBot(app);
    await bot.click('cart:add/9');
    expect(bot.api.callsOf('answerCallbackQuery')[0].text).toBe('added 9');
  });

  it('auto-answers unmatched callbacks', async () => {
    const bot = createTestBot(app);
    await bot.click('unknown');
    expect(bot.api.callsOf('answerCallbackQuery')).toHaveLength(1);
  });

  it('applies guards', async () => {
    const bot = createTestBot(app);
    await bot.send('/admin');
    expect(bot.lastReply.text).toBe('nope');
    const admin = createTestBot(app, { user: { id: 1 } });
    await admin.send('/admin');
    expect(admin.lastReply.text).toBe('secret');
  });

  it('hears and filters', async () => {
    const bot = createTestBot(app);
    await bot.send('PING');
    expect(bot.lastReply.text).toBe('pong');
    await bot.sendMessage({ photo: [{ file_id: 'x', file_unique_id: 'y', width: 1, height: 1 }] });
    expect(bot.lastReply.text).toBe('nice photo');
  });

  it('runs scenes across updates', async () => {
    const bot = createTestBot(app);
    await bot.send('/signup');
    expect(bot.lastReply.text).toBe('Your name?');
    await bot.send('Ann');
    expect(bot.lastReply.text).toBe('Nice to meet you, Ann');
    await bot.send('ping');
    expect(bot.lastReply.text).toBe('pong');
  });

  it('cancels scenes', async () => {
    const bot = createTestBot(app);
    await bot.send('/signup');
    await bot.send('/cancel');
    await bot.send('ping');
    expect(bot.lastReply.text).toBe('pong');
  });

  it('serves endpoints', async () => {
    const bot = createTestBot(app);
    expect(await bot.call('me')).toMatchObject({ ok: false, error_type: 'ENDPOINT_ERROR', parameters: { code: 'NOT_FOUND' } });
    await bot.send('/start');
    expect(await bot.call('me')).toEqual({ ok: true, result: { name: 'Test' } });
    expect(await bot.call('double', { n: '21' })).toEqual({ ok: true, result: 42 });
  });
});

describe('orm', () => {
  it('creates, queries, updates and deletes', async () => {
    createTestBot(app);
    const a = await Users.create({ tgId: 1, name: 'Ann', prefs: { theme: 'dark' } });
    expect(a).toMatchObject({ id: 1, lang: 'en', role: 'user', prefs: { theme: 'dark' } });
    expect(a.createdAt).toBeInstanceOf(Date);
    await Users.createMany([
      { tgId: 2, name: 'Bob', lang: 'fa' },
      { tgId: 3, name: 'Cid', role: 'admin' },
    ]);
    expect(await Users.count({ lang: 'fa' })).toBe(1);
    expect((await Users.findMany({ where: { tgId: gte(2) }, orderBy: { tgId: 'desc' } })).map((u) => u.name)).toEqual(['Cid', 'Bob']);
    expect((await Users.findMany({ where: { OR: [{ name: 'Ann' }, { role: 'admin' }] } })).length).toBe(2);
    expect(await Users.find({ prefs: null })).toMatchObject({ name: 'Bob' });

    const [upd] = await Users.update({ tgId: 2 }, { name: 'Bobby' });
    expect(upd.name).toBe('Bobby');

    const up = await Users.upsert({ where: { tgId: 2 }, create: { name: 'X' }, update: { name: 'Robert' } });
    expect(up.name).toBe('Robert');
    expect(await Users.count()).toBe(3);

    const page = await Users.paginate({ page: 2, perPage: 2, orderBy: { id: 'asc' } });
    expect(page).toMatchObject({ total: 3, pages: 2, hasNext: false });
    expect(page.items).toHaveLength(1);

    expect(await Users.delete({ tgId: inArray([1, 3]) })).toBe(2);
    await expect(Users.delete({})).rejects.toThrow(/empty where/);
  });

  it('loads relations and increments', async () => {
    createTestBot(app);
    const u = await Users.create({ tgId: 5, name: 'Rel' });
    await Orders.createMany([
      { userId: u.id, total: 10 },
      { userId: u.id, total: 5, paid: true },
    ]);
    const withOrders = await UsersR.find({ id: u.id }, { with: { orders: true } });
    expect(withOrders?.orders.map((o) => o.total).sort()).toEqual([10, 5].sort());
    expect(withOrders?.orders.find((o) => o.paid)?.total).toBe(5);
    const [inc] = await Orders.increment({ userId: u.id, paid: true }, 'total', 2);
    expect(inc.total).toBe(7);
  });

  it('rejects invalid enum values via CHECK', async () => {
    createTestBot(app);
    await expect(Users.create({ tgId: 9, name: 'Bad', role: 'root' as any })).rejects.toThrow();
  });
});

describe('README example', () => {
  it('works as written', async () => {
    const Clicks = entity('readme_clicks', { id: c.id(), userId: c.int().unique(), count: c.int().default(0) });
    const click = callback('click', async (ctx) => {
      const row = await Clicks.findOrCreate({ userId: ctx.from.id });
      const [updated] = await Clicks.increment({ id: row.id }, 'count');
      await ctx.answer(`Clicked ${updated.count}×`);
    });
    const readmeApp = createApp({
      commands: { start: (ctx) => ctx.reply('Hi!', { keyboard: inline().text('Click', click.data()) }) },
      callbacks: [click],
    });
    const bot = createTestBot(readmeApp);
    await bot.send('/start');
    await bot.click(bot.lastReply.reply_markup.inline_keyboard[0][0].callback_data);
    await bot.click('click');
    expect(bot.api.callsOf('answerCallbackQuery').map((a) => a.text)).toEqual(['Clicked 1×', 'Clicked 2×']);
  });
});
