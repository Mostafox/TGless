import type { CallbackQuery, Message, InlineQuery, User, Chat } from '@grammyjs/types';
import type { Context } from './context.js';
import { UPDATE_TYPES, type UpdateType } from './update-types.js';

export type Awaitable<T> = T | Promise<T>;
export type Next = () => Promise<void>;
export type Middleware<C extends Context = Context> = (ctx: C, next: Next) => Awaitable<unknown>;
export type Handler<C extends Context = Context> = (ctx: C) => Awaitable<unknown>;
/** Return `false` (or throw `ForbiddenError`) to stop the request. */
export type Guard = (ctx: Context) => Awaitable<boolean>;

export interface RouteOptions {
  guards?: Guard[];
  middlewares?: Middleware<any>[];
  /** Shown by `app.commands()` / `syncCommands()` (commands only). */
  description?: string;
}

// ── narrowed contexts ──

export type MessageContext = Context & { message: Message; msg: Message; chat: Chat; chatId: number };
export type CommandContext = MessageContext & {
  from: User;
  text: string;
  /** Command name without slash/bot username. */
  command: string;
  /** Everything after the command: `/start abc def` → `"abc def"` (deep-link payload for /start). */
  args: string;
  argList: string[];
};
export type HearsContext = MessageContext & { text: string; match: RegExpMatchArray };
export type CallbackContext<P = Record<string, string>> = Context & {
  callbackQuery: CallbackQuery;
  from: User;
  data: string;
  params: P;
  match: RegExpMatchArray;
};
export type InlineContext = Context & { inlineQuery: InlineQuery; from: User; query: string; match: RegExpMatchArray | null };

// ── route objects ──

interface BaseRoute {
  options: RouteOptions;
  handler: Handler<any>;
}
export interface CommandRoute extends BaseRoute {
  kind: 'command';
  names: string[];
}
export interface HearsRoute extends BaseRoute {
  kind: 'hears';
  triggers: (string | RegExp)[];
}
export interface OnRoute extends BaseRoute {
  kind: 'on';
  filters: FilterQuery[];
}
export interface InlineRoute extends BaseRoute {
  kind: 'inline';
  pattern?: RegExp;
}
export interface CallbackRoute<P = any> extends BaseRoute {
  kind: 'callback';
  pattern: string | RegExp;
  regex: RegExp;
  paramNames: string[];
  /** Build callback_data for this route: `addToCart.data({ id: 5 })`. */
  data(params?: { [K in keyof P]: string | number | boolean }): string;
}
export type Route = CommandRoute | HearsRoute | OnRoute | InlineRoute | CallbackRoute;

function split<H>(a: RouteOptions | H, b?: H): [RouteOptions, H] {
  return b === undefined ? [{}, a as H] : [a as RouteOptions, b];
}

// ── command ──

/**
 * `/name` command handler. Accepts several names: `command(['help', 'h'], ...)`.
 *
 * ```ts
 * export const start = command('start', async (ctx) => ctx.reply(`Hi ${ctx.from.first_name}`))
 * ```
 */
export function command(name: string | string[], handler: Handler<CommandContext>): CommandRoute;
export function command(name: string | string[], options: RouteOptions, handler: Handler<CommandContext>): CommandRoute;
export function command(name: string | string[], a: any, b?: any): CommandRoute {
  const [options, handler] = split<Handler<CommandContext>>(a, b);
  const names = (Array.isArray(name) ? name : [name]).map((n) => n.replace(/^\//, '').toLowerCase());
  for (const n of names) {
    if (!/^[a-z0-9_]{1,32}$/.test(n)) throw new Error(`Invalid command name "${n}" (a-z, 0-9, _; max 32).`);
  }
  return { kind: 'command', names, options, handler };
}

// ── hears ──

/** Text messages matching a string (exact) or RegExp. */
export function hears(trigger: string | RegExp | (string | RegExp)[], handler: Handler<HearsContext>): HearsRoute;
export function hears(trigger: string | RegExp | (string | RegExp)[], options: RouteOptions, handler: Handler<HearsContext>): HearsRoute;
export function hears(trigger: any, a: any, b?: any): HearsRoute {
  const [options, handler] = split<Handler<HearsContext>>(a, b);
  return { kind: 'hears', triggers: Array.isArray(trigger) ? trigger : [trigger], options, handler };
}

// ── on (filter queries) ──

/**
 * `'message'`, `'message:photo'`, `'callback_query'`, `'chat_member'`, …
 * `':text'` / `':photo'` = any message-like update (message, edited, channel post) with that field.
 */
export type FilterQuery = UpdateType | `${UpdateType}:${string}` | `:${string}`;

const MESSAGE_LIKE: UpdateType[] = ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'business_message', 'edited_business_message'];

export function filterUpdateTypes(f: FilterQuery): UpdateType[] {
  const [type] = f.split(':');
  if (!type) return MESSAGE_LIKE;
  if (!(UPDATE_TYPES as readonly string[]).includes(type)) throw new Error(`Unknown update type "${type}" in filter "${f}".`);
  return [type as UpdateType];
}

export function matchesFilter(f: FilterQuery, type: UpdateType, payload: any): boolean {
  const [t, field] = f.split(':');
  if (t ? t !== type : !MESSAGE_LIKE.includes(type)) return false;
  if (!field) return true;
  return payload != null && payload[field] !== undefined;
}

export function on(filter: FilterQuery | FilterQuery[], handler: Handler<Context>): OnRoute;
export function on(filter: FilterQuery | FilterQuery[], options: RouteOptions, handler: Handler<Context>): OnRoute;
export function on(filter: any, a: any, b?: any): OnRoute {
  const [options, handler] = split<Handler<Context>>(a, b);
  const filters: FilterQuery[] = Array.isArray(filter) ? filter : [filter];
  filters.forEach(filterUpdateTypes); // validate early
  return { kind: 'on', filters, options, handler };
}

// ── inline queries ──

export function inlineQuery(handler: Handler<InlineContext>): InlineRoute;
export function inlineQuery(pattern: RegExp | string, handler: Handler<InlineContext>, options?: RouteOptions): InlineRoute;
export function inlineQuery(a: any, b?: any, c?: RouteOptions): InlineRoute {
  if (typeof a === 'function') return { kind: 'inline', options: {}, handler: a };
  const pattern = typeof a === 'string' ? new RegExp(`^${escapeRegex(a)}`) : a;
  return { kind: 'inline', pattern, options: c ?? {}, handler: b };
}

// ── callbacks ──

type Segments<S extends string> = S extends `${infer H}/${infer T}` ? [H, ...Segments<T>] : [S];
type ParamName<S> = S extends `:${infer N}` ? N : never;
export type CallbackParams<S extends string> = { [K in ParamName<Segments<S>[number]>]: string };

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** callback_data max length (bytes). */
export const CALLBACK_DATA_LIMIT = 64;

function byteLength(s: string) {
  return new TextEncoder().encode(s).length;
}

/**
 * Callback-query handler with a typed data pattern. Segments are separated by
 * `/`; segments starting with `:` are params.
 *
 * ```ts
 * export const addToCart = callback('cart:add/:id', async (ctx) => {
 *   ctx.params.id // string
 * })
 * inline().text('Add', addToCart.data({ id: 5 }))   // "cart:add/5"
 * ```
 */
export function callback<const S extends string>(pattern: S, handler: Handler<CallbackContext<CallbackParams<S>>>): CallbackRoute<CallbackParams<S>>;
export function callback<const S extends string>(pattern: S, options: RouteOptions, handler: Handler<CallbackContext<CallbackParams<S>>>): CallbackRoute<CallbackParams<S>>;
export function callback(pattern: RegExp, handler: Handler<CallbackContext<Record<string, string>>>): CallbackRoute<Record<string, string>>;
export function callback(pattern: RegExp, options: RouteOptions, handler: Handler<CallbackContext<Record<string, string>>>): CallbackRoute<Record<string, string>>;
export function callback(pattern: string | RegExp, a: any, b?: any): CallbackRoute {
  const [options, handler] = split<Handler<any>>(a, b);
  if (pattern instanceof RegExp) {
    return {
      kind: 'callback',
      pattern,
      regex: pattern,
      paramNames: [],
      options,
      handler,
      data() {
        throw new Error(`callback(${pattern}) uses a RegExp; build its data string yourself.`);
      },
    };
  }
  const segments = pattern.split('/');
  const paramNames: string[] = [];
  const source = segments
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]*)';
      }
      return escapeRegex(seg);
    })
    .join('/');
  return {
    kind: 'callback',
    pattern,
    regex: new RegExp(`^${source}$`),
    paramNames,
    options,
    handler,
    data(params: Record<string, unknown> = {}) {
      const out = segments
        .map((seg) => {
          if (!seg.startsWith(':')) return seg;
          const name = seg.slice(1);
          const v = params[name];
          if (v === undefined || v === null) throw new Error(`callback "${pattern}": missing param "${name}".`);
          const s = String(v);
          if (s.includes('/')) throw new Error(`callback "${pattern}": param "${name}" must not contain "/".`);
          return s;
        })
        .join('/');
      if (byteLength(out) > CALLBACK_DATA_LIMIT) {
        throw new Error(`callback_data "${out}" is ${byteLength(out)} bytes; Telegram allows ${CALLBACK_DATA_LIMIT}.`);
      }
      return out;
    },
  };
}

/** Which update types a route needs (drives which tgcloud handlers are generated). */
export function routeUpdateTypes(r: Route): UpdateType[] {
  switch (r.kind) {
    case 'command':
    case 'hears':
      return ['message'];
    case 'callback':
      return ['callback_query'];
    case 'inline':
      return ['inline_query'];
    case 'on':
      return r.filters.flatMap(filterUpdateTypes);
  }
}
