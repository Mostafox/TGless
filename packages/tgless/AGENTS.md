# AGENTS.md — building a bot with tgless

Read this before changing code in this project. It's written for AI coding agents, and it's just as useful for humans.

## What this project is

A Telegram bot (with optional Mini App endpoints) written in **TypeScript** with the **tgless** framework,
running on **Telegram Serverless (tgcloud)**: code runs in a V8 isolate next to the Bot API and an SQLite database.

- You write code in **`src/`**. `tgless build` compiles it into **`tgcloud/`**, the layout the platform requires.
- **Never edit `tgcloud/`.** It is regenerated on every build (and gitignored). Never edit `.tgcloud/` (credentials) or `.tgless/` (cache).
- npm packages are fine: `tgless build` bundles them into `tgcloud/lib/app.js` (the platform itself can't install npm packages).
- There is no server, no `process.env` at runtime, no filesystem, and no long-running state. Each update is handled
  independently, so keep state in the database (entities) or the session.

## Golden rules

1. Code goes in `src/modules/<feature>/…`. Register every new route/provider/entity in its module (`*.module.ts`).
2. Use `ctx.*` helpers and entities. Never import `sdk` directly unless you need something tgless doesn't wrap.
3. **Schema changes need a migration**: after changing an `entity()`, run `npm run deploy` and then `npm run migrate`.
   Never delete a column/table to drop it. Mark it `.deprecated('reason')` instead (see Database).
4. No foreign keys exist on tgcloud. Model links as plain `c.int()` columns + `relations()`, and keep integrity in code.
5. `callback_data` is limited to **64 bytes**. Build it with `myCallback.data({...})`, which checks the limit.
6. Before you finish: run `npm run typecheck`, `npm test` and `npm run build`. They must all pass.

## Commands

| Command | What it does |
|---|---|
| `npm run build` (`tgless build`) | Compile `src/` → `tgcloud/` |
| `npm run dev` (`tgless dev [--push]`) | Rebuild on change (optionally push each time) |
| `npm run deploy` (`tgless deploy`) | Build + `tgcloud push` (deploys code, **not** DB changes) |
| `npm run migrate` (`tgless migrate`) | Build + `tgcloud migrate` (applies schema changes; interactive) |
| `npm test` | Run tests locally with the in-memory platform (no network) |
| `npx tgless g <kind> <name> [--module m]` | Generate `module`, `command`, `callback`, `hears`, `entity`, `service`, `endpoint`, `scene` and register it |
| `npx tgless add <pkg>` | `npm install` + check the package can run on tgcloud |
| `npx tgless deps` / `npx tgless doctor` | Check dependencies / the whole setup |
| `npx tgless run endpoints/<name> '{}' --ctx '{ initData: { user: { id: 1 } } }'` | Build + execute one module on the platform |
| `npx tgcloud login` | Link this folder to a bot (once; needs a TTY) |

## Project layout

```
src/
  main.ts                         # export default createApp({ modules: [...] })
  modules/
    <feature>/
      <feature>.module.ts         # defineModule({...}): registers everything below
      commands/*.command.ts       # command('name', handler)
      callbacks/*.callback.ts     # callback('pattern/:param', handler)
      entities/*.entity.ts        # entity('table', {...columns})
      services/*.service.ts       # plain classes, injected with inject()/ctx.inject()
      endpoints/*.endpoint.ts     # endpoint(handler) for the Mini App
      scenes/*.scene.ts           # multi-step conversations
test/*.test.ts                    # vitest + tgless/testing
tgless.config.ts                  # optional build config
tgcloud/                          # GENERATED. Do not edit
```

Imports inside `src/` are normal TypeScript imports (no `.js` extension needed).

## The app and modules

```ts
// src/main.ts
import { createApp } from 'tglessjs';
export default createApp({
  modules: [UsersModule, ShopModule],
  parseMode: 'HTML',               // default parse_mode for replies/edits/captions
  middlewares: [logger()],         // run for every update (after the session loads)
  session: true,                   // DB-backed ctx.session (auto-enabled when scenes exist)
  onError: (err, ctx) => ctx.reply('Oops'), // default: console.error
  onUnhandled: (ctx) => ctx.reply('Unknown command'),
});
```

```ts
// src/modules/shop/shop.module.ts
import { defineModule } from 'tglessjs';
export const ShopModule = defineModule({
  name: 'shop',
  imports: [UsersModule],          // can inject what UsersModule exports
  providers: [CartService],        // classes or { provide, useValue | useClass | useFactory }
  exports: [CartService],          // what importers may inject
  entities: [Products, CartItems], // documents ownership (any imported entity is in the schema anyway)
  commands: [shopCommand],         // or a record: { shop: (ctx) => ... }
  callbacks: [addToCart],
  routes: [hears(/hi/i, h), on('message:photo', h)], // any route kind
  scenes: [checkoutScene],
  endpoints: { getCart, addItem }, // key = endpoint name → POST /api/<name>
  guards: [isAdmin],               // checked before every route of this module
  middlewares: [],                 // wrap every route of this module
  global: false,                   // true = exports visible to all modules without importing
});
```

A minimal bot can skip modules: `createApp({ commands: { start: (ctx) => ctx.reply('Hi') } })`.

## Routes

Routes are tried in this order: active **scene step**, then **commands**, **callbacks**, **inline queries**, **hears**, and **on** filters. The first match wins.

```ts
import { command, callback, hears, on, inlineQuery } from 'tglessjs';

export const start = command('start', { description: 'Main menu' }, async (ctx) => {
  ctx.args;        // "/start ref123" → "ref123" (deep-link payload)
  ctx.argList;     // ["ref123"]
  await ctx.reply(`Hi ${ctx.from.first_name}`);
});
command(['help', 'h'], handler);                      // aliases
command('ban', { guards: [guards.admins([123])] }, h); // per-route guards/middlewares

export const addToCart = callback('cart:add/:id', async (ctx) => {
  ctx.params.id;   // string; typed from the pattern
  await ctx.answer('Added');                       // toast (auto-answered if you don't)
});
addToCart.data({ id: 5 });                         // → "cart:add/5" (throws if > 64 bytes)
callback(/^page_(\d+)$/, (ctx) => ctx.match[1]);  // RegExp form

hears('Menu', h);                // exact text
hears(/^order (\d+)$/i, (ctx) => ctx.match[1]);
on('message:photo', h);          // update type + field present
on(':document', h);              // any message-like update with a document
on('chat_member', h);            // any update type (my_chat_member, poll_answer, …)
inlineQuery(/^search (.+)/, (ctx) => ctx.answerInline([...]));
```

Only the update types your routes use get a `tgcloud/handlers/<type>.js`, so the platform delivers only those.
To receive another type for middleware only, set `createApp({ updates: ['edited_message'] })`.

## Context (`ctx`)

| Member | Meaning |
|---|---|
| `ctx.reply(text, opts?)` | `sendMessage` to the current chat. `opts` = any Bot API param plus `keyboard`, `quote` |
| `ctx.replyWithPhoto/Document/Video/Audio/Voice/Animation/Sticker/Location(...)` | Send media |
| `ctx.edit(text, opts?)` / `ctx.editKeyboard(kb?)` / `ctx.editCaption(...)` | Edit the current (callback's) message |
| `ctx.answer(text?)` / `ctx.alert(text)` | Answer a callback query (toast / popup) |
| `ctx.answerInline(results)` | Answer an inline query |
| `ctx.deleteMessage()` / `ctx.typing()` | Delete the current message / chat action |
| `ctx.api.<method>({...})` | **Full Bot API** (snake_case params, returns the unwrapped result, throws `BotApiError`) |
| `ctx.from`, `ctx.chat`, `ctx.chatId`, `ctx.msg`, `ctx.text`, `ctx.data`, `ctx.query` | Update shortcuts |
| `ctx.message`, `ctx.callbackQuery`, `ctx.inlineQuery`, `ctx.update`, `ctx.updateType`, `ctx.payload` | Raw update |
| `ctx.params`, `ctx.match`, `ctx.args` | Route matches |
| `ctx.inject(Token)` | Resolve a provider from the current module |
| `ctx.session` | Persisted per chat+user (when sessions are enabled) |
| `ctx.scene` | `enter(id)`, `next()`, `back()`, `goto(i)`, `leave()`, `state` |
| `ctx.state` | Per-update scratch object (for middlewares) |
| `ctx.fetch(url, init)` | Outbound HTTP (the platform's fetch) |
| `ctx.sdk` / `ctx.db` / `ctx.app` | Raw platform SDK / raw DB / the app (`ctx.app.syncCommands()`) |

Text helpers: `` html`<b>${userInput}</b>` `` escapes interpolations (use with `parseMode: 'HTML'`); `md` does the same for MarkdownV2.

### Keyboards

```ts
import { inline, keyboard, removeKeyboard } from 'tglessjs';
inline().text('Buy', buy.data({ id: 1 })).url('Site', 'https://…').row().webApp('Open app', 'https://app<id>.tgcloud.ai/');
inline().grid(items, 2, (it) => ({ text: it.title, callback_data: show.data({ id: it.id }) }));
keyboard().text('Menu').requestContact('Share phone').oneTime().placeholder('Choose…');
await ctx.reply('…', { keyboard: removeKeyboard() });
```

## Dependency injection

Providers are singletons per app. Inject them with `inject()` in **field initializers** (no decorators or reflect-metadata):

```ts
import { inject, InjectionToken } from 'tglessjs';
export const CONFIG = new InjectionToken<{ currency: string }>('config');

export class CartService {
  private catalog = inject(CatalogService);        // must be provided or imported by this module
  private config = inject(CONFIG);
  private mailer = inject(Mailer, { optional: true });
}
// in handlers:
const cart = ctx.inject(CartService);
```

Visibility: a module sees its own providers, the `exports` of modules it `imports`, and the exports of `global: true` modules.
In tests, replace a provider with `bot.override(Token, { provide: Token, useValue: fake })`.

## Database (ORM)

Entities are a typed layer over tgcloud's SQLite query builder. `tgless build` turns them into `tgcloud/schema.js`.

```ts
import { c, entity, type Infer } from 'tglessjs/db';

export const Users = entity('users', {
  id: c.id(),                                // INTEGER PRIMARY KEY AUTOINCREMENT
  tgId: c.int().unique(),
  name: c.text(),                            // NOT NULL by default
  bio: c.text().optional(),                  // nullable → string | null
  lang: c.text().default('en'),
  role: c.enum(['user', 'admin']).default('user'), // union type + CHECK constraint
  isAdmin: c.bool().default(false),
  prefs: c.json<{ theme: string }>().optional(),
  balance: c.real().default(0),
  birthday: c.date().optional(),             // Date (unix seconds); c.dateMs() for ms
  avatar: c.blob().optional(),               // Uint8Array
  slug: c.text().generated('lower(name)', 'stored'),
  ...c.timestamps(),                         // createdAt + updatedAt (auto-updated)
}, {
  indexes: [['lang', 'role'], { columns: ['name'], unique: true, where: 'is_admin = 0' }],
  checks: { balance_positive: 'balance >= 0' },  // raw SQL, uses SQL column names
});
export type User = Infer<typeof Users>;
```

Other column helpers: `c.uuid()` (text PK, random UUID), `c.int().index()`, `.named('sql_name')`, `.defaultSql('(unixepoch())')`,
`.defaultFn(() => …)` (computed in JS on insert), `.constraint('COLLATE NOCASE')`, `.primary()`.
Keys are camelCase in TS and become snake_case in SQL (`tgId` → `tg_id`).

### Queries

```ts
import { gt, gte, lt, like, contains, inArray, between, isNull, ne } from 'tglessjs/db';

await Users.find({ tgId: 42 });                         // first match or null
await Users.findById(1);
await Users.findOrFail({ tgId: 42 });                   // throws EntityNotFoundError
await Users.findMany({ where: { lang: 'fa', balance: gt(10) }, orderBy: { id: 'desc' }, limit: 20, offset: 0 });
await Users.findMany({ where: { OR: [{ role: 'admin' }, { name: contains('ali') }], bio: null } });
await Users.count({ role: 'admin' });  await Users.exists({ tgId: 42 });
await Users.paginate({ where: {...}, page: 2, perPage: 10 }); // { items, total, page, pages, hasNext }

await Users.create({ tgId: 42, name: 'Ann' });          // returns the row
await Users.createMany([...]);                          // chunked automatically
await Users.update({ id: 1 }, { name: 'Bob' });         // returns updated rows; refreshes updatedAt
await Users.updateById(1, { name: 'Bob' });
await Users.upsert({ where: { tgId: 42 }, create: { name: 'Ann' }, update: { name: 'Ann' } }); // where keys must be UNIQUE/PK
await Users.findOrCreate({ tgId: 42 }, { name: 'Ann' });
await Users.increment({ id: 1 }, 'balance', 5);  await Users.decrement(...);
await Users.delete({ id: 1 });                          // returns count; empty where throws (safety)
```

Relations (no FKs; loaded with one extra `IN (…)` query, so there's no N+1):

```ts
export const Orders = entity('orders', { id: c.id(), userId: c.int().index(), total: c.real() })
  .relations((r) => ({ user: r.belongsTo(() => Users, 'userId') }));
export const UsersWithOrders = Users.relations((r) => ({ orders: r.hasMany(() => Orders, 'userId') }));
await UsersWithOrders.find({ id: 1 }, { with: { orders: { where: { total: gt(0) }, orderBy: { id: 'desc' } } } });
```

Escape hatch: the raw tgcloud builder, `Users.select(...)`, `Users.table.<col>`, `Users.ops` (`eq`, `and`, `sql`, `sum`, …), `Users.db`:

```ts
const { ops } = Orders;
const row = await Orders.select({ revenue: ops.sum(Orders.table.total) }).where(ops.gt(Orders.table.total, 0)).get();
```

### Migrations (tgcloud rules)

- `deploy` (push) **never** changes the database; `migrate` applies the diff: additive changes are "safe", destructive ones ask one by one.
- **Dropping**: mark the column `.deprecated('why')` or the table `{ deprecated: 'why' }`, then migrate. Removing the key does NOT drop it.
- **Type changes are manual**: add a new column, copy the data with raw SQL (`Users.db.run(...)`), deprecate the old one.
- No foreign keys. Delete children before parents yourself.

## Sessions and scenes

```ts
declare module 'tglessjs' {
  interface SessionData { lang?: string; cart?: number[] }   // typed ctx.session
}
createApp({ session: { initial: () => ({ cart: [] }) } });

export const signup = scene<{ name?: string }>('signup', {
  steps: [
    async (ctx) => { await ctx.reply('Name?'); ctx.scene.next(); },       // step 0 runs on enter()
    async (ctx) => {                                                      // runs on the next update
      if (!ctx.text) return ctx.reply('Text please');                     // no next() → same step again
      ctx.scene.state.name = ctx.text; ctx.scene.leave();
    },
  ],
  cancelCommands: ['cancel'],              // default; leaves the scene
  onCancel: (ctx) => ctx.reply('Cancelled'),
});
await ctx.scene.enter('signup');
```

During a scene, other commands still route normally (the scene stays active), and so do buttons whose data matches a registered `callback()`.
Everything else goes to the current step.

## Mini App endpoints

```ts
import { endpoint, fail } from 'tglessjs';
export const getProfile = endpoint(async (ctx) => {
  const user = await Users.find({ tgId: ctx.user.id });  // ctx.user = verified initData.user
  if (!user) throw fail('Not registered', { code: 'NOT_FOUND' }); // → 400 ENDPOINT_ERROR for the client
  return user;                                            // → JSON result
});
export const rename = endpoint({ input: z.object({ name: z.string() }), guards: [(ctx) => ctx.user.id !== 0] },
  async (ctx) => Users.update({ tgId: ctx.user.id }, { name: ctx.input.name }));
```

The endpoint name is its key in the module's `endpoints: { getProfile }`. Its URL is `POST /api/getProfile` and it is called from the
front-end with `Telegram.WebApp.Serverless.call('getProfile', input, cb)`. `input` accepts a zod/valibot schema (`parse`/`safeParse`)
or a function. Validation failures return `{ code: 'VALIDATION_ERROR', issues }`. Any other thrown error becomes a generic 500.
The Mini App front-end itself is configured in `tgcloud.jsonc` (`"static": { "source": "dist" }`). Build it before deploying.

## Guards and middlewares

```ts
import { guards, logger, ForbiddenError } from 'tglessjs';
guards.admins([123], '⛔ Admins only')   // throws ForbiddenError → message sent to the user
guards.users(ids) · guards.privateChat() · guards.groups() · guards.chatType('channel')
guards.when((ctx) => ctx.inject(Config).adminIds.includes(ctx.from!.id), 'No access')
const timing: Middleware = async (ctx, next) => { const t = Date.now(); await next(); console.log(Date.now() - t); };
```

A guard returning `false` stops silently. `throw new ForbiddenError('msg')` anywhere tells the user `msg`.

## npm packages

- Install with `npx tgless add <pkg>`. It reports whether the package can run on tgcloud.
- Packages are bundled at build time (browser/worker builds preferred). `Buffer`/`process` globals and `events`/`buffer` are polyfilled automatically.
- If a package imports Node built-ins (`fs`, `net`, `crypto`, …), the build fails and lists them. Fix it with one of:
  a browser-compatible alternative; `alias: { crypto: 'some-polyfill' }`; or `stubBuiltins: ['fs']` if that code path is never used.
- `globalThis.fetch` is mapped to the platform's fetch, so fetch-based SDKs work. Raw sockets/`http` modules don't.
- Use `ctx.fetch`/`ctx.api` rather than HTTP clients that need Node.

## Configuration and secrets

There is no `process.env` at runtime. Values are inlined at **build time** through `tgless.config.ts`:

```ts
export default defineConfig({
  define: { 'process.env.PAYMENT_TOKEN': JSON.stringify(process.env.PAYMENT_TOKEN ?? '') },
  // entry, minify, alias, stubBuiltins, polyfills, fetchShim, target, maxFileSize
});
```

Declare the type in `src/env.d.ts`: `declare const process: { env: { PAYMENT_TOKEN?: string } };`.
Provide config to services through an `InjectionToken` in a `global: true` module.
Never commit secrets: read them from the shell environment when building.

## Testing

```ts
import { createTestBot } from 'tglessjs/testing';
import app from '../src/main';

const bot = createTestBot(app, { user: { id: 1 } });       // fresh in-memory SQLite per bot
await bot.send('/start');                                  // text/commands
await bot.sendMessage({ photo: [...] });                   // any message
await bot.click(addToCart.data({ id: 1 }));                // callback query
await bot.inline('query');
const res = await bot.call('getCart', { input: 1 });       // endpoint → { ok, result } | { ok: false, … }
bot.lastReply.text; bot.replies; bot.api.callsOf('answerCallbackQuery');
bot.api.respond('getChat', {...}); bot.api.fail('sendMessage', 403, 'Forbidden: bot was blocked');
bot.fetch.mock('https://api.example.com/', { json: {...} });
bot.override(Token, { provide: Token, useValue: fake });
await Users.count();                                        // entities work against the test DB
```

Tests run with `npm test` (vitest). They need the dev dependencies `better-sqlite3` and `drizzle-orm`, which are already in package.json.

## Common errors

| Error | Fix |
|---|---|
| `No provider for X in module "m"` | Add X to `providers`, or import a module that `exports` it |
| `Entity "t" is not bound` | The entity isn't imported anywhere in the app. Import it / add it to a module's `entities` |
| `Table export "t" is missing from schema.js` | Rebuild (`npm run build`) and deploy |
| `callback_data … is N bytes` | Shorten the pattern/params (64-byte limit) |
| `Some dependencies need Node.js built-ins` | See *npm packages* |
| `Your app threw while loading` | Top-level code runs at build time. Don't call the DB/API at import time; do it inside handlers |
| DB column missing at runtime | You deployed but didn't `npm run migrate` |

Platform reference (SDK, limits, CLI): https://core.telegram.org/bots/serverless
