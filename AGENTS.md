# AGENTS.md — working on the tgless framework

This repo **is the framework**. If you are building a *bot* with tgless, read
[packages/create-tgless/template/AGENTS.md](packages/create-tgless/template/AGENTS.md) instead (it ships in every new project).

## Repo map

| Path | What |
|---|---|
| `packages/tgless/src/runtime/` | Runs **on tgcloud** inside the user's bundle: app, modules, router, context, DI, sessions, scenes, endpoints, keyboards, guards |
| `packages/tgless/src/db/` | ORM: column builders, `entity()` + repository, operators, `schema.js` codegen |
| `packages/tgless/src/cli/` | Runs **in Node** on the developer's machine: build pipeline, esbuild plugins, generators, deps check, doctor, tgcloud passthrough |
| `packages/tgless/src/testing/` | Mock platform (Bot API recorder, fetch mock, better-sqlite3 + drizzle as `sdk/db`) and `createTestBot` |
| `packages/tgless/src/sdk.ts` | Our internal description of the platform SDK (`sdk`, `sdk/db`) |
| `packages/tgless/shims/` | `Buffer`/`process` globals injected into user bundles only when referenced |
| `packages/tgless/types/sdk.d.ts` | Ambient `declare module 'sdk'` for users who import the platform directly |
| `packages/tgless/test-fixtures/run-built.mjs` | Executes a **built** `tgcloud/` folder in Node with a fake `sdk` (used by the e2e test) |
| `packages/create-tgless/` | `npm create tgless` + the starter `template/` (incl. the user-facing AGENTS.md) |
| `examples/shop-bot/` | Large multi-module example; also the e2e fixture |
| `docs/architecture.md` | How the build and the runtime fit together |

## Commands

```bash
npm install
npm run build          # tsc → packages/tgless/dist, and copies the template AGENTS.md into packages/tgless
npm test               # vitest: runtime, ORM, build e2e, deps bundling, generators, template
npm run typecheck
cd examples/shop-bot && npx tgless build   # try the CLI on the example
```

The build/e2e tests run the CLI from `src/`, but they spawn `dist/cli/manifest-runner.js`, so **run `npm run build` before `npm test`**
after changing anything under `src/cli` or `src/db/codegen.ts`. The example and template also import `tgless` from `dist/`.

## Invariants (don't break these)

1. **Runtime code (`src/runtime`, `src/db` except `codegen.ts`) must run in a V8 isolate**: no Node built-ins, no `process`,
   and no imports of `sdk` (the platform is injected through `app.bind(platform)` by the generated `lib/app.js`).
   This keeps the runtime testable with the mock platform.
2. **Generated output must satisfy tgcloud**: `handlers/` and `endpoints/` are flat; only `sdk`, `sdk/*` and relative `.js` imports;
   `schema.js` imports only `sdk/db` and exports tables as named exports. `validateBundle()` and the e2e test enforce this.
3. Only update types used by routes get a handler file (`App.manifest()`), because tgcloud derives the webhook's `allowed_updates` from them.
4. The manifest is collected in a **child process** (`manifest-runner.ts`) so module state (the entity registry) never leaks between builds.
5. tgcloud has **no foreign keys**, and drops happen only via `.deprecated()`. Never emit `.references()`/`foreignKey()`.
6. `packages/tgless` is `"sideEffects": false`. User code isn't, so `entity()` calls in user files always register.
7. Keep `packages/create-tgless/template/AGENTS.md` (the source) and `packages/tgless/AGENTS.md` (the copy) identical. A test checks this.
   When you change a public API, update that AGENTS.md in the same change.

## Platform facts (from `@tgcloud/cli` 0.2 and core.telegram.org/bots/serverless)

- Layout: `tgcloud/schema.js`, `tgcloud/lib/**` (nested OK), `tgcloud/handlers/<update_type>.js`, `tgcloud/endpoints/<name>.js`.
- Handler: `export default (payload, ctx)`, where `payload` = `update[type]` and `ctx.update` = the full update.
  Endpoint: `(input, ctx)` with verified `ctx.initData`; `throw new EndpointError(desc, params)` → 400.
- `sdk/db` is Drizzle-like: `table/integer/text/real/numeric/blob/boolean/json`, `.primaryKey/.notNull/.unique/.default/.generatedAlwaysAs/.deprecated`,
  extras callback `(t) => ({ index(...).on(...), check(...), uniqueIndex, primaryKey })`; builders are awaitable; `.returning()` yields rows.
- `api.<method>(params)` returns the unwrapped result and throws `BotApiError` (`.code`, `.description`). `fetch` is web-like.
- `push` never migrates; `migrate` is separate and interactive.

## Style

TypeScript strict, ESM with `.js` import suffixes inside `packages/tgless/src`. Follow the surrounding code: small modules, doc comments
on public APIs, and errors that tell the user how to fix the problem.
