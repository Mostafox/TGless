# Architecture

tgless has two halves: a **runtime** that ships inside your bot, and a **CLI** that turns TypeScript into the layout
Telegram Serverless (tgcloud) runs.

## Build pipeline (`tgless build`)

```
src/**/*.ts ──► [1] manifest pass ─────────► updates, endpoints, entities
   │               esbuild → .tgless/manifest.mjs (sdk stubbed)
   │               run in a child Node process → app.manifest()
   │
   ├──────────► [2] schema.js codegen ──────► tgcloud/schema.js      (imports only sdk/db)
   │
   ├──────────► [3] bundle ─────────────────► tgcloud/lib/app.js     (app + npm deps, ESM)
   │               esbuild, platform=browser
   │               sdk, sdk/*, ../schema.js stay external
   │               Node built-ins → polyfill / browser field / alias / stub / error
   │               Buffer/process shims injected only if referenced
   │
   └──────────► [4] entry files ────────────► tgcloud/handlers/<type>.js
                                              tgcloud/endpoints/<name>.js
```

Every handler/endpoint file is a two-line adapter:

```js
import { app } from '../lib/app.js';
export default function (payload, ctx) { return app.handle('message', payload, ctx); }
```

and `lib/app.js` starts with

```js
import * as sdk from 'sdk';
import * as dbModule from 'sdk/db';
import * as schema from '../schema.js';
import app from '<your src/main.ts>';
app.bind({ sdk, dbModule, schema });   // entities get their platform tables here
export { app };
```

So the tables used by queries are exactly the objects tgcloud loaded from `schema.js`.

## Runtime

```
update ─► App.handle(type, payload, ctx)
            ├─ session middleware (load ctx.session from tgless_sessions)
            ├─ global middlewares
            ├─ active scene step?  ─► step handler
            └─ router: commands → callbacks → inline → hears → on
                  └─ module guards + route guards → module middlewares → handler
          finally: auto-answer callback queries; save the session if it changed

endpoint ─► App.callEndpoint(name, input, ctx) → validate input → guards → handler
            EndpointError/fail() → platform EndpointError (400); other errors → 500
```

**Modules** each get a DI `Container`. A module resolves its own providers, the `exports` of the modules it imports,
and the exports of `global` modules. `inject()` works inside provider construction (field initializers), and `ctx.inject()` uses
the container of the module that owns the route that is running.

**Entities** are declared with `entity()` and registered globally. `app.manifest()` lists them for codegen, and `app.bind()`
attaches each one to its platform table. Repository methods translate `where` objects into `sdk/db` operators.

## Testing

`tglessjs/testing` builds the same `Platform` the generated code builds, but from:

- a recording Bot API proxy (`MockApi`) and a fetch mock;
- `better-sqlite3` in memory, with drizzle-orm standing in for `sdk/db` (tgcloud's query builder is Drizzle-like), and
  DDL generated from the entities.

`createTestBot(app)` binds the app to that platform. The e2e test (`build.e2e.test.ts`) goes further: it builds
`examples/shop-bot` and imports the **generated** `tgcloud/` files with a Node loader hook that maps `sdk` to the mock.
