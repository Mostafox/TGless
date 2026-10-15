import type { Chat } from '@grammyjs/types';
import type { Context } from './context.js';
import { ForbiddenError } from './errors.js';
import type { Guard, Middleware } from './routes.js';

/** Built-in guards. Use in `defineModule({ guards })` or a route's `{ guards }`. */
export const guards = {
  /** Only these user ids. `message` is sent to everyone else (optional). */
  users(ids: number[], message?: string): Guard {
    const set = new Set(ids);
    return (ctx) => {
      if (ctx.from && set.has(ctx.from.id)) return true;
      if (message) throw new ForbiddenError(message);
      return false;
    };
  },
  /** Alias of `users()` for admin lists. */
  admins(ids: number[], message = '⛔ Admins only.'): Guard {
    return guards.users(ids, message);
  },
  chatType(...types: Chat['type'][]): Guard {
    return (ctx) => !!ctx.chat && types.includes(ctx.chat.type);
  },
  privateChat(): Guard {
    return guards.chatType('private');
  },
  groups(): Guard {
    return guards.chatType('group', 'supergroup');
  },
  /** Any custom predicate. */
  when(predicate: (ctx: Context) => boolean | Promise<boolean>, message?: string): Guard {
    return async (ctx) => {
      if (await predicate(ctx)) return true;
      if (message) throw new ForbiddenError(message);
      return false;
    };
  },
};

/** Middleware that logs each update and how long it took. */
export function logger(): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    await next();
    console.log(`[tgless] ${ctx.updateType} from ${ctx.from?.id ?? '-'} in ${Date.now() - start}ms`);
  };
}
