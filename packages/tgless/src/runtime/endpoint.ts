import type { Chat } from '@grammyjs/types';
import type { BotApi, Platform, SdkDatabase, SdkFetch, SdkModule } from '../sdk.js';
import type { Container, Token } from './di.js';
import { ValidationError } from './errors.js';
import type { Awaitable } from './routes.js';

/** The verified Mini App init data (`Telegram.WebApp.initDataUnsafe`, verified). */
export interface InitData {
  user?: WebAppUser;
  receiver?: WebAppUser;
  chat?: Pick<Chat, 'id' | 'type'> & { title?: string; username?: string; photo_url?: string };
  chat_type?: string;
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash?: string;
  [key: string]: unknown;
}

export interface WebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

/** A validator: zod/valibot-style `{ parse }`, `{ safeParse }`, or a plain function. */
export type Validator<T> =
  | { parse(input: unknown): T }
  | { safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown } }
  | ((input: unknown) => T);

export class EndpointContext<I = any> {
  constructor(
    readonly input: I,
    /** The platform's ctx (`initData`, …). */
    readonly raw: { initData?: InitData; [k: string]: unknown },
    private readonly platform: Platform,
    readonly container: Container,
    readonly name: string,
  ) {}

  /** Verified init data (`401` is returned by the platform when invalid). */
  get initData(): InitData {
    return (this.raw.initData ?? { auth_date: 0 }) as InitData;
  }
  /** The calling user (`initData.user`). Throws if the Mini App was opened without a user. */
  get user(): WebAppUser {
    const u = this.initData.user;
    if (!u) throw new Error(`Endpoint "${this.name}" was called without initData.user.`);
    return u;
  }
  get api(): BotApi {
    return this.platform.sdk.api;
  }
  get db(): SdkDatabase {
    return this.platform.sdk.db;
  }
  get fetch(): SdkFetch {
    return this.platform.sdk.fetch;
  }
  get sdk(): SdkModule {
    return this.platform.sdk;
  }
  inject<T>(token: Token<T>): T {
    return this.container.resolve(token) as T;
  }
}

export type EndpointGuard = (ctx: EndpointContext) => Awaitable<boolean>;

export interface EndpointOptions<I> {
  /** Validate/parse `input` before the handler runs (zod, valibot, or a function). */
  input?: Validator<I>;
  /** Return `false` to refuse with `EndpointError('Forbidden')`. */
  guards?: EndpointGuard[];
}

export interface Endpoint<I = any, O = any> {
  kind: 'endpoint';
  options: EndpointOptions<I>;
  handler: (ctx: EndpointContext<I>) => Awaitable<O>;
}

/**
 * A Mini App endpoint (`POST /api/<name>`). The name is the key in the module's
 * `endpoints` record. Return value → JSON result. `throw fail('msg', {...})` → client error.
 *
 * ```ts
 * export const getProfile = endpoint(async (ctx) => Users.find({ tgId: ctx.user.id }))
 * export const rename = endpoint({ input: z.object({ name: z.string() }) }, async (ctx) => {...})
 * ```
 */
export function endpoint<O>(handler: (ctx: EndpointContext<Record<string, unknown>>) => Awaitable<O>): Endpoint<Record<string, unknown>, O>;
export function endpoint<I, O>(options: EndpointOptions<I>, handler: (ctx: EndpointContext<I>) => Awaitable<O>): Endpoint<I, O>;
export function endpoint(a: any, b?: any): Endpoint {
  return b === undefined ? { kind: 'endpoint', options: {}, handler: a } : { kind: 'endpoint', options: a, handler: b };
}

export function validate<T>(validator: Validator<T>, input: unknown): T {
  try {
    if (typeof validator === 'function') return validator(input);
    if ('safeParse' in validator) {
      const r = validator.safeParse(input);
      if (r.success) return r.data;
      throw new ValidationError(issuesOf(r.error));
    }
    return validator.parse(input);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(issuesOf(e));
  }
}

function issuesOf(e: unknown): unknown {
  const anyE = e as any;
  if (anyE?.issues) return anyE.issues;
  if (anyE?.message) return anyE.message;
  return String(e);
}

export const ENDPOINT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
