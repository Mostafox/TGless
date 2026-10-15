import type { Middleware } from 'tgless';
import { UsersService } from './services/users.service';

/** Keeps the `users` table in sync and exposes the row as `ctx.state.user`. */
export const trackUser: Middleware = async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot && ctx.chat?.type === 'private') {
    ctx.state.user = await ctx.inject(UsersService).sync(ctx.from);
  }
  await next();
};
