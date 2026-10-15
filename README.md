# TGless

**A TypeScript framework for building large Telegram bots on [Telegram Serverless](https://core.telegram.org/bots/serverless) (tgcloud).**

Modules and dependency injection (in the spirit of NestJS, without decorators), a typed ORM over tgcloud's SQLite,
npm packages bundled for you, and a local test harness. You need very little code to start, and you can customize everything.

```ts
// src/main.ts: a complete bot
import { createApp, inline, callback } from 'tgless';
import { c, entity } from 'tgless/db';

const Clicks = entity('clicks', { id: c.id(), userId: c.int().unique(), count: c.int().default(0) });

const click = callback('click', async (ctx) => {
  const row = await Clicks.findOrCreate({ userId: ctx.from.id });
  const [updated] = await Clicks.increment({ id: row.id }, 'count');
  await ctx.answer(`Clicked ${updated.count}×`);
});

export default createApp({
  commands: { start: (ctx) => ctx.reply('Hi!', { keyboard: inline().text('Click', click.data()) }) },
  callbacks: [click],
});
```

```bash
npx tgless build     # → tgcloud/schema.js, tgcloud/lib/app.js, tgcloud/handlers/*.js
npx tgless deploy    # build + tgcloud push
```

## Why

tgcloud runs plain JavaScript modules in a fixed layout, with no npm packages and no build step. tgless lets you write
TypeScript in feature modules and compiles it into that layout:

| You write (`src/`) | tgless generates (`tgcloud/`) |
|---|---|
| `entity('users', {...})` | `schema.js` (tables for `tgcloud migrate`) |
| `command()`, `callback()`, `hears()`, `on()`, scenes | `handlers/message.js`, `handlers/callback_query.js`, … (only the ones you use) |
| `endpoints: { getCart }` | `endpoints/getCart.js` (Mini App `POST /api/getCart`) |
| your code + npm packages | `lib/app.js` (one bundled ESM file) |

## Features

- **Modules + DI**: `defineModule({ imports, providers, exports, commands, callbacks, scenes, endpoints, guards, middlewares })`, `inject()` with no decorators.
- **Routing**: commands (with args/deep links), typed callback patterns (`'cart:add/:id'` → `ctx.params.id` and `addToCart.data({ id })`), hears, filter queries, inline queries.
- **Context helpers**: `reply`, `edit`, `answer`, keyboards builder, `html` escaping, and the full Bot API on `ctx.api`.
- **ORM**: typed entities, `find/findMany/paginate/create/upsert/update/increment/delete`, relations without FKs, enums, JSON, dates, indexes, checks, and an escape hatch to the raw query builder.
- **Sessions & scenes**: DB-backed `ctx.session` and multi-step conversations.
- **Mini App endpoints** with input validation (zod/valibot/functions) and `fail()` → client errors.
- **npm packages**: bundled with esbuild; Node built-ins are detected and polyfilled, stubbed, or explained.
- **Testing**: `createTestBot(app)` with an in-memory SQLite and a recording Bot API, no network.
- **CLI**: `build`, `dev`, `deploy`, `migrate`, `run`, generators (`tgless g module|command|callback|entity|service|endpoint|scene`), `add`, `deps`, `doctor`.
- **AGENTS.md** in every project, so AI coding agents know the rules.

## Get started

```bash
npm create tgless@latest my-bot
cd my-bot && npm install
npx tgcloud login
npm run deploy && npm run migrate
```

## Repository

| | |
|---|---|
| [packages/tgless](packages/tgless) | The framework (runtime, ORM, CLI, testing) |
| [packages/create-tgless](packages/create-tgless) | Project scaffolder + starter template |
| [examples/shop-bot](examples/shop-bot) | Multi-module shop: catalog, cart, checkout scene, admin, Mini App endpoints |
| [packages/create-tgless/template/AGENTS.md](packages/create-tgless/template/AGENTS.md) | **The guide**: full API reference for building bots |
| [docs/architecture.md](docs/architecture.md) | How the build and runtime work |
| [AGENTS.md](AGENTS.md) | Contributing to the framework |

## License

MIT
