import type { BotCommand, ParseMode, Update } from '@grammyjs/types';
import type { Entity } from '../db/entity.js';
import { getEntityRegistry } from '../db/entity.js';
import type { Platform } from '../sdk.js';
import { Context, type ContextHost } from './context.js';
import { Container, type Provider, type Token } from './di.js';
import { type Endpoint, EndpointContext, ENDPOINT_NAME, validate } from './endpoint.js';
import { EndpointError, ForbiddenError } from './errors.js';
import { type Module, type ModuleDefinition, defineModule } from './module.js';
import {
  type Awaitable,
  type CommandRoute,
  type Guard,
  type Handler,
  type Middleware,
  type Route,
  command as makeCommand,
  matchesFilter,
  routeUpdateTypes,
} from './routes.js';
import { type Scene, SCENE_KEY, createSceneControl } from './scene.js';
import { type SessionOptions, SessionsEntity, sessionMiddleware } from './session.js';
import { UPDATE_TYPES, type UpdateType } from './update-types.js';

export interface AppOptions extends Omit<ModuleDefinition, 'middlewares' | 'guards' | 'global' | 'exports'> {
  /** Feature modules. */
  modules?: Module[];
  /** Global middlewares: run for every update, before routing (after the session loads). */
  middlewares?: Middleware<any>[];
  /** DB-backed `ctx.session`. Enabled automatically when scenes are registered. */
  session?: boolean | SessionOptions;
  /** Default `parse_mode` for `ctx.reply()`/`ctx.edit()`/captions. */
  parseMode?: ParseMode;
  /** `false` disables link previews in `ctx.reply()` by default. */
  linkPreview?: boolean;
  /** Answer callback queries automatically when a handler didn't (default `true`). */
  autoAnswerCallbacks?: boolean;
  /** Called for errors thrown by handlers. Default: `console.error`. */
  onError?: (error: unknown, ctx: Context) => Awaitable<unknown>;
  /** Called when no route matched the update. */
  onUnhandled?: Handler<Context>;
  /** Extra update types to receive (e.g. handled only by middlewares). */
  updates?: UpdateType[];
}

export interface AppManifest {
  updates: UpdateType[];
  endpoints: string[];
  entities: Entity<any, any>[];
  commands: BotCommand[];
}

interface CompiledModule {
  module: Module;
  container: Container;
}

interface RouteEntry {
  route: Route;
  owner: CompiledModule;
}

interface EndpointEntry {
  name: string;
  endpoint: Endpoint;
  owner: CompiledModule;
}

const KIND_ORDER: Route['kind'][] = ['command', 'callback', 'inline', 'hears', 'on'];

export class App implements ContextHost {
  readonly defaults: ContextHost['defaults'];
  readonly rootContainer: Container;
  private readonly globalContainer = new Container('<global>');
  private readonly modules: CompiledModule[] = [];
  private readonly routes: RouteEntry[] = [];
  private readonly routesByType = new Map<UpdateType, RouteEntry[]>();
  private readonly endpoints = new Map<string, EndpointEntry>();
  private readonly scenes = new Map<string, { scene: Scene; owner: CompiledModule }>();
  private readonly sessionOptions: SessionOptions | undefined;
  private readonly middlewares: Middleware<any>[];
  private _platform?: Platform;

  constructor(readonly options: AppOptions) {
    this.defaults = { parseMode: options.parseMode, linkPreview: options.linkPreview };
    const { modules = [], imports = [], middlewares, ...rootDef } = options;
    const root = defineModule({ ...rootDef, name: options.name ?? 'app', imports: [...imports, ...modules] });
    this.compile(root);
    this.rootContainer = this.modules.find((m) => m.module === root)!.container;
    for (const m of this.modules) this.collect(m);

    const wantsSession = options.session ?? this.scenes.size > 0;
    if (this.scenes.size > 0 && options.session === false) {
      throw new Error('Scenes need sessions; remove `session: false`.');
    }
    this.sessionOptions = wantsSession ? (typeof wantsSession === 'object' ? wantsSession : {}) : undefined;
    this.middlewares = middlewares ?? [];

    for (const type of UPDATE_TYPES) {
      const list = this.routes
        .filter((e) => routeUpdateTypes(e.route).includes(type))
        .sort((a, b) => KIND_ORDER.indexOf(a.route.kind) - KIND_ORDER.indexOf(b.route.kind));
      if (list.length) this.routesByType.set(type, list);
    }
  }

  // ───────────── compilation ─────────────

  private compile(root: Module) {
    const seen = new Map<Module, CompiledModule>();
    const visit = (m: Module, stack: Module[]): CompiledModule => {
      if (stack.includes(m)) {
        throw new Error(`Circular module import: ${[...stack, m].map((x) => x.name).join(' → ')}`);
      }
      const done = seen.get(m);
      if (done) return done;
      const container = new Container(m.name, this.globalContainer);
      const compiled: CompiledModule = { module: m, container };
      seen.set(m, compiled);
      for (const p of m.providers ?? []) container.register(p as Provider);
      for (const t of m.exports ?? []) {
        container.exported.add(t);
      }
      for (const imp of m.imports ?? []) {
        if (!imp?.__module) throw new Error(`Module "${m.name}" imports something that is not a defineModule() result.`);
        container.imports.push(visit(imp, [...stack, m]).container);
      }
      // Exporting an imported module re-exports its exports.
      for (const t of m.exports ?? []) {
        if (!container.has(t as Token) && !(m.imports ?? []).some((i) => (i.exports ?? []).includes(t))) {
          const name = typeof t === 'function' ? t.name : String(t);
          throw new Error(`Module "${m.name}" exports ${name} but neither provides nor imports it.`);
        }
      }
      if (m.global) this.globalContainer.imports.push(container);
      this.modules.push(compiled);
      return compiled;
    };
    visit(root, []);
  }

  private collect(owner: CompiledModule) {
    const m = owner.module;
    const add = (r: Route) => {
      if (!r || typeof r !== 'object' || !('kind' in r)) {
        throw new Error(`Module "${m.name}" has an invalid route entry (use command()/callback()/hears()/on()).`);
      }
      this.routes.push({ route: r, owner });
    };
    if (m.commands) {
      if (Array.isArray(m.commands)) m.commands.forEach(add);
      else {
        for (const [name, h] of Object.entries(m.commands)) {
          add(typeof h === 'function' ? makeCommand(name, h) : { ...(h as CommandRoute), names: [name, ...(h as CommandRoute).names.filter((n) => n !== name)] });
        }
      }
    }
    for (const list of [m.callbacks, m.hears, m.on, m.inline, m.routes]) list?.forEach(add);
    for (const s of m.scenes ?? []) {
      if (this.scenes.has(s.id)) throw new Error(`Scene "${s.id}" is registered twice.`);
      this.scenes.set(s.id, { scene: s, owner });
    }
    for (const [name, e] of Object.entries(m.endpoints ?? {})) {
      if (!ENDPOINT_NAME.test(name)) throw new Error(`Invalid endpoint name "${name}" (letters, digits, _; not starting with a digit).`);
      if (this.endpoints.has(name)) throw new Error(`Endpoint "${name}" is defined twice.`);
      const endpoint: Endpoint = typeof e === 'function' ? { kind: 'endpoint', options: {}, handler: e } : e;
      this.endpoints.set(name, { name, endpoint, owner });
    }
  }

  // ───────────── introspection ─────────────

  /** What the build needs: update types, endpoints, entities. */
  manifest(): AppManifest {
    const updates = new Set<UpdateType>(this.options.updates ?? []);
    for (const t of this.routesByType.keys()) updates.add(t);
    if (this.scenes.size) {
      updates.add('message');
      updates.add('callback_query');
    }
    if (this.options.onUnhandled) updates.add('message');
    return {
      updates: UPDATE_TYPES.filter((t) => updates.has(t)),
      endpoints: [...this.endpoints.keys()],
      entities: this.entities(),
      commands: this.commandList(),
    };
  }

  entities(): Entity<any, any>[] {
    const out = new Set<Entity<any, any>>();
    for (const e of getEntityRegistry()) if (!e.internal) out.add(e);
    for (const m of this.modules) for (const e of m.module.entities ?? []) out.add(e);
    if (this.sessionOptions) out.add(SessionsEntity);
    return [...out];
  }

  /** Commands with a description, for `setMyCommands`. */
  commandList(): BotCommand[] {
    const out: BotCommand[] = [];
    for (const { route } of this.routes) {
      if (route.kind === 'command' && route.options.description) {
        out.push({ command: route.names[0], description: route.options.description });
      }
    }
    return out;
  }

  /** Register described commands with Telegram (`setMyCommands`). */
  async syncCommands(): Promise<BotCommand[]> {
    const commands = this.commandList();
    await this.platform.sdk.api.setMyCommands({ commands });
    return commands;
  }

  // ───────────── platform ─────────────

  /** Connect the app to the platform. Called by the generated `tgcloud/lib/app.js`. */
  bind(platform: Platform): this {
    this._platform = platform;
    for (const e of this.entities()) {
      const table = platform.schema[e.exportName];
      if (!table) {
        throw new Error(`Table export "${e.exportName}" is missing from schema.js. Rebuild with \`tgless build\`.`);
      }
      e.bind(table, platform.sdk.db, platform.dbModule);
    }
    return this;
  }

  get platform(): Platform {
    if (!this._platform) throw new Error('App is not bound to a platform. (Generated code calls app.bind().)');
    return this._platform;
  }

  /** Replace a provider everywhere it is registered (tests, environment switches). */
  override<T>(token: Token<T>, provider: Provider<T>) {
    let found = false;
    for (const m of this.modules) {
      if (m.container.has(token)) {
        m.container.override(token, provider);
        found = true;
      }
    }
    if (!found) throw new Error(`override(): no module provides ${typeof token === 'function' ? token.name : String(token)}.`);
    return this;
  }

  /** Resolve a provider from the root module (scripts/tests). */
  get<T>(token: Token<T>): T {
    return this.rootContainer.resolve(token) as T;
  }

  // ───────────── updates ─────────────

  /** Entry point for `tgcloud/handlers/<type>.js`. */
  async handle(type: UpdateType, payload: unknown, platformCtx?: { update?: Update }): Promise<void> {
    const update = (platformCtx?.update ?? { update_id: 0, [type]: payload }) as Update;
    const ctx = new Context(this, type, payload, update);
    if (this.scenes.size) ctx.scene = createSceneControl(ctx, (id) => this.scenes.get(id)?.scene, (s, c) => this.runScene(s, c));
    try {
      const chain: Middleware<any>[] = [];
      if (this.sessionOptions) chain.push(sessionMiddleware(this.sessionOptions));
      chain.push(...this.middlewares);
      chain.push(async (c: Context) => {
        const handled = (await this.dispatchScene(c)) || (await this.route(c));
        if (!handled && this.options.onUnhandled) await this.options.onUnhandled(c);
      });
      await compose(chain)(ctx);
    } catch (err) {
      await this.handleError(err, ctx);
    } finally {
      if (type === 'callback_query' && !ctx.callbackAnswered && this.options.autoAnswerCallbacks !== false) {
        try {
          await ctx.answer();
        } catch {
          /* already answered or expired */
        }
      }
    }
  }

  private async handleError(err: unknown, ctx: Context) {
    if (err instanceof ForbiddenError) {
      if (err.userMessage) {
        try {
          if (ctx.updateType === 'callback_query') await ctx.alert(err.userMessage);
          else if (ctx.chatId !== undefined) await ctx.reply(err.userMessage);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (this.options.onError) {
      await this.options.onError(err, ctx);
    } else {
      console.error(`[tgless] error while handling ${ctx.updateType}:`, err);
    }
  }

  private isCommand(ctx: Context): { name: string; args: string } | undefined {
    const m = ctx.message;
    const text = m?.text;
    if (!text || !text.startsWith('/')) return undefined;
    const ent = m.entities?.[0];
    if (ent && !(ent.type === 'bot_command' && ent.offset === 0)) return undefined;
    const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return undefined;
    return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
  }

  private async dispatchScene(ctx: Context): Promise<boolean> {
    if (!this.scenes.size || !ctx.session) return false;
    const stored = (ctx.session as any)[SCENE_KEY] as { id: string } | undefined;
    if (!stored) return false;
    const entry = this.scenes.get(stored.id);
    if (!entry) {
      ctx.scene.leave();
      return false;
    }
    const cmd = this.isCommand(ctx);
    if (cmd) {
      const cancel = entry.scene.options.cancelCommands ?? ['cancel'];
      if (cancel.includes(cmd.name)) {
        ctx.scene.leave();
        if (entry.scene.options.onCancel) {
          ctx.container = entry.owner.container;
          await entry.scene.options.onCancel(ctx as any);
          return true;
        }
      }
      return false; // other commands route normally; the scene stays active
    }
    // Buttons that belong to a registered callback route keep working inside a scene.
    const data = ctx.callbackQuery?.data;
    if (data !== undefined) {
      const routes = this.routesByType.get('callback_query') ?? [];
      if (routes.some((e) => e.route.kind === 'callback' && e.route.regex.test(data))) return false;
    }
    await this.runScene(entry.scene, ctx);
    return true;
  }

  private async runScene(scene: Scene, ctx: Context) {
    const owner = this.scenes.get(scene.id)!.owner;
    ctx.container = owner.container;
    const step = scene.options.steps[ctx.scene.step];
    if (!step) {
      ctx.scene.leave();
      return;
    }
    await runGuarded(ctx, owner.module.guards ?? [], owner.module.middlewares ?? [], step);
  }

  private match(route: Route, ctx: Context): boolean {
    const c = ctx as any;
    switch (route.kind) {
      case 'command': {
        const cmd = this.isCommand(ctx);
        if (!cmd || !route.names.includes(cmd.name)) return false;
        c.command = cmd.name;
        c.args = cmd.args;
        c.argList = cmd.args ? cmd.args.split(/\s+/) : [];
        return true;
      }
      case 'hears': {
        const text = ctx.message?.text ?? ctx.message?.caption;
        if (text === undefined) return false;
        for (const t of route.triggers) {
          if (typeof t === 'string') {
            if (text.trim() === t) {
              ctx.match = Object.assign([text], { index: 0, input: text }) as RegExpMatchArray;
              return true;
            }
          } else {
            t.lastIndex = 0;
            const m = text.match(t);
            if (m) {
              ctx.match = m;
              return true;
            }
          }
        }
        return false;
      }
      case 'callback': {
        const data = ctx.callbackQuery?.data;
        if (data === undefined) return false;
        const m = route.regex.exec(data);
        if (!m) return false;
        ctx.match = m;
        ctx.params = route.paramNames.length
          ? Object.fromEntries(route.paramNames.map((n, i) => [n, m[i + 1]]))
          : { ...(m.groups ?? {}) };
        return true;
      }
      case 'inline': {
        const q = ctx.inlineQuery;
        if (!q) return false;
        if (!route.pattern) return true;
        const m = q.query.match(route.pattern);
        if (!m) return false;
        ctx.match = m;
        return true;
      }
      case 'on':
        return route.filters.some((f) => matchesFilter(f, ctx.updateType, ctx.payload));
    }
  }

  private async route(ctx: Context): Promise<boolean> {
    for (const entry of this.routesByType.get(ctx.updateType) ?? []) {
      if (!this.match(entry.route, ctx)) continue;
      ctx.container = entry.owner.container;
      const m = entry.owner.module;
      const r = entry.route.options;
      await runGuarded(
        ctx,
        [...(m.guards ?? []), ...(r.guards ?? [])],
        [...(m.middlewares ?? []), ...(r.middlewares ?? [])],
        entry.route.handler,
      );
      return true;
    }
    return false;
  }

  // ───────────── endpoints ─────────────

  /** Entry point for `tgcloud/endpoints/<name>.js`. */
  async callEndpoint(name: string, input: unknown, platformCtx: Record<string, unknown> = {}): Promise<unknown> {
    const entry = this.endpoints.get(name);
    if (!entry) throw new Error(`Unknown endpoint "${name}".`);
    const { endpoint, owner } = entry;
    try {
      const value = endpoint.options.input ? validate(endpoint.options.input, input ?? {}) : (input ?? {});
      const ctx = new EndpointContext(value, platformCtx as any, this.platform, owner.container, name);
      for (const g of endpoint.options.guards ?? []) {
        if (!(await g(ctx))) throw new EndpointError('Forbidden', { code: 'FORBIDDEN' });
      }
      return await endpoint.handler(ctx);
    } catch (err) {
      if (err instanceof EndpointError) {
        throw new this.platform.sdk.EndpointError(err.description, toPlain(err.parameters));
      }
      if (err instanceof ForbiddenError) {
        throw new this.platform.sdk.EndpointError(err.userMessage ?? 'Forbidden', { code: 'FORBIDDEN' });
      }
      throw err;
    }
  }
}

function toPlain(v: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(v ?? {}));
  } catch {
    return {};
  }
}

async function runGuarded(ctx: Context, guards: Guard[], middlewares: Middleware<any>[], handler: Handler<any>) {
  for (const g of guards) {
    if (!(await g(ctx))) return;
  }
  await compose([...middlewares, async (c: Context) => void (await handler(c))])(ctx);
}

/** Koa-style middleware composition. */
export function compose(middlewares: Middleware<any>[]): (ctx: Context) => Promise<void> {
  return (ctx) => {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      const fn = middlewares[i];
      if (!fn) return;
      await fn(ctx, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}

/**
 * Create the application (the composition root). Export it as default from `src/main.ts`.
 *
 * ```ts
 * export default createApp({
 *   modules: [UsersModule, ShopModule],
 *   commands: { start: (ctx) => ctx.reply('Hi!') },
 * })
 * ```
 */
export function createApp(options: AppOptions): App {
  return new App(options);
}

