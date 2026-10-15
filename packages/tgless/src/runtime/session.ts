import { c } from '../db/columns.js';
import { Entity } from '../db/entity.js';
import type { Context } from './context.js';
import type { Middleware } from './routes.js';

/** Framework table holding sessions. Emitted into schema.js only when sessions are enabled. */
export const SessionsEntity = new Entity('tgless_sessions', {
  key: c.text().primary(),
  data: c.json<Record<string, unknown>>(),
  updatedAt: c.updatedAt(),
});
SessionsEntity.internal = true;

export interface SessionOptions {
  /** Session key per update. Default: `<chatId>:<userId>` (or `u:<userId>` without a chat). */
  key?: (ctx: Context) => string | undefined;
  /** Initial session value. */
  initial?: () => Record<string, unknown>;
}

export function defaultSessionKey(ctx: Context): string | undefined {
  const user = ctx.from?.id;
  const chat = ctx.chatId;
  if (chat !== undefined && user !== undefined) return `${chat}:${user}`;
  if (user !== undefined) return `u:${user}`;
  if (chat !== undefined) return `c:${chat}`;
  return undefined;
}

/** Loads `ctx.session` before the handlers and saves it afterwards if it changed. */
export function sessionMiddleware(opts: SessionOptions = {}): Middleware {
  const keyOf = opts.key ?? defaultSessionKey;
  const initial = opts.initial ?? (() => ({}));
  return async (ctx, next) => {
    const key = keyOf(ctx);
    if (!key) {
      ctx.session = initial() as any;
      return next();
    }
    const row = await SessionsEntity.find({ key });
    const before = row ? JSON.stringify(row.data) : undefined;
    ctx.session = (row?.data ?? initial()) as any;
    await next();
    const data = ctx.session ?? {};
    const after = JSON.stringify(data);
    if (after === before) return;
    if (!row && after === '{}') return;
    await SessionsEntity.upsert({ where: { key }, create: { data }, update: { data } });
  };
}
